import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { getUserOrgId } from "@/hooks/useOrgId";
import { addDays, addWeeks, addMonths, startOfDay, endOfYear, isAfter, isBefore, parseISO, format, isSameDay } from "date-fns";

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
        company_type: stream.company_type || "W2",
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
      });
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

export function generateProjectedPaychecks(
  streams: ProjectedIncomeStream[],
  bonuses: ProjectedBonusEvent[],
  existingIncomeDates?: Set<string>,
  overrides?: ProjectedIncomeOverride[]
): ProjectedPaycheck[] {
  const now = startOfDay(new Date());
  const yearEnd = endOfYear(now);
  const paychecks: ProjectedPaycheck[] = [];

  // Index overrides by stream_id + date for O(1) lookup
  const overrideMap = new Map<string, ProjectedIncomeOverride>();
  if (overrides) {
    for (const o of overrides) {
      overrideMap.set(`${o.stream_id}:${o.override_date}`, o);
    }
  }

  for (const stream of streams) {
    if (!stream.is_active || !stream.include_in_tax) continue;
    if (isStreamExpired(stream)) continue;

    const start = parseISO(stream.start_date);
    const end = stream.end_date ? parseISO(stream.end_date) : yearEnd;

    let current = start;
    while (isBefore(current, now)) {
      current = getNextDate(current, stream.pay_frequency, stream.custom_interval_days);
    }

    while (!isAfter(current, end) && !isAfter(current, yearEnd)) {
      const dateStr = format(current, "yyyy-MM-dd");

      if (!existingIncomeDates?.has(dateStr)) {
        const override = overrideMap.get(`${stream.id}:${dateStr}`);

        if (override?.action === "skip") {
          // Include skipped entries so UI can show them with strikethrough
          paychecks.push({
            date: dateStr,
            grossAmount: stream.paycheck_amount,
            taxesWithheld: stream.taxes_withheld,
            retirement401k: stream.retirement_401k,
            preTaxDeductions: stream.pre_tax_deductions,
            netAmount: 0,
            type: "paycheck",
            label: stream.company,
            streamId: stream.id,
            isSkipped: true,
          });
        } else {
          const amt = override?.action === "modify" ? override.paycheck_amount : stream.paycheck_amount;
          const tax = override?.action === "modify" ? override.taxes_withheld : stream.taxes_withheld;
          const ret = override?.action === "modify" ? override.retirement_401k : stream.retirement_401k;
          const ded = override?.action === "modify" ? override.pre_tax_deductions : stream.pre_tax_deductions;
          const net = amt - tax - ret - ded;
          paychecks.push({
            date: dateStr,
            grossAmount: amt,
            taxesWithheld: tax,
            retirement401k: ret,
            preTaxDeductions: ded,
            netAmount: Math.max(0, net),
            type: "paycheck",
            label: stream.company,
            streamId: stream.id,
            isModified: override?.action === "modify",
          });
        }
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
      if (!isBefore(baseDate, now) && !isAfter(baseDate, yearEnd)) {
        dates.push(baseDate);
      }
    } else if (bonus.frequency === "quarterly") {
      let d = baseDate;
      while (!isAfter(d, yearEnd)) {
        if (!isBefore(d, now)) dates.push(d);
        d = addMonths(d, 3);
      }
    } else if (bonus.frequency === "annual") {
      if (!isBefore(baseDate, now) && !isAfter(baseDate, yearEnd)) {
        dates.push(baseDate);
      }
    }

    for (const d of dates) {
      paychecks.push({
        date: format(d, "yyyy-MM-dd"),
        grossAmount: bonus.amount,
        taxesWithheld: bonus.taxes_withheld,
        retirement401k: 0,
        preTaxDeductions: 0,
        netAmount: Math.max(0, bonus.amount - bonus.taxes_withheld),
        type: "bonus",
        label: `${bonus.name} (${stream?.company || "Bonus"})`,
        streamId: bonus.stream_id,
      });
    }
  }

  return paychecks.sort((a, b) => a.date.localeCompare(b.date));
}

/* ─── Aggregate projected totals ─── */
export function getProjectedTotals(paychecks: ProjectedPaycheck[]) {
  return paychecks
    .filter((p) => !p.isSkipped) // Skipped entries don't count
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
