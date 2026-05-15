/**
 * Planner → Ledger conversion engine
 *
 * Pure logic for converting due/past-due projected paychecks (and bonus events)
 * into real ledger drafts (income_entries for personal/W-2 income, transactions
 * for business income). All writes are routed through Supabase using the
 * authenticated user's RLS context.
 *
 * Idempotency is enforced server-side by `planner_conversions` unique
 * constraints on (stream_id, occurrence_date) and (bonus_event_id).
 *
 * Every converted ledger row is marked Needs Review and tagged with
 * `origin_type = 'planner_converted'` so the UI can badge / filter it.
 */

import { supabase } from "@/integrations/supabase/client";
import { ledgerForIncomeType, isBusinessIncomeType } from "@/lib/ledgerRouting";
import {
  generateProjectedPaychecks,
  type ProjectedIncomeStream,
  type ProjectedBonusEvent,
  type ProjectedIncomeOverride,
  type MatchableIncomeEntry,
  type MatchableBusinessTransaction,
  type ProjectedPaycheck,
} from "@/hooks/useProjectedIncome";
import { toCanonicalIncomeType } from "@/lib/filingTypes";

interface PlannerConversionRow {
  stream_id: string | null;
  bonus_event_id: string | null;
  occurrence_date: string;
  status: string;
}

export interface ConversionRunResult {
  attempted: number;
  converted: number;
  duplicateSkipped: number;
  alreadyConverted: number;
  errors: number;
}

/** Resolve the income_type to store in ledger from the stream's company_type. */
function resolveIncomeType(streamCompanyType: string | undefined): string {
  return toCanonicalIncomeType(streamCompanyType || "w2");
}

/**
 * Look for a likely existing ledger row that would duplicate this conversion.
 * Signals: same source_id (or company name), same amount (±$1), date within ±3 days.
 */
async function findDuplicate(
  bucket: "personal" | "business",
  params: {
    sourceId: string | null;
    company: string;
    amount: number;
    date: string;
  },
): Promise<boolean> {
  const minDate = new Date(params.date);
  minDate.setDate(minDate.getDate() - 3);
  const maxDate = new Date(params.date);
  maxDate.setDate(maxDate.getDate() + 3);
  const minStr = minDate.toISOString().slice(0, 10);
  const maxStr = maxDate.toISOString().slice(0, 10);

  if (bucket === "personal") {
    let q = supabase
      .from("income_entries")
      .select("id, paycheck_amount, source_id, company")
      .gte("income_date", minStr)
      .lte("income_date", maxStr)
      .eq("source_bucket", "personal")
      .eq("is_actual", true);
    if (params.sourceId) q = q.eq("source_id", params.sourceId);
    const { data } = await q;
    return (data || []).some((r) => {
      const matchesCompany = params.sourceId
        ? true
        : (r as any).company?.toLowerCase() === params.company.toLowerCase();
      return (
        matchesCompany &&
        Math.abs(Number((r as any).paycheck_amount) - params.amount) <= 1
      );
    });
  }

  // business
  let q = supabase
    .from("transactions")
    .select("id, amount, source_id, vendor")
    .gte("transaction_date", minStr)
    .lte("transaction_date", maxStr)
    .eq("status", "active")
    .eq("transaction_type", "income");
  if (params.sourceId) q = q.eq("source_id", params.sourceId);
  const { data } = await q;
  return (data || []).some((r) => {
    const matchesVendor = params.sourceId
      ? true
      : (r as any).vendor?.toLowerCase() === params.company.toLowerCase();
    return matchesVendor && Math.abs(Number((r as any).amount) - params.amount) <= 1;
  });
}

interface ConvertOneArgs {
  userId: string;
  organizationId: string | null;
  paycheck: ProjectedPaycheck;
  stream: ProjectedIncomeStream;
  bonusEventId?: string | null;
}

/** Convert a single paycheck into a ledger row + planner_conversion record. */
async function convertOne(args: ConvertOneArgs): Promise<"converted" | "duplicate" | "exists" | "error"> {
  const { userId, organizationId, paycheck, stream, bonusEventId } = args;
  const incomeType = resolveIncomeType(stream.company_type);
  const bucket = ledgerForIncomeType(incomeType);

  // 1. Pre-check existence in planner_conversions (cheap, avoids RLS no-op insert noise)
  if (bonusEventId) {
    const { data: existing } = await supabase
      .from("planner_conversions")
      .select("id")
      .eq("bonus_event_id", bonusEventId)
      .maybeSingle();
    if (existing) return "exists";
  } else {
    const { data: existing } = await supabase
      .from("planner_conversions")
      .select("id")
      .eq("stream_id", stream.id)
      .eq("occurrence_date", paycheck.date)
      .maybeSingle();
    if (existing) return "exists";
  }

  // 2. Duplicate protection — check for an existing real ledger row that looks like this paycheck
  const isDup = await findDuplicate(bucket, {
    sourceId: stream.source_id,
    company: stream.company,
    amount: paycheck.grossAmount,
    date: paycheck.date,
  });

  // 3. Insert planner_conversions FIRST (gives us an id + acquires the unique slot)
  const { data: convRow, error: convErr } = await supabase
    .from("planner_conversions")
    .insert({
      user_id: userId,
      organization_id: organizationId,
      stream_id: bonusEventId ? null : stream.id,
      bonus_event_id: bonusEventId ?? null,
      occurrence_date: paycheck.date,
      ledger_bucket: bucket,
      status: isDup ? "duplicate_skipped" : "converted",
      needs_review_reason: isDup
        ? "Possible duplicate of an existing ledger entry"
        : "Auto-converted from planner — please review actual amount and withholdings",
    })
    .select("id")
    .single();

  if (convErr) {
    // Unique violation = race; treat as already-exists
    if ((convErr as any).code === "23505") return "exists";
    console.error("planner_conversions insert error", convErr);
    return "error";
  }

  if (isDup) return "duplicate";

  const conversionId = (convRow as { id: string }).id;

  // 4. Create the ledger row
  if (bucket === "personal") {
    const { data: ie, error } = await supabase
      .from("income_entries")
      .insert({
        user_id: userId,
        organization_id: organizationId,
        name: stream.company || paycheck.label,
        company: stream.company || paycheck.label,
        source_id: stream.source_id,
        income_type: incomeType,
        ui_income_subtype: stream.ui_income_subtype ?? incomeType,
        income_date: paycheck.date,
        gross_amount: paycheck.grossAmount,
        paycheck_amount: paycheck.grossAmount,
        federal_withholding: stream.federal_withholding || 0,
        state_withholding: stream.state_withholding || 0,
        ss_withholding: stream.ss_withholding || 0,
        medicare_withholding: stream.medicare_withholding || 0,
        taxes_withheld: paycheck.taxesWithheld || 0,
        pre_tax_deductions: paycheck.preTaxDeductions || 0,
        retirement_401k: paycheck.retirement401k || 0,
        healthcare_deduction: paycheck.healthcareDeduction || 0,
        hsa_contribution: paycheck.hsaContribution || 0,
        source_bucket: "personal",
        tax_category: "ordinary",
        is_actual: true,
        include_in_tax_estimate: true,
        include_in_cash_flow: false,
        status: "received",
        notes: `From planner${paycheck.type === "bonus" ? " (bonus)" : ""}`,
        origin_type: "planner_converted",
        origin_planner_conversion_id: conversionId,
      } as any)
      .select("id")
      .single();
    if (error) {
      console.error("income_entries insert error", error);
      // Roll back the conversion record so we can retry next run.
      await supabase.from("planner_conversions").delete().eq("id", conversionId);
      return "error";
    }
    await supabase
      .from("planner_conversions")
      .update({ income_entry_id: (ie as { id: string }).id })
      .eq("id", conversionId);
    return "converted";
  }

  // business → transactions
  const { data: tx, error } = await supabase
    .from("transactions")
    .insert({
      user_id: userId,
      organization_id: organizationId,
      transaction_date: paycheck.date,
      vendor: stream.company || paycheck.label,
      amount: paycheck.grossAmount,
      account_source: "Planner",
      category: "Income",
      notes: `From planner${paycheck.type === "bonus" ? " (bonus)" : ""}`,
      entity: stream.company || "Unassigned",
      company_type: incomeType,
      source_id: stream.source_id,
      transaction_type: "income",
      needs_review: true,
      status: "active",
      actual_withholding: paycheck.taxesWithheld || 0,
      origin_type: "planner_converted",
      origin_planner_conversion_id: conversionId,
    } as any)
    .select("id")
    .single();
  if (error) {
    console.error("transactions insert error", error);
    await supabase.from("planner_conversions").delete().eq("id", conversionId);
    return "error";
  }
  await supabase
    .from("planner_conversions")
    .update({ transaction_id: (tx as { id: string }).id })
    .eq("id", conversionId);
  return "converted";
}

/**
 * Run conversion for the currently authenticated user.
 * Caller is responsible for verifying the user toggled this on.
 */
export async function runPlannerConversionForCurrentUser(): Promise<ConversionRunResult> {
  const stats: ConversionRunResult = {
    attempted: 0,
    converted: 0,
    duplicateSkipped: 0,
    alreadyConverted: 0,
    errors: 0,
  };

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return stats;

  // Load streams, bonuses, overrides, actual income (for matching), and the user's settings.
  const [streamsRes, bonusesRes, overridesRes, incomeRes, settingsRes] = await Promise.all([
    supabase.from("projected_income_streams").select("*"),
    supabase.from("projected_bonus_events").select("*"),
    supabase.from("projected_income_overrides").select("*"),
    supabase
      .from("income_entries")
      .select("id, income_date, company, paycheck_amount, income_type, status"),
    supabase
      .from("tax_settings")
      .select("auto_convert_future_income_to_ledger, organization_id")
      .limit(1)
      .maybeSingle(),
  ]);

  const settings = settingsRes.data as { auto_convert_future_income_to_ledger?: boolean; organization_id?: string | null } | null;
  if (!settings?.auto_convert_future_income_to_ledger) return stats;

  const streams = (streamsRes.data || []) as ProjectedIncomeStream[];
  const bonuses = (bonusesRes.data || []) as ProjectedBonusEvent[];
  const overrides = (overridesRes.data || []) as ProjectedIncomeOverride[];
  const incomeEntries = (incomeRes.data || []) as MatchableIncomeEntry[];

  const paychecks = generateProjectedPaychecks(streams, bonuses, incomeEntries, overrides);
  const today = new Date().toISOString().slice(0, 10);

  const streamById = new Map(streams.map((s) => [s.id, s] as const));
  // Map bonus_event_id by stream + scheduled_date so we can attach it to the paycheck.
  const bonusByKey = new Map<string, ProjectedBonusEvent>();
  for (const b of bonuses) {
    bonusByKey.set(`${b.stream_id}:${b.scheduled_date}`, b);
  }

  for (const p of paychecks) {
    // Eligibility: today or earlier, not already matched, not skipped
    if (p.date > today) continue;
    if (p.matchStatus === "matched" || p.matchStatus === "skipped") continue;

    const stream = streamById.get(p.streamId);
    if (!stream) continue;

    const bonus = p.type === "bonus" ? bonusByKey.get(`${p.streamId}:${p.date}`) : undefined;

    stats.attempted++;
    const result = await convertOne({
      userId: user.id,
      organizationId: stream.organization_id ?? settings.organization_id ?? null,
      paycheck: p,
      stream,
      bonusEventId: bonus?.id ?? null,
    });

    if (result === "converted") stats.converted++;
    else if (result === "duplicate") stats.duplicateSkipped++;
    else if (result === "exists") stats.alreadyConverted++;
    else stats.errors++;
  }

  return stats;
}
