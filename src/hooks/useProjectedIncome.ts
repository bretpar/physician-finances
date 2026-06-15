import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { getUserOrgId } from "@/hooks/useOrgId";
import { addDays, addWeeks, addMonths, startOfDay, endOfYear, isAfter, isBefore, parseISO, format, isSameDay } from "date-fns";
import { getTotalFederalPaid } from "@/lib/federalWithholding";
import { isBusinessIncomeType } from "@/lib/ledgerRouting";
import {
  cleanupConvertedLedgerForStream,
  cleanupConvertedLedgerForOccurrence,
  cleanupConvertedLedgerForBonus,
  PLANNER_CLEANUP_INVALIDATION_KEYS,
} from "@/lib/plannerCleanup";

/** Minimal interface for income entries used in matching — works with both IncomeEntry and PersonalIncomeEntry */
export interface MatchableIncomeEntry {
  id: string;
  income_date: string;
  company: string;
  paycheck_amount: number;
  income_type: string;
  status: string;
  /** Optional — used by business matcher to scope to the same company/source */
  source_id?: string | null;
  /** Set when the entry was created via a confirmed planner conversion. */
  origin_planner_conversion_id?: string | null;
  /** "planner_conversion" indicates the entry is the confirmed actual for a projected paycheck. */
  entry_kind?: string | null;
}

/** Minimal interface for business ledger transactions used in matching. */
export interface MatchableBusinessTransaction {
  id: string;
  transaction_date: string;
  vendor: string;
  amount: number;
  source_id: string | null;
  status: string;
  transaction_type: string;
  origin_planner_conversion_id?: string | null;
  origin_type?: string | null;
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
  healthcare_deduction: number;
  hsa_contribution: number;
  additional_tax_reserve: number;
  notes: string;
  /** Forecast business expenses per pay period (1099 / K-1 / Schedule C only). 0 = forecast gross only. */
  forecast_expense_per_period: number;
  /** Free-text assumption note documenting the expense estimate (e.g. "malpractice $X/mo + CME"). */
  forecast_expense_notes: string;
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
  /** Optional. When set on a "modify" override, the occurrence is rendered on this date instead of override_date. */
  new_date: string | null;
  action: "skip" | "modify";
  paycheck_amount: number;
  taxes_withheld: number;
  retirement_401k: number;
  pre_tax_deductions: number;
  notes: string;
  created_at: string;
  updated_at: string;
}

export type ProjectedMatchStatus = "active" | "suggested" | "matched" | "past_due" | "skipped" | "converted";

/** Minimal shape of planner_conversions used to tag occurrences. */
export interface PlannerConversionRef {
  stream_id: string | null;
  bonus_event_id: string | null;
  occurrence_date: string;
  status: string;
}

export interface ProjectedPaycheck {
  date: string;
  grossAmount: number;
  taxesWithheld: number;
  retirement401k: number;
  preTaxDeductions: number;
  /** Healthcare deduction (formerly ownerHealthcare). */
  healthcareDeduction: number;
  /** HSA contribution — tracked separately for reporting. */
  hsaContribution: number;
  netAmount: number;
  type: "paycheck" | "bonus";
  label: string;
  streamId: string;
  isSkipped?: boolean;
  isModified?: boolean;
  /** New: tracks whether this projected paycheck has been matched to actual income */
  matchStatus: ProjectedMatchStatus;
  /** If matched (confirmed link), the ID of the actual income entry */
  matchedIncomeId?: string;
  /** If matched, the actual amount received */
  matchedAmount?: number;
  /** If suggested (heuristic only — NOT yet confirmed), the candidate income entry id (personal bucket) */
  suggestedIncomeId?: string;
  /** If suggested (heuristic only — NOT yet confirmed), the candidate transaction id (business bucket) */
  suggestedTransactionId?: string;
  /** Bucket of the suggested/matched record so the confirm flow can route correctly. */
  suggestedBucket?: "personal" | "business";
  /** If suggested, the candidate's gross amount for display only */
  suggestedAmount?: number;
  /** Company type from the stream (W2, 1099, K1, etc.) */
  streamCompanyType?: string;
  /** Linked source/employer (companies.id) from the stream — used by matching. */
  streamSourceId?: string | null;
  /** If this is a bonus entry, the originating bonus event id */
  bonusEventId?: string;
}

/* ─── Helpers ─── */

export function isStreamExpired(stream: ProjectedIncomeStream): boolean {
  const today = startOfDay(new Date());
  if (stream.pay_frequency === "single") {
    // One-time streams are NOT expired just because their date has passed.
    // They should still appear in the ledger (as past-due / matched / converted)
    // for the entire calendar year. They only fall off when the year rolls over,
    // which is handled by the yearStart/yearEnd window in generateProjectedPaychecks.
    const d = parseISO(stream.start_date);
    const yearStart = parseISO(`${today.getFullYear()}-01-01`);
    return isBefore(d, yearStart);
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
  paycheck: { date: string; grossAmount: number; label: string; streamCompanyType?: string; streamSourceId?: string | null },
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

    // Source/company match — prefer source_id, fall back to company name substring
    if (paycheck.streamSourceId && entry.source_id && paycheck.streamSourceId === entry.source_id) {
      score += 30;
    } else {
      const pCompany = (paycheck.label || "").toLowerCase();
      const eCompany = (entry.company || "").toLowerCase();
      if (pCompany && eCompany && (pCompany.includes(eCompany) || eCompany.includes(pCompany))) {
        score += 30;
      }
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

/**
 * Match a projected business paycheck against active business transactions
 * (transaction_type = 'income'). Returns the best matching transaction or null.
 *
 * Same scoring as personal — date ±3 days + source/vendor + amount similarity.
 * Heuristic match only; the user must confirm before it becomes a stored link.
 */
function findMatchingBusinessTransaction(
  paycheck: { date: string; grossAmount: number; label: string; streamSourceId?: string | null },
  transactions: MatchableBusinessTransaction[],
  usedTxIds: Set<string>,
): { tx: MatchableBusinessTransaction; score: number } | null {
  const pDate = parseISO(paycheck.date).getTime();
  let best: { tx: MatchableBusinessTransaction; score: number } | null = null;

  for (const tx of transactions) {
    if (usedTxIds.has(tx.id)) continue;
    if (tx.status !== "active") continue;
    if (tx.transaction_type !== "income") continue;

    let score = 0;
    const tDate = parseISO(tx.transaction_date).getTime();
    const daysDiff = Math.abs(pDate - tDate) / (1000 * 60 * 60 * 24);
    if (daysDiff === 0) score += 40;
    else if (daysDiff <= 1) score += 30;
    else if (daysDiff <= 3) score += 15;
    else continue;

    if (paycheck.streamSourceId && tx.source_id && paycheck.streamSourceId === tx.source_id) {
      score += 30;
    } else {
      const pVendor = (paycheck.label || "").toLowerCase();
      const tVendor = (tx.vendor || "").toLowerCase();
      if (pVendor && tVendor && (pVendor.includes(tVendor) || tVendor.includes(pVendor))) {
        score += 30;
      }
    }

    const amt = Number(tx.amount);
    if (amt > 0 && paycheck.grossAmount > 0) {
      const diff = Math.abs(amt - paycheck.grossAmount);
      const pct = diff / paycheck.grossAmount;
      if (pct === 0) score += 30;
      else if (pct <= 0.02) score += 25;
      else if (pct <= 0.05) score += 15;
      else if (pct <= 0.10) score += 5;
    }

    if (score >= 45 && (!best || score > best.score)) {
      best = { tx, score };
    }
  }
  return best;
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

/** Fetch planner_conversions for the current user — used to mark planner occurrences as converted. */
export function usePlannerConversions() {
  return useQuery({
    queryKey: ["planner_conversions"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("planner_conversions")
        .select("stream_id, bonus_event_id, occurrence_date, status");
      if (error) throw error;
      return (data || []) as PlannerConversionRef[];
    },
  });
}

/* ─── Mutations ─── */

export function buildProjectedIncomeStreamInsert(
  stream: Partial<ProjectedIncomeStream>,
  userId: string,
  organizationId: string | null,
) {
  return {
    user_id: userId,
    organization_id: organizationId,
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
    healthcare_deduction: stream.healthcare_deduction || 0,
    hsa_contribution: stream.hsa_contribution || 0,
    additional_tax_reserve: stream.additional_tax_reserve || 0,
    forecast_expense_per_period: stream.forecast_expense_per_period || 0,
    forecast_expense_notes: stream.forecast_expense_notes || "",
    notes: stream.notes || "",
  };
}

/**
 * Confirm a heuristic "suggested" projected→actual match by inserting a
 * planner_conversion linking the projected occurrence to the existing actual
 * ledger row (income_entries for personal, transactions for business). After
 * this, the projected entry renders as "Converted".
 *
 * Idempotent: if a conversion row already exists for (stream_id, occurrence_date),
 * we skip the insert and just back-link the existing row to the ledger entry.
 */
export function useConfirmSuggestedMatch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      streamId: string;
      occurrenceDate: string;
      /** ID of the existing ledger row (income_entries.id for personal, transactions.id for business). */
      incomeEntryId: string;
      ledgerBucket: "personal" | "business";
    }) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");
      const orgId = await getUserOrgId();

      // Idempotent pre-check
      const { data: existing } = await supabase
        .from("planner_conversions")
        .select("id")
        .eq("stream_id", input.streamId)
        .eq("occurrence_date", input.occurrenceDate)
        .maybeSingle();

      let conversionId: string | null = (existing as any)?.id ?? null;
      if (!conversionId) {
        const { data: inserted, error } = await supabase
          .from("planner_conversions")
          .insert({
            user_id: user.id,
            organization_id: orgId,
            stream_id: input.streamId,
            bonus_event_id: null,
            occurrence_date: input.occurrenceDate,
            ledger_bucket: input.ledgerBucket,
            income_entry_id: input.ledgerBucket === "personal" ? input.incomeEntryId : null,
            transaction_id: input.ledgerBucket === "business" ? input.incomeEntryId : null,
            status: "converted",
            needs_review_reason: "Confirmed by user from suggested match",
          } as any)
          .select("id")
          .single();
        if (error) {
          // Race: treat as already converted
          if ((error as any).code !== "23505") throw error;
          const { data: again } = await supabase
            .from("planner_conversions")
            .select("id")
            .eq("stream_id", input.streamId)
            .eq("occurrence_date", input.occurrenceDate)
            .maybeSingle();
          conversionId = (again as any)?.id ?? null;
        } else {
          conversionId = (inserted as any).id as string;
        }
      } else {
        // Backfill the linked ledger id on the existing conversion if missing
        await supabase
          .from("planner_conversions")
          .update({
            income_entry_id: input.ledgerBucket === "personal" ? input.incomeEntryId : null,
            transaction_id: input.ledgerBucket === "business" ? input.incomeEntryId : null,
            status: "converted",
          } as any)
          .eq("id", conversionId);
      }

      // Back-link the existing ledger row to the conversion so it shows as
      // a stored "matched" relationship on subsequent renders.
      if (conversionId) {
        if (input.ledgerBucket === "personal") {
          await supabase
            .from("income_entries")
            .update({
              origin_type: "planner_converted",
              origin_planner_conversion_id: conversionId,
            } as any)
            .eq("id", input.incomeEntryId);
        } else {
          await supabase
            .from("transactions")
            .update({
              origin_type: "planner_converted",
              origin_planner_conversion_id: conversionId,
            } as any)
            .eq("id", input.incomeEntryId);
        }
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["planner_conversions"] });
      qc.invalidateQueries({ queryKey: ["personal_income_entries"] });
      qc.invalidateQueries({ queryKey: ["income_entries"] });
      qc.invalidateQueries({ queryKey: ["transactions"] });
      toast.success("Match confirmed");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

/**
 * Manually convert a planned paycheck into a freshly-created ledger row.
 * Creates the planner_conversions record FIRST (acquiring the unique slot),
 * then inserts the ledger row, then back-links the conversion to it.
 */
export function useManualPlannerConvert() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      streamId: string;
      bonusEventId?: string | null;
      occurrenceDate: string;
      ledgerBucket: "personal" | "business";
      // Ledger row payload
      label: string;
      sourceId: string | null;
      incomeType: string;
      uiIncomeSubtype?: string | null;
      grossAmount: number;
      taxesWithheld: number;
      preTaxDeductions: number;
      retirement401k: number;
      healthcareDeduction: number;
      hsaContribution: number;
      federalWithholding: number;
      stateWithholding: number;
      ssWithholding: number;
      medicareWithholding: number;
      isBonus: boolean;
    }) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");
      const orgId = await getUserOrgId();

      // Idempotent: if a conversion already exists, return it (skip creation).
      let existingId: string | null = null;
      if (input.bonusEventId) {
        const { data } = await supabase
          .from("planner_conversions")
          .select("id")
          .eq("bonus_event_id", input.bonusEventId)
          .maybeSingle();
        existingId = (data as any)?.id ?? null;
      } else {
        const { data } = await supabase
          .from("planner_conversions")
          .select("id")
          .eq("stream_id", input.streamId)
          .eq("occurrence_date", input.occurrenceDate)
          .maybeSingle();
        existingId = (data as any)?.id ?? null;
      }
      if (existingId) return { conversionId: existingId, alreadyExisted: true };

      // 1. Insert planner_conversions
      const { data: conv, error: convErr } = await supabase
        .from("planner_conversions")
        .insert({
          user_id: user.id,
          organization_id: orgId,
          stream_id: input.bonusEventId ? null : input.streamId,
          bonus_event_id: input.bonusEventId ?? null,
          occurrence_date: input.occurrenceDate,
          ledger_bucket: input.ledgerBucket,
          status: "converted",
          needs_review_reason: "Manually converted from planner — please review",
        } as any)
        .select("id")
        .single();
      if (convErr) {
        if ((convErr as any).code === "23505") {
          // Race: someone else just converted it — fetch and return.
          const lookup = input.bonusEventId
            ? await supabase.from("planner_conversions").select("id").eq("bonus_event_id", input.bonusEventId).maybeSingle()
            : await supabase.from("planner_conversions").select("id").eq("stream_id", input.streamId).eq("occurrence_date", input.occurrenceDate).maybeSingle();
          return { conversionId: (lookup.data as any)?.id ?? null, alreadyExisted: true };
        }
        throw convErr;
      }
      const conversionId = (conv as any).id as string;

      // Compute take-home / deposited amount from planner fields so the
      // ledger row Net Received matches the planner's estimated take-home.
      const estimatedTakeHome = Math.max(
        0,
        input.grossAmount
          - (input.taxesWithheld || 0)
          - (input.preTaxDeductions || 0)
          - (input.retirement401k || 0)
          - (input.healthcareDeduction || 0)
          - (input.hsaContribution || 0),
      );

      // 2. Create the ledger row
      if (input.ledgerBucket === "personal") {
        const { data: ie, error } = await supabase
          .from("income_entries")
          .insert({
            user_id: user.id,
            organization_id: orgId,
            name: input.label,
            company: input.label,
            source_id: input.sourceId,
            income_type: input.incomeType,
            ui_income_subtype: input.uiIncomeSubtype ?? input.incomeType,
            income_date: input.occurrenceDate,
            gross_amount: input.grossAmount,
            paycheck_amount: input.grossAmount,
            deposited_amount: estimatedTakeHome,
            federal_withholding: input.federalWithholding,
            state_withholding: input.stateWithholding,
            ss_withholding: input.ssWithholding,
            medicare_withholding: input.medicareWithholding,
            taxes_withheld: input.taxesWithheld,
            pre_tax_deductions: input.preTaxDeductions,
            retirement_401k: input.retirement401k,
            healthcare_deduction: input.healthcareDeduction,
            hsa_contribution: input.hsaContribution,
            source_bucket: "personal",
            tax_category: "ordinary",
            is_actual: true,
            include_in_tax_estimate: true,
            include_in_cash_flow: false,
            status: "received",
            notes: `From planner${input.isBonus ? " (bonus)" : ""}`,
            origin_type: "planner_converted",
            origin_planner_conversion_id: conversionId,
          } as any)
          .select("id")
          .single();
        if (error) {
          await supabase.from("planner_conversions").delete().eq("id", conversionId);
          throw error;
        }
        await supabase
          .from("planner_conversions")
          .update({ income_entry_id: (ie as any).id })
          .eq("id", conversionId);
      } else {
        const { data: tx, error } = await supabase
          .from("transactions")
          .insert({
            user_id: user.id,
            organization_id: orgId,
            transaction_date: input.occurrenceDate,
            vendor: input.label,
            amount: input.grossAmount,
            account_source: "Planner",
            category: "Income",
            notes: `From planner${input.isBonus ? " (bonus)" : ""}`,
            entity: input.label || "Unassigned",
            company_type: input.incomeType,
            source_id: input.sourceId,
            transaction_type: "income",
            needs_review: true,
            status: "active",
            actual_withholding: input.taxesWithheld,
            origin_type: "planner_converted",
            origin_planner_conversion_id: conversionId,
          } as any)
          .select("id")
          .single();
        if (error) {
          await supabase.from("planner_conversions").delete().eq("id", conversionId);
          throw error;
        }
        const txId = (tx as any).id as string;

        // Also create a linked income_entries row so Business Activity's
        // Edit Income form and Tax Details Net Received pick up the saved
        // planner paycheck fields (401(k), pre-tax, healthcare, HSA,
        // withholdings, and estimated take-home).
        const { error: ieErr } = await supabase
          .from("income_entries")
          .insert({
            user_id: user.id,
            organization_id: orgId,
            name: input.label,
            company: input.label,
            source_id: input.sourceId,
            income_type: input.incomeType,
            ui_income_subtype: input.uiIncomeSubtype ?? input.incomeType,
            income_date: input.occurrenceDate,
            gross_amount: input.grossAmount,
            paycheck_amount: input.grossAmount,
            deposited_amount: estimatedTakeHome,
            federal_withholding: input.federalWithholding,
            state_withholding: input.stateWithholding,
            ss_withholding: input.ssWithholding,
            medicare_withholding: input.medicareWithholding,
            taxes_withheld: input.taxesWithheld,
            pre_tax_deductions: input.preTaxDeductions,
            retirement_401k: input.retirement401k,
            healthcare_deduction: input.healthcareDeduction,
            hsa_contribution: input.hsaContribution,
            source_bucket: "business",
            tax_category: "ordinary",
            is_actual: true,
            include_in_tax_estimate: true,
            include_in_cash_flow: false,
            status: "received",
            linked_transaction_id: txId,
            notes: `From planner${input.isBonus ? " (bonus)" : ""}`,
            origin_type: "planner_converted",
            origin_planner_conversion_id: conversionId,
          } as any);
        if (ieErr) {
          console.warn("[planner-convert] business income_entry insert failed", ieErr);
        }

        await supabase
          .from("planner_conversions")
          .update({ transaction_id: txId })
          .eq("id", conversionId);
      }
      return { conversionId, alreadyExisted: false };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["planner_conversions"] });
      qc.invalidateQueries({ queryKey: ["income_entries"] });
      qc.invalidateQueries({ queryKey: ["personal_income_entries"] });
      qc.invalidateQueries({ queryKey: ["transactions"] });
      qc.invalidateQueries({ queryKey: ["match-groups"] });
      qc.invalidateQueries({ queryKey: ["transaction-links"] });
      toast.success("Converted to ledger");
    },

    onError: (e: Error) => toast.error(e.message),
  });
}

export function useAddStream() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (stream: Partial<ProjectedIncomeStream>) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");
      const orgId = await getUserOrgId();
      const { error } = await supabase.from("projected_income_streams").insert(
        buildProjectedIncomeStreamInsert(stream, user.id, orgId) as any,
      );
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
      // Remove safe planner-created ledger rows BEFORE deleting the stream so
      // we still have planner_conversions.id -> ledger id links to follow.
      // Stream delete cascades to planner_conversions and would SET NULL the
      // origin_planner_conversion_id on income_entries / transactions, which
      // is exactly how false "actual" income was being left behind.
      const summary = await cleanupConvertedLedgerForStream(id);
      const { error } = await supabase
        .from("projected_income_streams")
        .delete()
        .eq("id", id);
      if (error) throw error;
      return summary;
    },
    onSuccess: (summary) => {
      for (const key of PLANNER_CLEANUP_INVALIDATION_KEYS) {
        qc.invalidateQueries({ queryKey: key });
      }
      const removed = (summary?.incomeEntriesDeleted || 0) + (summary?.transactionsDeleted || 0);
      const skipped = summary?.skippedNotSafe || 0;
      if (removed > 0 || skipped > 0) {
        toast.success(
          `Stream deleted. Removed ${removed} planner-created ledger ${removed === 1 ? "entry" : "entries"}` +
            (skipped > 0 ? `, kept ${skipped} edited/linked` : ""),
        );
      } else {
        toast.success("Income stream deleted");
      }
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
      // Remove any safe planner-created ledger row for this bonus first.
      const summary = await cleanupConvertedLedgerForBonus(id);
      const { error } = await supabase
        .from("projected_bonus_events")
        .delete()
        .eq("id", id);
      if (error) throw error;
      return summary;
    },
    onSuccess: (summary) => {
      for (const key of PLANNER_CLEANUP_INVALIDATION_KEYS) {
        qc.invalidateQueries({ queryKey: key });
      }
      const removed = (summary?.incomeEntriesDeleted || 0) + (summary?.transactionsDeleted || 0);
      toast.success(
        removed > 0
          ? `Bonus deleted. Removed ${removed} planner-created ledger ${removed === 1 ? "entry" : "entries"}`
          : "Bonus event deleted",
      );
    },
    onError: (e) => toast.error(e.message),
  });
}

export function useUpdateBonus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: {
      id: string;
      name?: string;
      amount?: number;
      taxes_withheld?: number;
      scheduled_date?: string;
      frequency?: string;
    }) => {
      const { id, ...patch } = args;
      const { error } = await supabase
        .from("projected_bonus_events")
        .update(patch)
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["projected_bonus_events"] });
      toast.success("Bonus updated");
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
      new_date?: string | null;
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
        new_date: override.new_date ?? null,
      });
      if (error) throw error;
      // If user skipped a single occurrence, remove any planner-created
      // ledger row created for it so false "actual" income doesn't remain.
      let cleanupSummary = null;
      if (override.action === "skip") {
        cleanupSummary = await cleanupConvertedLedgerForOccurrence({
          streamId: override.stream_id,
          occurrenceDate: override.override_date,
        });
      }
      return cleanupSummary;
    },
    onSuccess: (summary) => {
      for (const key of PLANNER_CLEANUP_INVALIDATION_KEYS) {
        qc.invalidateQueries({ queryKey: key });
      }
      const removed = (summary?.incomeEntriesDeleted || 0) + (summary?.transactionsDeleted || 0);
      toast.success(
        removed > 0
          ? `Skipped. Removed ${removed} planner-created ledger ${removed === 1 ? "entry" : "entries"}`
          : "Override saved",
      );
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
  plannerConversions?: PlannerConversionRef[],
  businessTransactions?: MatchableBusinessTransaction[],
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

  // Index planner conversions so we can mark occurrences as "converted".
  // Tracks both per-stream/date paycheck conversions and per-bonus-event conversions.
  const convertedKeys = new Set<string>();
  const convertedBonusIds = new Set<string>();
  if (plannerConversions) {
    for (const c of plannerConversions) {
      if (c.status !== "converted") continue;
      if (c.bonus_event_id) convertedBonusIds.add(c.bonus_event_id);
      else if (c.stream_id) convertedKeys.add(`${c.stream_id}:${c.occurrence_date}`);
    }
  }

  // Track which ledger rows have been used for matching (separate sets per bucket)
  const usedEntryIds = new Set<string>();
  const usedTxIds = new Set<string>();

  // Collect all raw paychecks first (without matching)
  const rawPaychecks: Array<{
    date: string;
    grossAmount: number;
    taxesWithheld: number;
    retirement401k: number;
    preTaxDeductions: number;
    healthcareDeduction: number;
    hsaContribution: number;
    type: "paycheck" | "bonus";
    label: string;
    streamId: string;
    isSkipped: boolean;
    isModified: boolean;
    streamCompanyType?: string;
    streamSourceId?: string | null;
    bonusEventId?: string;
  }> = [];

  for (const stream of streams) {
    if (!stream.is_active || !stream.include_in_tax) continue;
    if (isStreamExpired(stream)) continue;

    const start = parseISO(stream.start_date);

    // One-time / single
    if (stream.pay_frequency === "single") {
      if (!isAfter(start, yearEnd) && !isBefore(start, yearStart)) {
        const dateStr = format(start, "yyyy-MM-dd");
        const override = overrideMap.get(`${stream.id}:${dateStr}`);
        if (override?.action === "skip") {
          rawPaychecks.push({
            date: dateStr, grossAmount: stream.paycheck_amount,
            taxesWithheld: stream.taxes_withheld, retirement401k: stream.retirement_401k,
            preTaxDeductions: stream.pre_tax_deductions,
            healthcareDeduction: stream.healthcare_deduction || 0,
            hsaContribution: stream.hsa_contribution || 0,
            type: "paycheck", label: stream.company, streamId: stream.id,
            isSkipped: true, isModified: false, streamCompanyType: stream.company_type, streamSourceId: stream.source_id,
          });
        } else {
          const amt = override?.action === "modify" ? override.paycheck_amount : stream.paycheck_amount;
          const tax = override?.action === "modify" ? override.taxes_withheld : stream.taxes_withheld;
          const ret = override?.action === "modify" ? override.retirement_401k : stream.retirement_401k;
          const ded = override?.action === "modify" ? override.pre_tax_deductions : stream.pre_tax_deductions;
          const displayDate = override?.action === "modify" && override.new_date ? override.new_date : dateStr;
          rawPaychecks.push({
            date: displayDate, grossAmount: amt, taxesWithheld: tax, retirement401k: ret, preTaxDeductions: ded,
            healthcareDeduction: stream.healthcare_deduction || 0,
            hsaContribution: stream.hsa_contribution || 0,
            type: "paycheck", label: stream.company, streamId: stream.id,
            isSkipped: false, isModified: override?.action === "modify", streamCompanyType: stream.company_type, streamSourceId: stream.source_id,
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
          healthcareDeduction: stream.healthcare_deduction || 0,
            hsaContribution: stream.hsa_contribution || 0,
          type: "paycheck", label: stream.company, streamId: stream.id,
          isSkipped: true, isModified: false, streamCompanyType: stream.company_type, streamSourceId: stream.source_id,
        });
      } else {
        const amt = override?.action === "modify" ? override.paycheck_amount : stream.paycheck_amount;
        const tax = override?.action === "modify" ? override.taxes_withheld : stream.taxes_withheld;
        const ret = override?.action === "modify" ? override.retirement_401k : stream.retirement_401k;
        const ded = override?.action === "modify" ? override.pre_tax_deductions : stream.pre_tax_deductions;
        const displayDate = override?.action === "modify" && override.new_date ? override.new_date : dateStr;
        rawPaychecks.push({
          date: displayDate, grossAmount: amt, taxesWithheld: tax, retirement401k: ret, preTaxDeductions: ded,
          healthcareDeduction: stream.healthcare_deduction || 0,
            hsaContribution: stream.hsa_contribution || 0,
          type: "paycheck", label: stream.company, streamId: stream.id,
          isSkipped: false, isModified: override?.action === "modify", streamCompanyType: stream.company_type, streamSourceId: stream.source_id,
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
        healthcareDeduction: 0,
        hsaContribution: 0,
        type: "bonus",
        label: `${bonus.name} (${stream?.company || "Bonus"})`,
        streamId: bonus.stream_id,
        bonusEventId: bonus.id,
        isSkipped: false, isModified: false, streamCompanyType: stream?.company_type, streamSourceId: stream?.source_id ?? null,
      });
    }
  }

  // Sort by date for matching priority
  rawPaychecks.sort((a, b) => a.date.localeCompare(b.date));

  // Now match each paycheck against actual ledger rows. Personal streams match
  // against income_entries; business streams match against transactions
  // (transaction_type='income', status='active').
  const entries = incomeEntries || [];
  const businessTxs = businessTransactions || [];

  for (const raw of rawPaychecks) {
    const net = raw.grossAmount - raw.taxesWithheld - raw.retirement401k - raw.preTaxDeductions - raw.healthcareDeduction;

    if (raw.isSkipped) {
      paychecks.push({ ...raw, netAmount: 0, matchStatus: "skipped" });
      continue;
    }

    // Auto-converted by the planner → ledger bridge: tag as "converted".
    const isBonusConverted = raw.bonusEventId && convertedBonusIds.has(raw.bonusEventId);
    const isPaycheckConverted = !raw.bonusEventId && convertedKeys.has(`${raw.streamId}:${raw.date}`);
    if (isBonusConverted || isPaycheckConverted) {
      paychecks.push({ ...raw, netAmount: Math.max(0, net), matchStatus: "converted" });
      continue;
    }

    const bucket = isBusinessIncomeType(raw.streamCompanyType) ? "business" : "personal";

    if (bucket === "business") {
      const m = findMatchingBusinessTransaction(
        { date: raw.date, grossAmount: raw.grossAmount, label: raw.label, streamSourceId: raw.streamSourceId },
        businessTxs,
        usedTxIds,
      );
      if (m) {
        usedTxIds.add(m.tx.id);
        const hasStoredLink =
          m.tx.origin_type === "planner_converted" || Boolean(m.tx.origin_planner_conversion_id);
        paychecks.push({
          ...raw,
          netAmount: Math.max(0, net),
          matchStatus: hasStoredLink ? "matched" : "suggested",
          ...(hasStoredLink
            ? { matchedIncomeId: m.tx.id, matchedAmount: Number(m.tx.amount) }
            : {
                suggestedTransactionId: m.tx.id,
                suggestedBucket: "business" as const,
                suggestedAmount: Number(m.tx.amount),
              }),
        });
        continue;
      }
    } else {
      const match = findMatchingIncome(
        { date: raw.date, grossAmount: raw.grossAmount, label: raw.label, streamCompanyType: raw.streamCompanyType, streamSourceId: raw.streamSourceId },
        entries,
        usedEntryIds,
      );
      if (match) {
        usedEntryIds.add(match.entry.id);
        const hasStoredLink =
          match.entry.entry_kind === "planner_conversion" ||
          Boolean(match.entry.origin_planner_conversion_id);
        paychecks.push({
          ...raw,
          netAmount: Math.max(0, net),
          matchStatus: hasStoredLink ? "matched" : "suggested",
          ...(hasStoredLink
            ? { matchedIncomeId: match.entry.id, matchedAmount: Number(match.entry.paycheck_amount) }
            : {
                suggestedIncomeId: match.entry.id,
                suggestedBucket: "personal" as const,
                suggestedAmount: Number(match.entry.paycheck_amount),
              }),
        });
        continue;
      }
    }

    const pDate = parseISO(raw.date);
    const isPastDue = isBefore(pDate, now) && !isSameDay(pDate, now);
    paychecks.push({ ...raw, netAmount: Math.max(0, net), matchStatus: isPastDue ? "past_due" : "active" });
  }

  return paychecks.sort((a, b) => a.date.localeCompare(b.date));
}

/* ─── Aggregate projected totals ─── */

/** Classify a stream's company_type into a tax bucket. */
function classifyStreamType(companyType?: string): "w2" | "se" | "other" {
  const t = (companyType || "").toLowerCase().trim();
  if (t === "w2" || t === "w2_user" || t === "w2_partner" || t === "scorp_w2") return "w2";
  if (
    t === "1099" ||
    t === "1099_schedule_c" ||
    t === "k1" ||
    t === "k1_partnership"
  ) return "se";
  // scorp_distribution, other → "other" (taxable but not SE)
  return "other";
}

/**
 * Only counts "active" (future, unmatched) paychecks — never matched, skipped, or past_due.
 *
 * Returns income split by tax type AND withholding split by federal/state so the
 * tax engine can route each piece correctly. Falls back to the aggregate
 * `taxes_withheld` field when per-stream federal/state aren't separated.
 */
export function getProjectedTotals(
  paychecks: ProjectedPaycheck[],
  streams: ProjectedIncomeStream[] = [],
) {
  const streamById = new Map(streams.map((s) => [s.id, s] as const));

  const acc = {
    grossIncome: 0,
    taxesWithheld: 0,        // legacy alias = federal + state
    federalWithheld: 0,
    stateWithheld: 0,
    retirement401k: 0,
    preTaxDeductions: 0,
    healthInsuranceDeduction: 0,
    hsaContribution: 0,
    netIncome: 0,
    count: 0,
    w2Income: 0,
    seIncome: 0,
    otherIncome: 0,
    /** Forecast business expenses summed across active SE paychecks (1099 / K-1 only). */
    forecastBusinessExpenses: 0,
  };

  for (const p of paychecks) {
    // "suggested" is excluded from projected totals just like "matched" to
    // avoid double-counting with the actual income entry that the heuristic
    // pointed at. The UI still labels it "Suggested match" until the user
    // confirms; if they dismiss it, the paycheck flips back to "active".
    if (p.matchStatus !== "active") continue;
    const stream = streamById.get(p.streamId);
    const bucket = classifyStreamType(stream?.company_type ?? p.streamCompanyType);

    // Canonical "Total Federal Payroll Taxes" via shared helper. Treats
    // taxes_withheld as the total when populated, else sums the components.
    // For projected streams written under the new shape, taxes_withheld is
    // the canonical total (federal income tax + SS + Medicare).
    let fed = getTotalFederalPaid(stream as any);
    let st = Number(stream?.state_withholding || 0);
    // Bonuses & legacy streams without per-stream withholdings fall back to
    // the per-paycheck aggregate.
    if (fed === 0 && st === 0) {
      fed = p.taxesWithheld;
    }

    acc.grossIncome += p.grossAmount;
    acc.federalWithheld += fed;
    acc.stateWithheld += st;
    acc.taxesWithheld += fed + st;
    acc.retirement401k += p.retirement401k;
    acc.preTaxDeductions += p.preTaxDeductions;
    acc.healthInsuranceDeduction += p.healthcareDeduction || 0;
    acc.hsaContribution += p.hsaContribution || 0;
    acc.netIncome += p.netAmount;
    acc.count += 1;

    if (bucket === "w2") acc.w2Income += p.grossAmount;
    else if (bucket === "se") {
      acc.seIncome += p.grossAmount;
      // Only SE (1099 / K-1 / Schedule C) streams contribute forecast expenses.
      // Paychecks count toward the assumption only while still "active" — past_due,
      // matched, suggested, skipped, and converted occurrences are excluded so
      // actual transactions own the expense side post-conversion.
      // Bonuses don't have an associated stream forecast expense in the model,
      // so when stream is missing we contribute 0.
      if (stream && p.type === "paycheck") {
        acc.forecastBusinessExpenses += Math.max(0, Number(stream.forecast_expense_per_period) || 0);
      }
    }
    else acc.otherIncome += p.grossAmount;
  }

  return acc;
}

/**
 * Source-of-truth for planner-side monthly breakdown. Use everywhere the
 * Income Planner monthly totals are surfaced (Dashboard "Monthly Income"
 * chart and the Income Planner accordion).
 *
 * `plannedIncome` is the only value that should feed the chart's "Planned"
 * segment — it excludes converted, matched/suggested, skipped, and past_due
 * occurrences so we never double count with the ledger.
 */
export interface MonthlyPlannerBreakdown {
  month: number;
  unconvertedPlannerIncome: number;
  convertedPlannerIncome: number;
  matchedPlannerIncome: number;
  skippedPlannerIncome: number;
  pastDuePlannerIncome: number;
  /** Single source-of-truth for the chart's "Planned" segment. */
  plannedIncome: number;
}

export function getMonthlyPlannerBreakdown(
  paychecks: ProjectedPaycheck[],
  year: number,
): MonthlyPlannerBreakdown[] {
  const months: MonthlyPlannerBreakdown[] = Array.from({ length: 12 }, (_, m) => ({
    month: m,
    unconvertedPlannerIncome: 0,
    convertedPlannerIncome: 0,
    matchedPlannerIncome: 0,
    skippedPlannerIncome: 0,
    pastDuePlannerIncome: 0,
    plannedIncome: 0,
  }));
  for (const p of paychecks) {
    const [y, mm] = p.date.split("-");
    if (parseInt(y, 10) !== year) continue;
    const m = parseInt(mm, 10) - 1;
    if (m < 0 || m > 11) continue;
    const amt = Number(p.grossAmount || 0);
    switch (p.matchStatus) {
      case "active":
        months[m].unconvertedPlannerIncome += amt;
        months[m].plannedIncome += amt;
        break;
      case "converted":
        months[m].convertedPlannerIncome += amt;
        break;
      case "matched":
      case "suggested":
        months[m].matchedPlannerIncome += amt;
        break;
      case "skipped":
        months[m].skippedPlannerIncome += amt;
        break;
      case "past_due":
        months[m].pastDuePlannerIncome += amt;
        break;
    }
  }
  return months;
}
