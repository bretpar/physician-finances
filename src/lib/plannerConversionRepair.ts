/**
 * Safe, idempotent repair for planner-converted W-2 ledger rows that were
 * written with PARENT STREAM withholding instead of the occurrence's own
 * values (bug: plannerConversion.ts wrote `stream.federal_withholding` etc.).
 *
 * Safety rules — a row is only repaired when ALL hold:
 *  1. `origin_type = 'planner_converted'` and it links to a live
 *     `planner_conversions` row with a stream_id + occurrence_date, so the
 *     originating occurrence can be recomputed deterministically.
 *  2. The stored values still equal the STREAM defaults (i.e. untouched by the
 *     bug fix and not edited by the user).
 *  3. The row has not been reviewed/edited (`reviewed_at` null and
 *     `user-edited` markers absent).
 *  4. The recomputed occurrence values actually differ.
 *
 * Anything else is reported as "skipped" and left alone. Running twice is a
 * no-op because after a repair the stored values no longer equal the stream
 * defaults / expected values.
 */

import { supabase } from "@/integrations/supabase/client";
import {
  resolveOccurrenceDetail,
  type ProjectedIncomeStream,
  type ProjectedIncomeOverride,
} from "@/hooks/useProjectedIncome";

const money = (v: unknown) => Math.round(Number(v || 0) * 100) / 100;

export interface RepairCandidateRow {
  id: string;
  company: string | null;
  income_date: string;
  reviewed_at?: string | null;
  federal_withholding: number | null;
  state_withholding: number | null;
  ss_withholding: number | null;
  medicare_withholding: number | null;
  additional_tax_reserve?: number | null;
}

export interface RepairDecision {
  id: string;
  label: string;
  date: string;
  decision: "repair" | "skip";
  reason?: string;
  from?: { federal: number; state: number; ss: number; medicare: number };
  to?: { federal: number; state: number; ss: number; medicare: number };
  patch?: Record<string, number>;
}

/** PURE: decide whether one converted row can be safely repaired. */
export function computeOccurrenceRepair(
  row: RepairCandidateRow,
  stream: Pick<
    ProjectedIncomeStream,
    | "federal_withholding" | "state_withholding" | "ss_withholding" | "medicare_withholding"
    | "healthcare_deduction" | "hsa_contribution" | "additional_tax_reserve"
  >,
  override?: Partial<ProjectedIncomeOverride> | null,
): RepairDecision {
  const base = {
    id: row.id,
    label: row.company || "—",
    date: row.income_date,
    from: {
      federal: money(row.federal_withholding),
      state: money(row.state_withholding),
      ss: money(row.ss_withholding),
      medicare: money(row.medicare_withholding),
    },
  };

  if (row.reviewed_at) {
    return { ...base, decision: "skip", reason: "Already reviewed/edited by the user" };
  }

  const detail = resolveOccurrenceDetail(stream, override);
  if (!detail.hasDetailedBreakdown) {
    return { ...base, decision: "skip", reason: "Occurrence has no detailed breakdown of its own" };
  }

  const streamValues = {
    federal: money(stream.federal_withholding),
    state: money(stream.state_withholding),
    ss: money(stream.ss_withholding),
    medicare: money(stream.medicare_withholding),
  };
  const storedMatchesStream =
    base.from.federal === streamValues.federal &&
    base.from.state === streamValues.state &&
    base.from.ss === streamValues.ss &&
    base.from.medicare === streamValues.medicare;
  if (!storedMatchesStream) {
    return { ...base, decision: "skip", reason: "Stored values differ from the stream default — not a stale write" };
  }

  const to = {
    federal: money(detail.federalWithholding),
    state: money(detail.stateWithholding),
    ss: money(detail.ssWithholding),
    medicare: money(detail.medicareWithholding),
  };
  const unchanged =
    to.federal === base.from.federal &&
    to.state === base.from.state &&
    to.ss === base.from.ss &&
    to.medicare === base.from.medicare;
  if (unchanged) return { ...base, decision: "skip", reason: "Already correct", to };

  return {
    ...base,
    decision: "repair",
    to,
    patch: {
      federal_withholding: to.federal,
      state_withholding: to.state,
      ss_withholding: to.ss,
      medicare_withholding: to.medicare,
      // Total federal payroll taxes stay consistent with the components.
      taxes_withheld: money(to.federal + to.ss + to.medicare),
      additional_tax_reserve: money(detail.additionalTaxReserve),
    },
  };
}

export interface RepairRunResult {
  scanned: number;
  repaired: number;
  skipped: number;
  errors: number;
  decisions: RepairDecision[];
}

/**
 * Scan planner-converted personal income rows and (optionally) apply repairs.
 * `dryRun: true` (default) only reports what WOULD change.
 */
export async function repairPlannerConvertedWithholding(
  opts: { dryRun?: boolean } = {},
): Promise<RepairRunResult> {
  const dryRun = opts.dryRun !== false;
  const result: RepairRunResult = { scanned: 0, repaired: 0, skipped: 0, errors: 0, decisions: [] };

  const { data: rows, error } = await supabase
    .from("income_entries")
    .select(
      "id, company, income_date, reviewed_at, federal_withholding, state_withholding, ss_withholding, medicare_withholding, additional_tax_reserve, origin_planner_conversion_id",
    )
    .eq("origin_type", "planner_converted")
    .eq("source_bucket", "personal");
  if (error) throw error;
  const candidates = (rows || []).filter((r: any) => r.origin_planner_conversion_id);
  result.scanned = candidates.length;
  if (!candidates.length) return result;

  const { data: convs } = await supabase
    .from("planner_conversions")
    .select("id, stream_id, occurrence_date")
    .in("id", candidates.map((r: any) => r.origin_planner_conversion_id));
  const convById = new Map((convs || []).map((c: any) => [c.id, c]));

  const streamIds = Array.from(
    new Set((convs || []).map((c: any) => c.stream_id).filter(Boolean)),
  ) as string[];
  if (!streamIds.length) {
    result.skipped = candidates.length;
    return result;
  }

  const [{ data: streams }, { data: overrides }] = await Promise.all([
    supabase.from("projected_income_streams").select("*").in("id", streamIds),
    supabase.from("projected_income_overrides").select("*").in("stream_id", streamIds),
  ]);
  const streamById = new Map((streams || []).map((s: any) => [s.id, s]));
  const overrideMap = new Map(
    (overrides || []).map((o: any) => [`${o.stream_id}:${o.override_date}`, o]),
  );
  const overrideByNewDate = new Map(
    (overrides || [])
      .filter((o: any) => o.new_date)
      .map((o: any) => [`${o.stream_id}:${o.new_date}`, o]),
  );

  for (const row of candidates as any[]) {
    const conv = convById.get(row.origin_planner_conversion_id);
    const stream = conv?.stream_id ? streamById.get(conv.stream_id) : null;
    if (!conv || !stream) {
      result.skipped++;
      result.decisions.push({
        id: row.id,
        label: row.company || "—",
        date: row.income_date,
        decision: "skip",
        reason: "Originating planner occurrence no longer exists",
      });
      continue;
    }
    const key = `${conv.stream_id}:${conv.occurrence_date}`;
    const override = overrideMap.get(key) || overrideByNewDate.get(key) || null;
    const decision = computeOccurrenceRepair(row, stream, override);
    result.decisions.push(decision);
    if (decision.decision !== "repair") {
      result.skipped++;
      continue;
    }
    if (dryRun) {
      result.repaired++;
      continue;
    }
    const { error: upErr } = await supabase
      .from("income_entries")
      .update(decision.patch as any)
      .eq("id", row.id);
    if (upErr) {
      result.errors++;
      decision.reason = upErr.message;
    } else {
      result.repaired++;
    }
  }

  return result;
}
