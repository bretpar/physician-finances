import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { getUserOrgId } from "@/hooks/useOrgId";
import { addDays, addWeeks, addMonths, startOfDay, endOfYear, isAfter, isBefore, parseISO, format, isSameDay } from "date-fns";

/** Minimal interface for income entries used in matching — works with both IncomeEntry and PersonalIncomeEntry */
export interface MatchableIncomeEntry {
  id: string;
  income_date: string;
  company: string;
  paycheck_amount: number;
  income_type: string;
  status: string;
}

/* ─── Types ─── */
export interface ProjectedIncomeStream {
  id: string;
  user_id: string;
  organization_id: string | null;
  company: string;
  company_type: string;
  pay_frequency: string;
  custom_interval_days: number | null;
  start_date: string;
  end_date: string | null;
  paycheck_amount: number;
  taxes_withheld: number;
  retirement_401k: number;
  pre_tax_deductions: number;
  is_active: boolean;
  include_in_tax: boolean;
  /** Linked source/employer (companies.id). Optional for legacy rows. */
  source_id: string | null;
  /** Original UI subtype (w2_user, 1099_schedule_c, etc.) — preserves edit/transfer fidelity. */
  ui_income_subtype: string | null;
  /** Per-paycheck withholdings/deductions (mirror Personal Income & Business Activity). */
  federal_withholding: number;
  state_withholding: number;
  ss_withholding: number;
  medicare_withholding: number;
  owner_healthcare: number;
  additional_tax_reserve: number;
  notes: string;
  created_at: string;
  updated_at: string;
}

export interface ProjectedBonusEvent {
  id: string;
  stream_id: string;
  user_id: string;
  organization_id: string | null;
  name: string;
  amount: number;
  taxes_withheld: number;
  frequency: string;
  scheduled_date: string;
  created_at: string;
  updated_at: string;
}

export interface ProjectedIncomeOverride {
  id: string;
  stream_id: string;
  user_id: string;
  organization_id: string | null;
  override_date: string;
  action: "skip" | "modify";
  paycheck_amount: number;
  taxes_withheld: number;
  retirement_401k: number;
  pre_tax_deductions: number;
  notes: string;
  created_at: string;
  updated_at: string;
}

export type ProjectedMatchStatus = "active" | "matched" | "past_due" | "skipped";

export interface ProjectedPaycheck {
  date: string;
  grossAmount: number;
  taxesWithheld: number;
  retirement401k: number;
  preTaxDeductions: number;
  netAmount: number;
  type: "paycheck" | "bonus";
  label: string;
  streamId: string;
  isSkipped?: boolean;
  isModified?: boolean;
  /** New: tracks whether this projected paycheck has been matched to actual income */
  matchStatus: ProjectedMatchStatus;
  /** If matched, the ID of the actual income entry */
  matchedIncomeId?: string;
  /** If matched, the actual amount received */
  matchedAmount?: number;
  /** Company type from the stream (W2, 1099, K1, etc.) */
  streamCompanyType?: string;
}

/* ─── Helpers ─── */

export function isStreamExpired(stream: ProjectedIncomeStream): boolean {
  const today = startOfDay(new Date());
  if (stream.pay_frequency === "single") {
    const d = parseISO(stream.start_date);
    return isBefore(d, today) && !isSameDay(d, today);
  }
  if (stream.end_date) {
    const end = parseISO(stream.end_date);
    return isBefore(end, today) && !isSameDay(end, today);
  }
  return false;
}

/**
 * Match a projected paycheck against actual income entries.
 * Returns the best matching income entry or null.
 *
 * Matching criteria (all contribute to score):
 * - Date within ±3 days
 * - Same company name
 * - Similar gross amount (within 10%)
 * - Same income type/company_type
 */
function findMatchingIncome(
  paycheck: { date: string; grossAmount: number; label: string; streamCompanyType?: string },
  incomeEntries: MatchableIncomeEntry[],
  usedEntryIds: Set<string>,
): { entry: MatchableIncomeEntry; score: number } | null {
  const pDate = parseISO(paycheck.date).getTime();
  let bestMatch: { entry: MatchableIncomeEntry; score: number } | null = null;

  for (const entry of incomeEntries) {
    if (usedEntryIds.has(entry.id)) continue;
    if (entry.status === "projected") continue; // Don't match against other projected items

    let score = 0;

    // Date proximity (±3 days)
    const eDate = parseISO(entry.income_date).getTime();
    const daysDiff = Math.abs(pDate - eDate) / (1000 * 60 * 60 * 24);
    if (daysDiff === 0) score += 40;
    else if (daysDiff <= 1) score += 30;
    else if (daysDiff <= 3) score += 15;
    else continue; // Skip if more than 3 days apart

    // Company match
    const pCompany = (paycheck.label || "").toLowerCase();
    const eCompany = (entry.company || "").toLowerCase();
    if (pCompany && eCompany && (pCompany.includes(eCompany) || eCompany.includes(pCompany))) {
      score += 30;
    }

    // Amount similarity (within 10% of gross)
    const gross = Number(entry.paycheck_amount);
    if (gross > 0 && paycheck.grossAmount > 0) {
      const diff = Math.abs(gross - paycheck.grossAmount);
      const pct = diff / paycheck.grossAmount;
      if (pct === 0) score += 30;
      else if (pct <= 0.02) score += 25;
      else if (pct <= 0.05) score += 15;
      else if (pct <= 0.10) score += 5;
    }

    // Threshold: need at least date + one other signal
    if (score >= 45 && (!bestMatch || score > bestMatch.score)) {
      bestMatch = { entry, score };
    }
  }

  return bestMatch;
}

/* ─── Queries ─── */
export function useProjectedStreams() {
  return useQuery({
    queryKey: ["projected_income_streams"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("projected_income_streams")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data || []) as ProjectedIncomeStream[];
    },
  });
}

export function useProjectedBonuses(streamId?: string) {
  return useQuery({
    queryKey: ["projected_bonus_events", streamId],
    queryFn: async () => {
      let q = supabase.from("projected_bonus_events").select("*").order("scheduled_date");
      if (streamId) q = q.eq("stream_id", streamId);
      const { data, error } = await q;
      if (error) throw error;
      return (data || []) as ProjectedBonusEvent[];
    },
  });
}

export function useStreamOverrides() {
  return useQuery({
    queryKey: ["projected_income_overrides"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("projected_income_overrides")
        .select("*")
        .order("override_date");
      if (error) throw error;
      return (data || []) as ProjectedIncomeOverride[];
    },
  });
}

/* ─── Mutations ─── */
export function useAddStream() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (stream: Partial<ProjectedIncomeStream>) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");
      const orgId = await getUserOrgId();
      const { error } = await supabase.from("projected_income_streams").insert({
        user_id: user.id,
        organization_id: orgId,
        company: stream.company || "",
        company_type: stream.company_type || "w2",
        pay_frequency: stream.pay_frequency || "biweekly",
        custom_interval_days: stream.custom_interval_days || null,
        start_date: stream.start_date || new Date().toISOString().split("T")[0],
        end_date: stream.end_date || null,
        paycheck_amount: stream.paycheck_amount || 0,
        taxes_withheld: stream.taxes_withheld || 0,
        retirement_401k: stream.retirement_401k || 0,
        pre_tax_deductions: stream.pre_tax_deductions || 0,
        is_active: stream.is_active ?? true,
        include_in_tax: stream.include_in_tax ?? true,
        source_id: stream.source_id ?? null,
        ui_income_subtype: stream.ui_income_subtype ?? null,
        federal_withholding: stream.federal_withholding || 0,
        state_withholding: stream.state_withholding || 0,
        ss_withholding: stream.ss_withholding || 0,
        medicare_withholding: stream.medicare_withholding || 0,
        owner_healthcare: stream.owner_healthcare || 0,
        additional_tax_reserve: stream.additional_tax_reserve || 0,
        notes: stream.notes || "",
      } as any);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["projected_income_streams"] });
      toast.success("Projected income stream created");
    },
    onError: (e) => toast.error(e.message),
  });
}

export function useUpdateStream() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...updates }: Partial<ProjectedIncomeStream> & { id: string }) => {
      const { error } = await supabase
        .from("projected_income_streams")
        .update(updates)
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["projected_income_streams"] });
      toast.success("Income stream updated");
    },
    onError: (e) => toast.error(e.message),
  });
}

export function useDeleteStream() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("projected_income_streams")
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["projected_income_streams"] });
      qc.invalidateQueries({ queryKey: ["projected_bonus_events"] });
      qc.invalidateQueries({ queryKey: ["projected_income_overrides"] });
      toast.success("Income stream deleted");
    },
    onError: (e) => toast.error(e.message),
  });
}

export function useAddBonus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (bonus: Partial<ProjectedBonusEvent> & { stream_id: string }) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");
      const orgId = await getUserOrgId();
      const { error } = await supabase.from("projected_bonus_events").insert({
        stream_id: bonus.stream_id,
        user_id: user.id,
        organization_id: orgId,
        name: bonus.name || "",
        amount: bonus.amount || 0,
        taxes_withheld: bonus.taxes_withheld || 0,
        frequency: bonus.frequency || "one-time",
        scheduled_date: bonus.scheduled_date || new Date().toISOString().split("T")[0],
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["projected_bonus_events"] });
      toast.success("Bonus event added");
    },
    onError: (e) => toast.error(e.message),
  });
}

export function useDeleteBonus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("projected_bonus_events")
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["projected_bonus_events"] });
      toast.success("Bonus event deleted");
    },
    onError: (e) => toast.error(e.message),
  });
}

/* ─── Override Mutations ─── */
export function useAddOverride() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (override: {
      stream_id: string;
      override_date: string;
      action: "skip" | "modify";
      paycheck_amount?: number;
      taxes_withheld?: number;
      retirement_401k?: number;
      pre_tax_deductions?: number;
      notes?: string;
    }) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");
      const orgId = await getUserOrgId();
      const { error } = await supabase.from("projected_income_overrides").insert({
        stream_id: override.stream_id,
        user_id: user.id,
        organization_id: orgId,
        override_date: override.override_date,
        action: override.action,
        paycheck_amount: override.paycheck_amount ?? 0,
        taxes_withheld: override.taxes_withheld ?? 0,
        retirement_401k: override.retirement_401k ?? 0,
        pre_tax_deductions: override.pre_tax_deductions ?? 0,
        notes: override.notes || "",
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["projected_income_overrides"] });
      toast.success("Override saved");
    },
    onError: (e) => toast.error(e.message),
  });
}

export function useUpdateOverride() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...updates }: Partial<ProjectedIncomeOverride> & { id: string }) => {
      const { error } = await supabase
        .from("projected_income_overrides")
        .update(updates)
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["projected_income_overrides"] });
      toast.success("Override updated");
    },
    onError: (e) => toast.error(e.message),
  });
}

export function useDeleteOverride() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("projected_income_overrides")
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["projected_income_overrides"] });
      toast.success("Override removed");
    },
    onError: (e) => toast.error(e.message),
  });
}

/* ─── Projection engine ─── */
function getNextDate(current: Date, frequency: string, customDays?: number | null): Date {
  switch (frequency) {
    case "weekly": return addWeeks(current, 1);
    case "biweekly": return addWeeks(current, 2);
    case "monthly": return addMonths(current, 1);
    case "custom": return addDays(current, customDays || 14);
    default: return addWeeks(current, 2);
  }
}

/**
 * Generate projected paychecks with smart matching against actual income.
 *
 * Instead of simple date filtering, this now:
 * 1. Generates ALL projected paychecks (past and future within the year)
 * 2. Matches each against actual income entries using company+date+amount
 * 3. Tags each paycheck with a matchStatus:
 *    - "matched" — actual income exists for this paycheck
 *    - "past_due" — date has passed with no matching actual income
 *    - "skipped" — user explicitly skipped via override
 *    - "active" — future paycheck, not yet matched
 */
export function generateProjectedPaychecks(
  streams: ProjectedIncomeStream[],
  bonuses: ProjectedBonusEvent[],
  incomeEntries?: MatchableIncomeEntry[],
  overrides?: ProjectedIncomeOverride[],
): ProjectedPaycheck[] {
  const now = startOfDay(new Date());
  const yearStart = parseISO(`${now.getFullYear()}-01-01`);
  const yearEnd = endOfYear(now);
  const paychecks: ProjectedPaycheck[] = [];

  // Index overrides by stream_id + date for O(1) lookup
  const overrideMap = new Map<string, ProjectedIncomeOverride>();
  if (overrides) {
    for (const o of overrides) {
      overrideMap.set(`${o.stream_id}:${o.override_date}`, o);
    }
  }

  // Track which income entries have been used for matching
  const usedEntryIds = new Set<string>();

  // Collect all raw paychecks first (without matching)
  const rawPaychecks: Array<{
    date: string;
    grossAmount: number;
    taxesWithheld: number;
    retirement401k: number;
    preTaxDeductions: number;
    type: "paycheck" | "bonus";
    label: string;
    streamId: string;
    isSkipped: boolean;
    isModified: boolean;
    streamCompanyType?: string;
  }> = [];

  for (const stream of streams) {
    if (!stream.is_active || !stream.include_in_tax) continue;
    if (isStreamExpired(stream)) continue;

    const start = parseISO(stream.start_date);

    // One-time / single
    if (stream.pay_frequency === "single") {
      if (!isAfter(start, yearEnd)) {
        const dateStr = format(start, "yyyy-MM-dd");
        const override = overrideMap.get(`${stream.id}:${dateStr}`);
        if (override?.action === "skip") {
          rawPaychecks.push({
            date: dateStr, grossAmount: stream.paycheck_amount,
            taxesWithheld: stream.taxes_withheld, retirement401k: stream.retirement_401k,
            preTaxDeductions: stream.pre_tax_deductions,
            type: "paycheck", label: stream.company, streamId: stream.id,
            isSkipped: true, isModified: false, streamCompanyType: stream.company_type,
          });
        } else {
          const amt = override?.action === "modify" ? override.paycheck_amount : stream.paycheck_amount;
          const tax = override?.action === "modify" ? override.taxes_withheld : stream.taxes_withheld;
          const ret = override?.action === "modify" ? override.retirement_401k : stream.retirement_401k;
          const ded = override?.action === "modify" ? override.pre_tax_deductions : stream.pre_tax_deductions;
          rawPaychecks.push({
            date: dateStr, grossAmount: amt, taxesWithheld: tax, retirement401k: ret, preTaxDeductions: ded,
            type: "paycheck", label: stream.company, streamId: stream.id,
            isSkipped: false, isModified: override?.action === "modify", streamCompanyType: stream.company_type,
          });
        }
      }
      continue;
    }

    // Recurring streams — generate from start of year (or stream start) through year end
    const end = stream.end_date ? parseISO(stream.end_date) : yearEnd;
    const effectiveStart = isBefore(start, yearStart) ? yearStart : start;

    // Find first pay date on or after effectiveStart
    let current = start;
    while (isBefore(current, effectiveStart)) {
      current = getNextDate(current, stream.pay_frequency, stream.custom_interval_days);
    }

    while (!isAfter(current, end) && !isAfter(current, yearEnd)) {
      const dateStr = format(current, "yyyy-MM-dd");
      const override = overrideMap.get(`${stream.id}:${dateStr}`);

      if (override?.action === "skip") {
        rawPaychecks.push({
          date: dateStr, grossAmount: stream.paycheck_amount,
          taxesWithheld: stream.taxes_withheld, retirement401k: stream.retirement_401k,
          preTaxDeductions: stream.pre_tax_deductions,
          type: "paycheck", label: stream.company, streamId: stream.id,
          isSkipped: true, isModified: false, streamCompanyType: stream.company_type,
        });
      } else {
        const amt = override?.action === "modify" ? override.paycheck_amount : stream.paycheck_amount;
        const tax = override?.action === "modify" ? override.taxes_withheld : stream.taxes_withheld;
        const ret = override?.action === "modify" ? override.retirement_401k : stream.retirement_401k;
        const ded = override?.action === "modify" ? override.pre_tax_deductions : stream.pre_tax_deductions;
        rawPaychecks.push({
          date: dateStr, grossAmount: amt, taxesWithheld: tax, retirement401k: ret, preTaxDeductions: ded,
          type: "paycheck", label: stream.company, streamId: stream.id,
          isSkipped: false, isModified: override?.action === "modify", streamCompanyType: stream.company_type,
        });
      }
      current = getNextDate(current, stream.pay_frequency, stream.custom_interval_days);
    }
  }

  // Bonuses
  for (const bonus of bonuses) {
    const stream = streams.find((s) => s.id === bonus.stream_id);
    if (!stream?.is_active) continue;

    const dates: Date[] = [];
    const baseDate = parseISO(bonus.scheduled_date);

    if (bonus.frequency === "one-time") {
      if (!isAfter(baseDate, yearEnd)) dates.push(baseDate);
    } else if (bonus.frequency === "quarterly") {
      let d = baseDate;
      while (!isAfter(d, yearEnd)) {
        dates.push(d);
        d = addMonths(d, 3);
      }
    } else if (bonus.frequency === "annual") {
      if (!isAfter(baseDate, yearEnd)) dates.push(baseDate);
    }

    for (const d of dates) {
      rawPaychecks.push({
        date: format(d, "yyyy-MM-dd"),
        grossAmount: bonus.amount,
        taxesWithheld: bonus.taxes_withheld,
        retirement401k: 0,
        preTaxDeductions: 0,
        type: "bonus",
        label: `${bonus.name} (${stream?.company || "Bonus"})`,
        streamId: bonus.stream_id,
        isSkipped: false, isModified: false, streamCompanyType: stream?.company_type,
      });
    }
  }

  // Sort by date for matching priority
  rawPaychecks.sort((a, b) => a.date.localeCompare(b.date));

  // Now match each paycheck against actual income entries
  const entries = incomeEntries || [];

  for (const raw of rawPaychecks) {
    const net = raw.grossAmount - raw.taxesWithheld - raw.retirement401k - raw.preTaxDeductions;

    if (raw.isSkipped) {
      paychecks.push({
        ...raw,
        netAmount: 0,
        matchStatus: "skipped",
      });
      continue;
    }

    // Try to find a matching actual income entry
    const match = findMatchingIncome(
      { date: raw.date, grossAmount: raw.grossAmount, label: raw.label, streamCompanyType: raw.streamCompanyType },
      entries,
      usedEntryIds,
    );

    if (match) {
      usedEntryIds.add(match.entry.id);
      paychecks.push({
        ...raw,
        netAmount: Math.max(0, net),
        matchStatus: "matched",
        matchedIncomeId: match.entry.id,
        matchedAmount: Number(match.entry.paycheck_amount),
      });
    } else {
      // Check if past due
      const pDate = parseISO(raw.date);
      const isPastDue = isBefore(pDate, now) && !isSameDay(pDate, now);

      paychecks.push({
        ...raw,
        netAmount: Math.max(0, net),
        matchStatus: isPastDue ? "past_due" : "active",
      });
    }
  }

  return paychecks.sort((a, b) => a.date.localeCompare(b.date));
}

/* ─── Aggregate projected totals ─── */
/** Only counts "active" (future, unmatched) paychecks — never matched, skipped, or past_due */
export function getProjectedTotals(paychecks: ProjectedPaycheck[]) {
  return paychecks
    .filter((p) => p.matchStatus === "active")
    .reduce(
      (acc, p) => ({
        grossIncome: acc.grossIncome + p.grossAmount,
        taxesWithheld: acc.taxesWithheld + p.taxesWithheld,
        retirement401k: acc.retirement401k + p.retirement401k,
        preTaxDeductions: acc.preTaxDeductions + p.preTaxDeductions,
        netIncome: acc.netIncome + p.netAmount,
        count: acc.count + 1,
      }),
      { grossIncome: 0, taxesWithheld: 0, retirement401k: 0, preTaxDeductions: 0, netIncome: 0, count: 0 }
    );
}
