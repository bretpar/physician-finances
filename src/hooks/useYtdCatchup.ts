import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { getUserOrgId } from "@/hooks/useOrgId";
import { formatMonthYear } from "@/lib/localDate";

export type YtdCatchupSourceType = "w2" | "1099_k1" | "other";

export interface YtdCatchupEntry {
  id: string;
  user_id: string;
  organization_id: string | null;
  tax_year: number;
  source_type: YtdCatchupSourceType;
  company_id: string | null;
  company_name: string;
  period_start: string;
  period_end: string;
  gross_income: number;
  business_expenses: number;
  federal_withholding: number;
  state_withholding: number;

  ss_withholding: number;
  medicare_withholding: number;
  retirement_401k: number;
  hsa_contribution: number;
  healthcare_premiums: number;
  dental_vision: number;
  other_pretax: number;
  post_tax_deductions: number;
  notes: string;
  created_at: string;
  updated_at: string;
}

export type YtdCatchupInput = Partial<Omit<YtdCatchupEntry, "id" | "user_id" | "organization_id" | "created_at" | "updated_at">>;

const KEY = ["ytd_catchup_entries"] as const;

/** Normalize a company/business name for safe fuzzy matching. */
function normalizeCompanyName(name: string | null | undefined): string {
  return String(name || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Backfill YTD catch-up entries with the right company_id once a
 * matching company exists. Updates:
 *   - ytd_catchup_entries.company_id
 *   - mirrored transactions / income_entries source_id + company/entity
 * Also dedupes mirror rows (keeps the oldest, removes the rest) so repeated
 * onboarding runs don't create duplicate Business Activity entries.
 */
export async function backfillYtdCatchupCompanies(): Promise<void> {
  const { data: entries, error: entriesErr } = await (supabase as any)
    .from("ytd_catchup_entries")
    .select("id, company_id, company_name, source_type, organization_id, user_id");
  if (entriesErr || !entries?.length) return;

  const { data: companies, error: companiesErr } = await supabase
    .from("companies")
    .select("id, name, company_type, organization_id, user_id");
  if (companiesErr || !companies?.length) return;

  // Build a normalized-name -> company[] index, restricted by catch-up type.
  const byNormName = new Map<string, any[]>();
  for (const c of companies as any[]) {
    const key = normalizeCompanyName(c.name);
    if (!key) continue;
    const list = byNormName.get(key) || [];
    list.push(c);
    byNormName.set(key, list);
  }

  for (const entry of entries as any[]) {
    const normEntryName = normalizeCompanyName(entry.company_name);
    if (!normEntryName) continue;
    const allowedTypes = entry.source_type === "w2"
      ? ["w2", "scorp_w2"]
      : entry.source_type === "1099_k1"
        ? ["1099_schedule_c", "k1_partnership", "k1_s_corp", "scorp_distribution"]
        : ["other"];
    const matches = (byNormName.get(normEntryName) || []).filter((c: any) => allowedTypes.includes(String(c.company_type)));
    // Only match when unambiguous and either entry has no company_id yet or
    // currently points at a missing company.
    if (matches.length !== 1) continue;
    const match = matches[0];
    if (entry.company_id === match.id) {
      // Still ensure the mirror row reflects the company.
    } else {
      const { error: updErr } = await (supabase as any)
        .from("ytd_catchup_entries")
        .update({ company_id: match.id })
        .eq("id", entry.id);
      if (updErr) {
        console.warn("[backfillYtdCatchupCompanies] update entry failed", updErr);
        continue;
      }
    }

    // Dedupe + update mirror transactions for this catch-up entry.
    const { data: mirrors } = await (supabase as any)
      .from("transactions")
      .select("id, created_at")
      .eq("origin_ytd_catchup_id", entry.id)
      .order("created_at", { ascending: true });
    const rows = (mirrors || []) as any[];
    const keep = rows[0];
    const dupes = rows.slice(1);
    if (dupes.length > 0) {
      await (supabase as any)
        .from("transactions")
        .delete()
        .in("id", dupes.map((r) => r.id));
    }
    if (keep?.id) {
      await (supabase as any)
        .from("transactions")
        .update({ source_id: match.id, entity: match.name })
        .eq("id", keep.id);
    }

    const { data: incomeMirrors } = await (supabase as any)
      .from("income_entries")
      .select("id, created_at")
      .eq("linked_ytd_catchup_id", entry.id)
      .order("created_at", { ascending: true });
    const incomeRows = (incomeMirrors || []) as any[];
    const keepIncome = incomeRows[0];
    const incomeDupes = incomeRows.slice(1);
    if (incomeDupes.length > 0) {
      await (supabase as any)
        .from("income_entries")
        .delete()
        .in("id", incomeDupes.map((r) => r.id));
    }
    if (keepIncome?.id) {
      await (supabase as any)
        .from("income_entries")
        .update({ source_id: match.id, company: match.name })
        .eq("id", keepIncome.id);
    }
  }
}

/**
 * Sync paired ledger rows for a YTD catch-up entry so the entry shows up
 * in the right ledger:
 *   - 1099_k1 (business)  → one row in `transactions` (Business Activity)
 *   - w2 / other          → one row in `income_entries` (Personal Income)
 *
 * The catch-up entry remains the source of truth for tax math. The mirror
 * rows are flagged so the tax engine does not double-count them:
 *   - business mirror tx has no linked income_entry, so it contributes 0
 *     to canonicalBusiness withholding; the tax engine's overlap safeguard
 *     subtracts overlapping business tx gross from the catch-up gross.
 *   - personal mirror income_entry is created with
 *     `include_in_tax_estimate=false` so it stays out of the personal
 *     tax aggregation; the catch-up's `cu.w2.gross` injection still feeds
 *     the engine. The mirror IS counted in dashboard totals (which read
 *     the unfiltered personal_income_entries query).
 */
async function syncCatchupMirror(args: {
  catchupEntry: YtdCatchupEntry;
  userId: string;
  orgId: string | null;
}) {
  const c = args.catchupEntry;
  const isBusiness = c.source_type === "1099_k1";
  const isW2 = c.source_type === "w2";
  const gross = Math.max(0, Number(c.gross_income) || 0);
  const fedW = Number(c.federal_withholding) || 0;
  const stateW = Number(c.state_withholding) || 0;
  const ssW = Number(c.ss_withholding) || 0;
  const medW = Number(c.medicare_withholding) || 0;
  const r401k = Number(c.retirement_401k) || 0;
  const hsa = Number(c.hsa_contribution) || 0;
  const preTax = (Number(c.healthcare_premiums) || 0)
    + (Number(c.dental_vision) || 0)
    + (Number(c.other_pretax) || 0);
  const postTax = Number(c.post_tax_deductions) || 0;
  const net = Math.max(0, gross - fedW - stateW - ssW - medW - r401k - hsa - preTax - postTax);
  const periodLabel = formatMonthYear(c.period_end) || c.period_end;
  const friendlyName = "YTD Catch-Up Entry";
  const friendlyNote = `Setup income through ${periodLabel}`;

  // ── Business mirror in `transactions` ───────────────────────────────────
  const { data: existingTxRows } = await (supabase as any)
    .from("transactions")
    .select("id, created_at")
    .eq("origin_ytd_catchup_id", c.id)
    .order("created_at", { ascending: true });
  const existingTx = (existingTxRows && existingTxRows[0]) || null;
  // Defensive dedupe — if multiple mirror rows exist, drop the extras.
  if (existingTxRows && existingTxRows.length > 1) {
    await (supabase as any)
      .from("transactions")
      .delete()
      .in("id", existingTxRows.slice(1).map((r: any) => r.id));
  }

  if (isBusiness) {
    const txRow: any = {
      user_id: args.userId,
      organization_id: args.orgId,
      transaction_date: c.period_end,
      vendor: `${friendlyName}: ${c.company_name || "Business"}`,
      amount: gross,
      account_source: "YTD catch-up",
      category: "Income",
      notes: `${friendlyNote}. Edit from the YTD catch-up section.`,
      entity: c.company_name || "Unassigned",
      company_type: "1099_schedule_c",
      source_id: c.company_id,
      transaction_type: "income",
      actual_withholding: fedW + stateW,
      status: "active",
      excluded_from_reports: false,
      needs_review: false,
      user_edited: false,
      origin_type: "ytd_catchup",
      origin_ytd_catchup_id: c.id,
      source_type: "manual",
    };
    if (existingTx?.id) {
      await supabase.from("transactions").update(txRow).eq("id", existingTx.id);
    } else {
      await supabase.from("transactions").insert(txRow);
    }
  } else if (existingTx?.id) {
    // Source type changed away from business → remove stale tx mirror.
    await supabase.from("transactions").delete().eq("id", existingTx.id);
  }

  // ── Personal mirror in `income_entries` (W-2 / other) ───────────────────
  const { data: existingIncome } = await (supabase as any)
    .from("income_entries")
    .select("id")
    .eq("linked_ytd_catchup_id", c.id)
    .maybeSingle();

  if (!isBusiness) {
    const incomeType = isW2 ? "w2_user" : "other_income";
    const incomeRow: any = {
      user_id: args.userId,
      organization_id: args.orgId,
      name: friendlyName,
      company: c.company_name || "",
      source_id: c.company_id,
      income_type: incomeType,
      ui_income_subtype: isW2 ? "w2_user" : "other_income",
      income_date: c.period_end,
      gross_amount: gross,
      paycheck_amount: gross,
      deposited_amount: net,
      federal_withholding: fedW,
      state_withholding: stateW,
      ss_withholding: ssW,
      medicare_withholding: medW,
      taxes_withheld: fedW + stateW + ssW + medW,
      pre_tax_deductions: preTax,
      retirement_401k: r401k,
      hsa_contribution: hsa,
      healthcare_deduction: 0,
      source_bucket: "personal",
      tax_category: "ordinary",
      is_actual: true,
      // CRITICAL: mirror must NOT feed the tax engine — the catch-up entry
      // already contributes via cu.w2/other in useTaxEstimate. Setting this
      // false keeps the mirror out of personalW2 aggregation while still
      // showing it in dashboard totals + the Personal Income ledger.
      include_in_tax_estimate: false,
      include_in_cash_flow: false,
      notes: friendlyNote,
      status: "received",
      origin_type: "ytd_catchup",
      entry_kind: "ytd_catchup",
      linked_ytd_catchup_id: c.id,
    };
    if (existingIncome?.id) {
      await supabase.from("income_entries").update(incomeRow).eq("id", existingIncome.id);
    } else {
      await supabase.from("income_entries").insert(incomeRow);
    }
  } else if (existingIncome?.id) {
    // Source type changed to business → remove stale personal mirror.
    await supabase.from("income_entries").delete().eq("id", existingIncome.id);
  }
}

export function useYtdCatchupEntries() {
  return useQuery({
    queryKey: KEY,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ytd_catchup_entries" as any)
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data || []) as unknown as YtdCatchupEntry[];
    },
  });
}

export function useUpsertYtdCatchup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: YtdCatchupInput & { id?: string }) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");
      const orgId = await getUserOrgId();
      const row: any = {
        ...input,
        user_id: user.id,
        organization_id: orgId,
      };
      // Auto-resolve company_id for 1099/K-1 entries when an unambiguous
      // company already exists with the same normalized name. Prevents
      // "Unassigned" Business Activity rows when the user saves catch-up
      // after creating the company.
      if ((row.source_type === "1099_k1" || row.source_type === "w2") && !row.company_id && row.company_name) {
        const { data: companies } = await supabase
          .from("companies")
          .select("id, name, company_type");
        const normTarget = normalizeCompanyName(row.company_name);
        const allowedTypes = row.source_type === "w2"
          ? ["w2", "scorp_w2"]
          : ["1099_schedule_c", "k1_partnership", "k1_s_corp", "scorp_distribution"];
        const matches = (companies || []).filter((c: any) =>
          allowedTypes.includes(String(c.company_type)) &&
          normalizeCompanyName(c.name) === normTarget,
        );
        if (matches.length === 1) row.company_id = matches[0].id;
      }
      let saved: any;
      let effectiveId = input.id;

      // Idempotency for onboarding-created YTD entries: if no explicit id was
      // passed, look up an existing entry for the same
      // (user_id, tax_year, source_type, normalized company_name) and update
      // it in place instead of inserting a duplicate. This prevents repeated
      // or partial onboarding runs from producing multiple YTD catch-up rows
      // (and the resulting duplicate ledger mirrors) for the same employer.
      if (!effectiveId && row.company_name && row.tax_year && row.source_type) {
        const normTarget = normalizeCompanyName(row.company_name);
        const { data: existingRows } = await (supabase as any)
          .from("ytd_catchup_entries")
          .select("id, company_name, source_type, tax_year")
          .eq("user_id", user.id)
          .eq("tax_year", row.tax_year)
          .eq("source_type", row.source_type);
        const match = ((existingRows || []) as any[]).find(
          (r) => normalizeCompanyName(r.company_name) === normTarget,
        );
        if (match?.id) effectiveId = match.id;
      }

      if (effectiveId) {
        const { data, error } = await supabase
          .from("ytd_catchup_entries" as any)
          .update(row as any)
          .eq("id", effectiveId)
          .select()
          .single();
        if (error) throw error;
        saved = data;
      } else {
        const { data, error } = await supabase
          .from("ytd_catchup_entries" as any)
          .insert(row as any)
          .select()
          .single();
        if (error) throw error;
        saved = data;
      }
      // Mirror catch-ups into the appropriate ledger so they show up in
      // Business Activity (1099/K-1) or Personal Income (W-2/other). Tax
      // engine de-dupes via overlap subtraction / include_in_tax_estimate.
      try {
        await syncCatchupMirror({
          catchupEntry: saved as YtdCatchupEntry,
          userId: user.id,
          orgId,
        });
      } catch (e) {
        console.warn("[useYtdCatchup] failed to sync ledger mirror", e);
      }
      return saved;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEY });
      qc.invalidateQueries({ queryKey: ["transactions"] });
      qc.invalidateQueries({ queryKey: ["income_entries"] });
      qc.invalidateQueries({ queryKey: ["personal_income_entries"] });
      toast.success("YTD catch-up saved");
    },
    onError: (e: any) => toast.error(e.message || "Could not save catch-up entry"),
  });
}

export function useDeleteYtdCatchup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      // Remove paired ledger mirrors first (best-effort).
      try {
        await (supabase as any).from("transactions").delete().eq("origin_ytd_catchup_id", id);
      } catch (e) {
        console.warn("[useYtdCatchup] failed to delete paired transaction", e);
      }
      try {
        await (supabase as any).from("income_entries").delete().eq("linked_ytd_catchup_id", id);
      } catch (e) {
        console.warn("[useYtdCatchup] failed to delete paired income entry", e);
      }
      const { error } = await supabase.from("ytd_catchup_entries" as any).delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEY });
      qc.invalidateQueries({ queryKey: ["transactions"] });
      qc.invalidateQueries({ queryKey: ["income_entries"] });
      qc.invalidateQueries({ queryKey: ["personal_income_entries"] });
      toast.success("YTD catch-up removed");
    },
  });
}

/**
 * Aggregate YTD catch-up totals to feed the tax engine.
 * Add these to actuals from income_entries dated AFTER the catch-up period_end
 * to get true YTD figures.
 */
export interface YtdCatchupTotals {
  grossIncome: number;
  businessExpenses: number;
  netBusinessProfit: number;
  federalWithholding: number;
  stateWithholding: number;
  ssWithholding: number;
  medicareWithholding: number;
  preTaxDeductions: number;
  retirement401k: number;
  hsaContribution: number;
  postTaxDeductions: number;
  /** Latest catch-up period_end across all entries — actual income should be summed AFTER this date. */
  latestPeriodEnd: string | null;
}


export function aggregateYtdCatchup(entries: YtdCatchupEntry[] | undefined, taxYear?: number): YtdCatchupTotals {
  const empty: YtdCatchupTotals = {
    grossIncome: 0, businessExpenses: 0, netBusinessProfit: 0,
    federalWithholding: 0, stateWithholding: 0,
    ssWithholding: 0, medicareWithholding: 0, preTaxDeductions: 0,
    retirement401k: 0, hsaContribution: 0, postTaxDeductions: 0,
    latestPeriodEnd: null,
  };
  if (!entries?.length) return empty;
  const year = taxYear ?? new Date().getFullYear();
  const filtered = entries.filter((e) => e.tax_year === year);
  const totals = filtered.reduce<YtdCatchupTotals>((acc, e) => {
    acc.grossIncome += Number(e.gross_income) || 0;
    if (e.source_type === "1099_k1") {
      acc.businessExpenses += Number(e.business_expenses) || 0;
    }
    acc.federalWithholding += Number(e.federal_withholding) || 0;
    acc.stateWithholding += Number(e.state_withholding) || 0;
    acc.ssWithholding += Number(e.ss_withholding) || 0;
    acc.medicareWithholding += Number(e.medicare_withholding) || 0;
    acc.retirement401k += Number(e.retirement_401k) || 0;
    acc.hsaContribution += Number(e.hsa_contribution) || 0;
    acc.preTaxDeductions += (Number(e.healthcare_premiums) || 0)
      + (Number(e.dental_vision) || 0)
      + (Number(e.other_pretax) || 0)
      + (Number(e.retirement_401k) || 0)
      + (Number(e.hsa_contribution) || 0);
    acc.postTaxDeductions += Number(e.post_tax_deductions) || 0;
    if (!acc.latestPeriodEnd || e.period_end > acc.latestPeriodEnd) acc.latestPeriodEnd = e.period_end;
    return acc;
  }, empty);
  totals.netBusinessProfit = Math.max(0, totals.grossIncome - totals.businessExpenses);
  return totals;
}

