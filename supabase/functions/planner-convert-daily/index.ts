// Daily cron-triggered conversion of planner paychecks → real ledger drafts.
//
// Iterates every user that has the auto_convert_future_income_to_ledger flag
// enabled and runs the same logic as the on-demand client fallback, server-side
// using the service role key. Idempotent: the planner_conversions unique
// constraints prevent double-conversion if cron fires more than once per day.
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

interface Stream {
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
  employer_retirement_contribution?: number;
  pre_tax_deductions: number;
  is_active: boolean;
  include_in_tax: boolean;
  source_id: string | null;
  ui_income_subtype: string | null;
  federal_withholding: number;
  state_withholding: number;
  ss_withholding: number;
  medicare_withholding: number;
  healthcare_deduction: number;
  hsa_contribution: number;
  additional_tax_reserve?: number;
}

interface Bonus {
  id: string;
  stream_id: string;
  user_id: string;
  organization_id: string | null;
  name: string;
  amount: number;
  taxes_withheld: number;
  frequency: string;
  scheduled_date: string;
}

interface Override {
  stream_id: string;
  override_date: string;
  action: string;
  paycheck_amount: number;
  taxes_withheld: number;
  retirement_401k: number;
  employer_retirement_contribution?: number;
  pre_tax_deductions: number;
  has_detailed_breakdown?: boolean;
  federal_withholding?: number;
  state_withholding?: number;
  ss_withholding?: number;
  medicare_withholding?: number;
  healthcare_deduction?: number;
  hsa_contribution?: number;
  additional_tax_reserve?: number;
  /** Optional moved date — must match the client's generateProjectedPaychecks
   * behavior so cron and client agree on which calendar date is converted. */
  new_date: string | null;
}

const BUSINESS_TYPES = new Set([
  "1099", "1099_schedule_c", "k1", "k1_partnership", "scorp_distribution",
]);

function isBusinessType(t: string): boolean {
  return BUSINESS_TYPES.has((t || "").toLowerCase().trim());
}

function addDays(d: Date, n: number) { const r = new Date(d); r.setDate(r.getDate() + n); return r; }
function addMonths(d: Date, n: number) { const r = new Date(d); r.setMonth(r.getMonth() + n); return r; }
function ymd(d: Date) { return d.toISOString().slice(0, 10); }
function nextDate(cur: Date, freq: string, custom: number | null) {
  switch (freq) {
    case "weekly": return addDays(cur, 7);
    case "biweekly": return addDays(cur, 14);
    case "monthly": return addMonths(cur, 1);
    case "custom": return addDays(cur, custom || 14);
    default: return addDays(cur, 14);
  }
}

interface OccurrenceRaw {
  date: string;
  amount: number;
  taxesWithheld: number;
  retirement401k: number;
  employerRetirement: number;
  preTaxDeductions: number;
  healthcareDeduction: number;
  hsaContribution: number;
  federalWithholding: number;
  stateWithholding: number;
  ssWithholding: number;
  medicareWithholding: number;
  additionalTaxReserve: number;
  hasDetailedBreakdown: boolean;
  stateSeparate: boolean;
  type: "paycheck" | "bonus";
  streamId: string;
  bonusId: string | null;
  isSkipped: boolean;
}

// ── Mirrors src/hooks/useProjectedIncome.ts resolveOccurrenceDetail and
// src/lib/plannerOccurrenceLedger.ts (splitStreamTax, buildOccurrenceLedgerFields).
// Edge runtime cannot import app code; keep these in sync.
const num = (v: unknown) => Number(v || 0);
function splitStreamTax(s: Stream) {
  const agg = num(s.taxes_withheld);
  const payroll = num(s.federal_withholding) + num(s.ss_withholding) + num(s.medicare_withholding);
  const state = num(s.state_withholding);
  const near = (a: number, b: number) => Math.abs(a - b) < 0.005;
  if (payroll + state > 0 && (near(agg, payroll) || near(agg, payroll + state))) {
    return { taxesWithheld: Math.round(payroll * 100) / 100, stateSeparate: true };
  }
  return { taxesWithheld: agg, stateSeparate: false };
}
function resolveOccurrence(s: Stream, ov: Override | undefined, date: string) {
  const modified = ov?.action === "modify";
  const detailed = modified && !!ov!.has_detailed_breakdown;
  const snapshot = modified && (detailed || [
    ov!.federal_withholding, ov!.state_withholding, ov!.ss_withholding, ov!.medicare_withholding,
    ov!.healthcare_deduction, ov!.hsa_contribution, ov!.additional_tax_reserve,
  ].some((v) => num(v) > 0));
  const pick = (o: unknown, sv: unknown) => num(snapshot ? o : sv);
  const tax = modified
    ? { taxesWithheld: num(ov!.taxes_withheld), stateSeparate: snapshot }
    : splitStreamTax(s);
  return {
    date: modified && ov!.new_date ? ov!.new_date : date,
    amount: modified ? num(ov!.paycheck_amount) : num(s.paycheck_amount),
    taxesWithheld: tax.taxesWithheld,
    stateSeparate: tax.stateSeparate,
    retirement401k: modified ? num(ov!.retirement_401k) : num(s.retirement_401k),
    employerRetirement: modified ? num(ov!.employer_retirement_contribution) : num(s.employer_retirement_contribution),
    preTaxDeductions: modified ? num(ov!.pre_tax_deductions) : num(s.pre_tax_deductions),
    healthcareDeduction: pick(ov?.healthcare_deduction, s.healthcare_deduction),
    hsaContribution: pick(ov?.hsa_contribution, s.hsa_contribution),
    federalWithholding: pick(ov?.federal_withholding, s.federal_withholding),
    stateWithholding: pick(ov?.state_withholding, s.state_withholding),
    ssWithholding: pick(ov?.ss_withholding, s.ss_withholding),
    medicareWithholding: pick(ov?.medicare_withholding, s.medicare_withholding),
    additionalTaxReserve: pick(ov?.additional_tax_reserve, s.additional_tax_reserve),
    hasDetailedBreakdown: detailed,
    isSkipped: ov?.action === "skip",
  };
}
function ledgerFields(o: OccurrenceRaw, employerReduces: boolean) {
  const healthcare = num(o.healthcareDeduction), hsa = num(o.hsaContribution);
  const rem = num(o.preTaxDeductions) - healthcare - hsa;
  const otherPre = o.hasDetailedBreakdown ? (rem > 0 ? Math.round(rem * 100) / 100 : 0) : num(o.preTaxDeductions);
  const gross = num(o.amount), taxes = num(o.taxesWithheld), ret = num(o.retirement401k);
  const deposited = Math.max(0, gross - taxes - (o.stateSeparate ? num(o.stateWithholding) : 0) - otherPre - ret
    - healthcare - hsa - (employerReduces ? num(o.employerRetirement) : 0));
  return {
    gross_amount: gross, paycheck_amount: gross, deposited_amount: deposited,
    federal_withholding: num(o.federalWithholding), state_withholding: num(o.stateWithholding),
    ss_withholding: num(o.ssWithholding), medicare_withholding: num(o.medicareWithholding),
    taxes_withheld: taxes, pre_tax_deductions: otherPre, retirement_401k: ret,
    employer_retirement_contribution: num(o.employerRetirement),
    healthcare_deduction: healthcare, hsa_contribution: hsa,
    additional_tax_reserve: num(o.additionalTaxReserve),
  };
}
// Mirrors resolveEmployerPaycheckReduction: field must be explicitly shown for
// a type that supports it AND the reduces-paycheck flag on (both default OFF).
const EMPLOYER_RET_TYPES = new Set(["1099_schedule_c", "k1_partnership", "scorp_w2", "w2"]);
function normalizeType(raw: string | null | undefined) {
  const v = (raw || "").toLowerCase().trim();
  if (!v) return "1099_schedule_c";
  if (v === "1099") return "1099_schedule_c";
  if (v === "w2" || v === "w2_user" || v === "w2_partner") return "w2";
  if (v === "k1") return "k1_partnership";
  return v;
}

function generateOccurrences(
  streams: Stream[],
  bonuses: Bonus[],
  overrides: Override[],
  todayStr: string,
): OccurrenceRaw[] {
  const overrideMap = new Map<string, Override>();
  for (const o of overrides) overrideMap.set(`${o.stream_id}:${o.override_date}`, o);
  const out: OccurrenceRaw[] = [];
  const today = new Date(todayStr + "T00:00:00");
  const yearStart = new Date(today.getFullYear() + "-01-01T00:00:00");

  for (const s of streams) {
    if (!s.is_active || !s.include_in_tax) continue;
    const start = new Date(s.start_date + "T00:00:00");
    const end = s.end_date ? new Date(s.end_date + "T00:00:00") : today;

    if (s.pay_frequency === "single") {
      if (start <= today) {
        const dStr = ymd(start);
        const r = resolveOccurrence(s, overrideMap.get(`${s.id}:${dStr}`), dStr);
        out.push({ ...r, type: "paycheck", streamId: s.id, bonusId: null });
      }
      continue;
    }

    let cur = start;
    const effectiveStart = start < yearStart ? yearStart : start;
    while (cur < effectiveStart) cur = nextDate(cur, s.pay_frequency, s.custom_interval_days);
    while (cur <= end && cur <= today) {
      const dStr = ymd(cur);
      const r = resolveOccurrence(s, overrideMap.get(`${s.id}:${dStr}`), dStr);
      out.push({ ...r, type: "paycheck", streamId: s.id, bonusId: null });
      cur = nextDate(cur, s.pay_frequency, s.custom_interval_days);
    }
  }

  for (const b of bonuses) {
    const s = streams.find((x) => x.id === b.stream_id);
    if (!s?.is_active) continue;
    const base = new Date(b.scheduled_date + "T00:00:00");
    const dates: Date[] = [];
    if (b.frequency === "one-time" || b.frequency === "annual") {
      if (base <= today) dates.push(base);
    } else if (b.frequency === "quarterly") {
      let d = base;
      while (d <= today) { dates.push(d); d = addMonths(d, 3); }
    }
    for (const d of dates) {
      out.push({
        date: ymd(d), amount: b.amount, taxesWithheld: b.taxes_withheld,
        retirement401k: 0, employerRetirement: 0, preTaxDeductions: 0, healthcareDeduction: 0, hsaContribution: 0,
        federalWithholding: 0, stateWithholding: 0, ssWithholding: 0, medicareWithholding: 0,
        additionalTaxReserve: 0, hasDetailedBreakdown: false, stateSeparate: false,
        type: "bonus", streamId: b.stream_id, bonusId: b.id, isSkipped: false,
      });
    }
  }
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  // Authenticate via shared CRON secret. Without this, anyone could trigger
  // financial-data writes for every opted-in user.
  const cronSecret = Deno.env.get("CRON_SECRET");
  const provided =
    req.headers.get("x-cron-secret") ||
    (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!cronSecret || provided !== cronSecret) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const url = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(url, serviceKey);

  // Find every user with the toggle ON.
  const { data: optedIn, error: settingsErr } = await admin
    .from("tax_settings")
    .select("user_id, organization_id, timezone")
    .eq("auto_convert_future_income_to_ledger", true);
  if (settingsErr) {
    console.error("planner-convert-daily settings error", settingsErr);
    return new Response(JSON.stringify({ error: "Internal error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Helper: compute YYYY-MM-DD for `now` in the given IANA timezone, with
  // safe fallback to America/Los_Angeles per product spec.
  const todayInTimezone = (tz: string | null | undefined): string => {
    const zone = tz || "America/Los_Angeles";
    try {
      return new Intl.DateTimeFormat("en-CA", {
        timeZone: zone,
        year: "numeric", month: "2-digit", day: "2-digit",
      }).format(new Date());
    } catch {
      return new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/Los_Angeles",
        year: "numeric", month: "2-digit", day: "2-digit",
      }).format(new Date());
    }
  };

  const summary: Record<string, unknown>[] = [];

  for (const row of optedIn || []) {
    const userId = (row as any).user_id as string;
    const orgId = (row as any).organization_id as string | null;
    const userTimezone = (row as any).timezone as string | null;
    const today = todayInTimezone(userTimezone);
    const userStats = { user_id: userId, attempted: 0, converted: 0, duplicate_skipped: 0, exists: 0, errors: 0 };

    const [streamsRes, bonusesRes, overridesRes] = await Promise.all([
      admin.from("projected_income_streams").select("*").eq("user_id", userId),
      admin.from("projected_bonus_events").select("*").eq("user_id", userId),
      admin.from("projected_income_overrides").select("*").eq("user_id", userId),
    ]);
    const streams = (streamsRes.data || []) as Stream[];
    const bonuses = (bonusesRes.data || []) as Bonus[];
    const overrides = (overridesRes.data || []) as Override[];
    const occurrences = generateOccurrences(streams, bonuses, overrides, today);

    const streamById = new Map(streams.map((s) => [s.id, s] as const));
    for (const occ of occurrences) {
      if (occ.isSkipped) continue;
      const stream = streamById.get(occ.streamId);
      if (!stream) continue;
      userStats.attempted++;

      // Idempotency check
      const existsQ = occ.bonusId
        ? admin.from("planner_conversions").select("id").eq("bonus_event_id", occ.bonusId).maybeSingle()
        : admin.from("planner_conversions").select("id").eq("stream_id", stream.id).eq("occurrence_date", occ.date).maybeSingle();
      const { data: existing } = await existsQ;
      if (existing) { userStats.exists++; continue; }

      const incomeType = (stream.company_type || "w2").toLowerCase();
      const isBusiness = isBusinessType(incomeType);
      const bucket = isBusiness ? "business" : "personal";

      // Duplicate protection
      const minDate = ymd(addDays(new Date(occ.date + "T00:00:00"), -3));
      const maxDate = ymd(addDays(new Date(occ.date + "T00:00:00"), 3));
      let dupeFound = false;
      if (bucket === "personal") {
        let q = admin
          .from("income_entries")
          .select("id, paycheck_amount, source_id, company")
          .eq("user_id", userId)
          .eq("source_bucket", "personal")
          .eq("is_actual", true)
          .gte("income_date", minDate)
          .lte("income_date", maxDate);
        if (stream.source_id) q = q.eq("source_id", stream.source_id);
        const { data: dupes } = await q;
        dupeFound = (dupes || []).some((r: any) =>
          (stream.source_id ? true : (r.company || "").toLowerCase() === (stream.company || "").toLowerCase()) &&
          Math.abs(Number(r.paycheck_amount) - occ.amount) <= 1
        );
      } else {
        let q = admin
          .from("transactions")
          .select("id, amount, source_id, vendor")
          .eq("user_id", userId)
          .eq("status", "active")
          .eq("transaction_type", "income")
          .gte("transaction_date", minDate)
          .lte("transaction_date", maxDate);
        if (stream.source_id) q = q.eq("source_id", stream.source_id);
        const { data: dupes } = await q;
        dupeFound = (dupes || []).some((r: any) =>
          (stream.source_id ? true : (r.vendor || "").toLowerCase() === (stream.company || "").toLowerCase()) &&
          Math.abs(Number(r.amount) - occ.amount) <= 1
        );
      }

      const { data: conv, error: convErr } = await admin
        .from("planner_conversions")
        .insert({
          user_id: userId,
          organization_id: stream.organization_id ?? orgId,
          stream_id: occ.bonusId ? null : stream.id,
          bonus_event_id: occ.bonusId,
          occurrence_date: occ.date,
          ledger_bucket: bucket,
          status: dupeFound ? "duplicate_skipped" : "converted",
          needs_review_reason: dupeFound
            ? "Possible duplicate of an existing ledger entry"
            : "Auto-converted from planner — please review actual amount and withholdings",
        })
        .select("id")
        .single();
      if (convErr) {
        if ((convErr as any).code === "23505") { userStats.exists++; continue; }
        userStats.errors++; continue;
      }
      if (dupeFound) { userStats.duplicate_skipped++; continue; }

      const conversionId = (conv as any).id as string;

      // Company "employer retirement reduces my paycheck" — net cash only.
      let employerReduces = false;
      if (stream.source_id && (occ.employerRetirement || 0) > 0) {
        const { data: co } = await admin.from("companies")
          .select("company_type, advanced_field_visibility").eq("id", stream.source_id).maybeSingle();
        const v = ((co as any)?.advanced_field_visibility || {}) as Record<string, boolean>;
        employerReduces = !!(co as any)?.company_type
          && EMPLOYER_RET_TYPES.has(normalizeType((co as any).company_type))
          && v.employer_retirement_contribution === true
          && v.employer_retirement_reduces_paycheck === true;
      }
      const fields = ledgerFields(occ, employerReduces);

      if (bucket === "personal") {
        const { data: ie, error: ieErr } = await admin.from("income_entries").insert({
          user_id: userId,
          organization_id: stream.organization_id ?? orgId,
          name: stream.company,
          company: stream.company,
          source_id: stream.source_id,
          income_type: incomeType,
          ui_income_subtype: stream.ui_income_subtype ?? incomeType,
          income_date: occ.date,
          ...fields,
          source_bucket: "personal",
          tax_category: "ordinary",
          is_actual: true,
          include_in_tax_estimate: true,
          include_in_cash_flow: false,
          status: "received",
          notes: `From planner${occ.type === "bonus" ? " (bonus)" : ""}`,
          origin_type: "planner_converted",
          origin_planner_conversion_id: conversionId,
          needs_review: true,
        }).select("id").single();
        if (ieErr) {
          await admin.from("planner_conversions").delete().eq("id", conversionId);
          userStats.errors++; continue;
        }
        await admin.from("planner_conversions")
          .update({ income_entry_id: (ie as any).id })
          .eq("id", conversionId);
      } else {
        const { data: tx, error: txErr } = await admin.from("transactions").insert({
          user_id: userId,
          organization_id: stream.organization_id ?? orgId,
          transaction_date: occ.date,
          vendor: stream.company,
          amount: occ.amount,
          account_source: "Planner",
          category: "Income",
          notes: `From planner${occ.type === "bonus" ? " (bonus)" : ""}`,
          entity: stream.company || "Unassigned",
          company_type: incomeType,
          source_id: stream.source_id,
          transaction_type: "income",
          needs_review: true,
          status: "active",
          actual_withholding: occ.taxesWithheld,
          origin_type: "planner_converted",
          origin_planner_conversion_id: conversionId,
        }).select("id").single();
        if (txErr) {
          await admin.from("planner_conversions").delete().eq("id", conversionId);
          userStats.errors++; continue;
        }
        const txId = (tx as any).id as string;
        // Linked income-entry mirror (same shape as manual conversion) so
        // employee/employer retirement and owner deductions reach Business
        // Activity. Reuse an existing mirror for this transaction — never two.
        const pre = Number(occ.preTaxDeductions || 0);
        const mirror = {
          name: stream.company, company: stream.company, source_id: stream.source_id,
          income_type: incomeType, ui_income_subtype: stream.ui_income_subtype ?? incomeType,
          income_date: occ.date,
          ...fields,
          source_bucket: "business", tax_category: "ordinary", is_actual: true,
          include_in_tax_estimate: true, include_in_cash_flow: false, status: "received",
          linked_transaction_id: txId, origin_type: "planner_converted",
          origin_planner_conversion_id: conversionId,
        };
        const { data: existingIe } = await admin.from("income_entries")
          .select("id").eq("linked_transaction_id", txId).limit(1).maybeSingle();
        const { error: mErr } = existingIe
          ? await admin.from("income_entries").update(mirror).eq("id", (existingIe as any).id)
          : await admin.from("income_entries").insert({
              user_id: userId, organization_id: stream.organization_id ?? orgId, ...mirror,
              notes: `From planner${occ.type === "bonus" ? " (bonus)" : ""}`,
            });
        if (mErr) console.warn("planner-convert-daily mirror upsert failed", mErr);
        await admin.from("planner_conversions")
          .update({ transaction_id: txId })
          .eq("id", conversionId);
      }
      userStats.converted++;
    }
    summary.push(userStats);
  }

  const totals = summary.reduce<{ users: number; attempted: number; converted: number; duplicate_skipped: number; exists: number; errors: number }>(
    (acc, s: any) => {
      acc.users += 1;
      acc.attempted += s.attempted || 0;
      acc.converted += s.converted || 0;
      acc.duplicate_skipped += s.duplicate_skipped || 0;
      acc.exists += s.exists || 0;
      acc.errors += s.errors || 0;
      return acc;
    },
    { users: 0, attempted: 0, converted: 0, duplicate_skipped: 0, exists: 0, errors: 0 },
  );
  console.log("planner-convert-daily totals", totals);

  return new Response(
    JSON.stringify({
      ok: true,
      ran_at: new Date().toISOString(),
      totals,
      per_user: summary,
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
