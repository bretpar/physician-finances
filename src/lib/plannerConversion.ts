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
import { getTodayLocalDateString } from "@/lib/localDate";

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
  /** Per-occurrence audit log — useful for the dev/admin debug surface. */
  audit?: Array<{
    streamId: string;
    company: string;
    date: string;
    matchStatus: string;
    decision: "converted" | "duplicate" | "exists" | "error" | "skipped_future" | "skipped_matched";
    bucket?: "personal" | "business";
    error?: string;
  }>;
}

const LAST_RUN_KEY = "planner_conversion_last_result";

/** Persist a small "last run" snapshot so Settings/admin can show it. */
function persistLastRun(result: ConversionRunResult) {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(
      LAST_RUN_KEY,
      JSON.stringify({ at: new Date().toISOString(), ...result }),
    );
  } catch { /* ignore */ }
}

export function getLastPlannerConversionRun():
  | (ConversionRunResult & { at: string })
  | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(LAST_RUN_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
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
    audit: [],
  };

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    persistLastRun(stats);
    return stats;
  }

  // Load every input that generateProjectedPaychecks needs to make accurate
  // decisions: streams, bonuses, overrides, prior planner_conversions (so
  // already-converted occurrences are tagged "converted" and skipped),
  // personal income_entries (W-2 matching), and active business income
  // transactions (1099/K-1 matching).
  const [streamsRes, bonusesRes, overridesRes, incomeRes, conversionsRes, businessTxRes, settingsRes] =
    await Promise.all([
      supabase.from("projected_income_streams").select("*"),
      supabase.from("projected_bonus_events").select("*"),
      supabase.from("projected_income_overrides").select("*"),
      supabase
        .from("income_entries")
        .select("id, income_date, company, paycheck_amount, income_type, status, source_id, origin_planner_conversion_id, entry_kind"),
      supabase
        .from("planner_conversions")
        .select("stream_id, bonus_event_id, occurrence_date, status"),
      supabase
        .from("transactions")
        .select("id, transaction_date, vendor, amount, source_id, status, transaction_type, origin_type, origin_planner_conversion_id, excluded_from_reports, category")
        .eq("transaction_type", "income")
        .eq("status", "active"),
      supabase
        .from("tax_settings")
        .select("auto_convert_future_income_to_ledger, organization_id")
        .limit(1)
        .maybeSingle(),
    ]);

  const settings = settingsRes.data as { auto_convert_future_income_to_ledger?: boolean; organization_id?: string | null } | null;
  if (!settings?.auto_convert_future_income_to_ledger) {
    persistLastRun(stats);
    return stats;
  }

  const streams = (streamsRes.data || []) as ProjectedIncomeStream[];
  const bonuses = (bonusesRes.data || []) as ProjectedBonusEvent[];
  const overrides = (overridesRes.data || []) as ProjectedIncomeOverride[];
  const incomeEntries = (incomeRes.data || []) as MatchableIncomeEntry[];
  const plannerConversions = (conversionsRes.data || []) as PlannerConversionRow[];
  // Strip personal/transfer/excluded rows so business matching only sees real
  // business income (mirrors useTaxEstimate's canonical filter).
  const businessTxs: MatchableBusinessTransaction[] = (businessTxRes.data || [])
    .filter((t: any) =>
      t.transaction_type === "income" &&
      t.status === "active" &&
      t.excluded_from_reports !== true &&
      (t.category || "") !== "Personal",
    )
    .map((t: any) => ({
      id: t.id,
      transaction_date: t.transaction_date,
      vendor: t.vendor || "",
      amount: Number(t.amount) || 0,
      source_id: t.source_id ?? null,
      status: t.status,
      transaction_type: t.transaction_type,
      origin_type: t.origin_type ?? null,
      origin_planner_conversion_id: t.origin_planner_conversion_id ?? null,
    }));

  const paychecks = generateProjectedPaychecks(
    streams,
    bonuses,
    incomeEntries,
    overrides,
    plannerConversions as any,
    businessTxs,
  );
  // Use the user's local calendar date (West Coast default) so a paycheck
  // dated 5/16 doesn't get converted late on 5/15 just because UTC has
  // already rolled over.
  const today = getTodayLocalDateString();

  const streamById = new Map(streams.map((s) => [s.id, s] as const));
  const bonusByKey = new Map<string, ProjectedBonusEvent>();
  for (const b of bonuses) {
    bonusByKey.set(`${b.stream_id}:${b.scheduled_date}`, b);
  }

  for (const p of paychecks) {
    const stream = streamById.get(p.streamId);
    const company = stream?.company || p.label || "(unknown)";

    if (p.date > today) {
      stats.audit!.push({ streamId: p.streamId, company, date: p.date, matchStatus: p.matchStatus, decision: "skipped_future" });
      continue;
    }
    // Skip anything we should not re-convert: already matched to actual,
    // user-skipped, already converted, or with a heuristic suggested match
    // pending review (avoid creating a duplicate of the suggested ledger row).
    if (
      p.matchStatus === "matched" ||
      p.matchStatus === "skipped" ||
      p.matchStatus === "converted" ||
      p.matchStatus === "suggested"
    ) {
      stats.audit!.push({ streamId: p.streamId, company, date: p.date, matchStatus: p.matchStatus, decision: "skipped_matched" });
      continue;
    }

    if (!stream) continue;

    const bonus = p.type === "bonus" ? bonusByKey.get(`${p.streamId}:${p.date}`) : undefined;

    stats.attempted++;
    let result: "converted" | "duplicate" | "exists" | "error" = "error";
    try {
      result = await convertOne({
        userId: user.id,
        organizationId: stream.organization_id ?? settings.organization_id ?? null,
        paycheck: p,
        stream,
        bonusEventId: bonus?.id ?? null,
      });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("[plannerConversion] convertOne threw", { stream: stream.id, date: p.date, err });
      stats.audit!.push({
        streamId: p.streamId, company, date: p.date, matchStatus: p.matchStatus,
        decision: "error", error: (err as Error).message,
      });
      stats.errors++;
      continue;
    }

    const bucket: "personal" | "business" = isBusinessIncomeType(stream.company_type) ? "business" : "personal";
    stats.audit!.push({ streamId: p.streamId, company, date: p.date, matchStatus: p.matchStatus, decision: result, bucket });

    if (result === "converted") stats.converted++;
    else if (result === "duplicate") stats.duplicateSkipped++;
    else if (result === "exists") stats.alreadyConverted++;
    else stats.errors++;
  }

  persistLastRun(stats);

  if (typeof window !== "undefined" && (import.meta as any).env?.DEV) {
    // eslint-disable-next-line no-console
    console.groupCollapsed(
      `[plannerConversion] run @ ${new Date().toISOString()} — attempted=${stats.attempted} converted=${stats.converted} dup=${stats.duplicateSkipped} exists=${stats.alreadyConverted} errors=${stats.errors}`,
    );
    // eslint-disable-next-line no-console
    console.table(stats.audit);
    // eslint-disable-next-line no-console
    console.groupEnd();
  }

  return stats;
}
