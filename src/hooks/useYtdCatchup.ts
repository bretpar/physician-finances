import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { getUserOrgId } from "@/hooks/useOrgId";
import { formatMonthYear } from "@/lib/localDate";

export type YtdCatchupSourceType = "w2" | "1099_k1" | "other";
export type YtdCatchupOwnerPerson = "taxpayer" | "spouse";

export interface YtdCatchupEntry {
  id: string;
  user_id: string;
  organization_id: string | null;
  tax_year: number;
  source_type: YtdCatchupSourceType;
  owner_person: YtdCatchupOwnerPerson;
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
    // Scope by transaction_type so the income mirror and (newer) expense
    // mirror don't dedupe each other.
    for (const txType of ["income", "expense"] as const) {
      const { data: mirrors } = await (supabase as any)
        .from("transactions")
        .select("id, created_at")
        .eq("origin_ytd_catchup_id", entry.id)
        .eq("transaction_type", txType)
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
          .update({ source_id: match.id, entity: match.name, company_type: match.company_type })
          .eq("id", keep.id);
      }

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

  // Resolve the LINKED company's filing type so K-1 / Schedule C / S-Corp
  // routing is preserved on the mirror tx rows. Without this the mirror was
  // hardcoded to "1099_schedule_c", which caused Tax Breakdown to label a
  // K-1 entity as 1099 / Schedule C and to drop displayed expenses.
  let resolvedCompanyType: string = "1099_schedule_c";
  if (isBusiness && c.company_id) {
    try {
      const { data: companyRow } = await (supabase as any)
        .from("companies")
        .select("company_type")
        .eq("id", c.company_id)
        .maybeSingle();
      if (companyRow?.company_type) resolvedCompanyType = String(companyRow.company_type);
    } catch (e) {
      console.warn("[syncCatchupMirror] company lookup failed; defaulting to 1099_schedule_c", e);
    }
  }

  // ── Business mirror in `transactions` ───────────────────────────────────
  // A 1099/K-1 catchup may create TWO mirror rows: an income row for gross
  // revenue and (when business_expenses > 0) an expense row for deductible
  // YTD business expenses. We scope lookups by transaction_type so the two
  // mirrors never dedupe each other.
  const { data: existingIncomeTxRows } = await (supabase as any)
    .from("transactions")
    .select("id, created_at")
    .eq("origin_ytd_catchup_id", c.id)
    .eq("transaction_type", "income")
    .order("created_at", { ascending: true });
  const existingTx = (existingIncomeTxRows && existingIncomeTxRows[0]) || null;
  if (existingIncomeTxRows && existingIncomeTxRows.length > 1) {
    await (supabase as any)
      .from("transactions")
      .delete()
      .in("id", existingIncomeTxRows.slice(1).map((r: any) => r.id));
  }


  const { data: existingExpenseTxRows } = await (supabase as any)
    .from("transactions")
    .select("id, created_at")
    .eq("origin_ytd_catchup_id", c.id)
    .eq("transaction_type", "expense")
    .order("created_at", { ascending: true });
  const existingExpenseTx = (existingExpenseTxRows && existingExpenseTxRows[0]) || null;
  if (existingExpenseTxRows && existingExpenseTxRows.length > 1) {
    await (supabase as any)
      .from("transactions")
      .delete()
      .in("id", existingExpenseTxRows.slice(1).map((r: any) => r.id));
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
      company_type: resolvedCompanyType,

      source_id: c.company_id,
      transaction_type: "income",
      // actual_withholding stays 0 on the YTD-catchup business mirror tx —
      // federal withholding/estimated payments are mirrored into
      // `tax_payments` (estimatedPaymentsMade) and state withholding flows
      // through the catch-up's own state_withholding aggregation. Setting
      // this to fedW+stateW would double-count those dollars in quarterly
      // "Saved QTD" and tax-savings totals.
      actual_withholding: 0,
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

    // Expense mirror — without this, Business Activity shows $0 deductions
    // even though Dashboard / Tax Overview already net business_expenses
    // from profit via aggregateYtdCatchup. Keeps the canonical
    // `transactions` ledger and the aggregated screens in agreement.
    const bizExpenses = Math.max(0, Number(c.business_expenses) || 0);
    if (bizExpenses > 0) {
      const expenseRow: any = {
        user_id: args.userId,
        organization_id: args.orgId,
        transaction_date: c.period_end,
        vendor: `${friendlyName} expenses: ${c.company_name || "Business"}`,
        amount: bizExpenses,
        account_source: "YTD catch-up",
        category: "Professional expenses",
        notes: `Onboarding YTD business expense. Edit from the YTD catch-up section.`,
        entity: c.company_name || "Unassigned",
        company_type: resolvedCompanyType,
        source_id: c.company_id,
        transaction_type: "expense",
        status: "active",
        excluded_from_reports: false,
        needs_review: false,
        user_edited: false,
        origin_type: "ytd_catchup",
        origin_ytd_catchup_id: c.id,
        source_type: "manual",
      };
      if (existingExpenseTx?.id) {
        await supabase.from("transactions").update(expenseRow).eq("id", existingExpenseTx.id);
      } else {
        await supabase.from("transactions").insert(expenseRow);
      }
    } else if (existingExpenseTx?.id) {
      // Expenses cleared back to 0 — remove the stale mirror row.
      await supabase.from("transactions").delete().eq("id", existingExpenseTx.id);
    }
  } else {
    // Source type changed away from business → remove any stale mirrors.
    if (existingTx?.id) {
      await supabase.from("transactions").delete().eq("id", existingTx.id);
    }
    if (existingExpenseTx?.id) {
      await supabase.from("transactions").delete().eq("id", existingExpenseTx.id);
    }
  }

  // ── Business estimated-tax-payment mirror in `tax_payments` ─────────────
  // For 1099 / K-1 catch-ups the "Federal estimated taxes paid YTD" field
  // represents money the user has already paid toward this year's federal
  // taxes (estimated payments / withholding from K-1 distributions). The
  // tax engine reads estimated payments from the `tax_payments` table, so
  // we mirror the value there so it shows up in Tax Overview's "Estimated
  // payments made" line and in the quarterly payment summaries. The
  // companion change in `useTaxEstimate.ts` zeroes out `cu.business
  // .federalWithheld` so we don't double-count this dollar as both
  // withholding AND an estimated payment.
  const taxPaymentTag = `[ytd-catchup:${c.id}]`;
  // Look up any existing mirror tax_payments row for this catch-up.
  const { data: existingPaymentRows } = await (supabase as any)
    .from("tax_payments")
    .select("id, created_at")
    .eq("user_id", args.userId)
    .ilike("notes", `${taxPaymentTag}%`)
    .order("created_at", { ascending: true });
  const existingPayment = (existingPaymentRows && existingPaymentRows[0]) || null;
  if (existingPaymentRows && existingPaymentRows.length > 1) {
    await (supabase as any)
      .from("tax_payments")
      .delete()
      .in("id", existingPaymentRows.slice(1).map((r: any) => r.id));
  }

  if (isBusiness && fedW > 0) {
    // Derive the calendar-quarter estimated-tax bucket from period_end.
    // Must match `getCurrentQuarter` in src/lib/quarters.ts (true 3-month
    // calendar quarters) so the Dashboard tracker and Tax Overview attribute
    // the same income/payment to the same quarter.
    const periodEndDate = new Date(`${c.period_end}T00:00:00`);
    const m = periodEndDate.getMonth(); // 0-based
    const appliedQuarter = m < 3 ? "Q1" : m < 6 ? "Q2" : m < 9 ? "Q3" : "Q4";
    const appliedYear = c.tax_year;
    const paymentRow: any = {
      user_id: args.userId,
      organization_id: args.orgId,
      payment_date: c.period_end,
      amount: fedW,
      quarter: appliedQuarter,
      applied_quarter: appliedQuarter,
      applied_tax_year: appliedYear,
      notes: `${taxPaymentTag} Onboarding YTD estimated tax paid: ${c.company_name || "Business"}`,
    };
    if (existingPayment?.id) {
      await (supabase as any).from("tax_payments").update(paymentRow).eq("id", existingPayment.id);
    } else {
      await (supabase as any).from("tax_payments").insert(paymentRow);
    }
  } else if (existingPayment?.id) {
    // No longer business, or fedW dropped to 0 → remove the stale mirror.
    await (supabase as any).from("tax_payments").delete().eq("id", existingPayment.id);
  }

  // ── Personal mirror in `income_entries` (W-2 / other) ───────────────────
  // Use limit-based fetch (not .maybeSingle) so a transient duplicate row
  // from a prior partial write never throws here — instead we dedupe.
  const { data: existingIncomeRows } = await (supabase as any)
    .from("income_entries")
    .select("id, created_at")
    .eq("linked_ytd_catchup_id", c.id)
    .order("created_at", { ascending: true });
  const existingIncome = (existingIncomeRows && existingIncomeRows[0]) || null;
  if (existingIncomeRows && existingIncomeRows.length > 1) {
    await (supabase as any)
      .from("income_entries")
      .delete()
      .in("id", existingIncomeRows.slice(1).map((r: any) => r.id));
  }


  if (!isBusiness) {
    const isSpouse = (c as any).owner_person === "spouse";
    const incomeType = isW2 ? (isSpouse ? "w2_partner" : "w2_user") : "other_income";
    const uiSubtype = isW2 ? (isSpouse ? "w2_partner" : "w2_user") : "other_income";
    const incomeRow: any = {
      user_id: args.userId,
      organization_id: args.orgId,
      name: friendlyName,
      company: c.company_name || "",
      source_id: c.company_id,
      income_type: incomeType,
      ui_income_subtype: uiSubtype,
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

/**
 * Wrap a promise with a hard timeout. If the underlying call hangs (e.g. a
 * Supabase request never settles due to a network or auth-token glitch),
 * we still reject so the mutation surfaces an error instead of leaving the
 * Save button stuck on "Saving…" forever.
 */
function withTimeout<T>(p: Promise<T> | PromiseLike<T>, ms: number, step: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`Timed out during ${step} (${ms}ms)`)), ms);
    Promise.resolve(p).then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); },
    );
  });
}

/** Resolve the current user's org id with a brief retry for the
 *  handle_new_user trigger race on fresh signups. */
async function getOrgIdWithRetry(userId: string): Promise<string> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const { data, error } = await (supabase as any)
      .from("organization_members")
      .select("organization_id")
      .eq("user_id", userId)
      .limit(1)
      .maybeSingle();
    if (data?.organization_id) return data.organization_id as string;
    if (error && (error as any).code && (error as any).code !== "PGRST116") {
      throw new Error(`organization lookup failed: ${error.message}`);
    }
    await new Promise((r) => setTimeout(r, 250 * (attempt + 1)));
  }
  throw new Error("No organization found for your account yet. Please refresh and try again.");
}

export function useUpsertYtdCatchup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: YtdCatchupInput & { id?: string }) => {
      const { data: userRes } = await withTimeout(
        supabase.auth.getUser(),
        5000,
        "auth.getUser",
      );
      const user = userRes?.user;
      if (!user) throw new Error("Not authenticated");
      const orgId = await withTimeout(getOrgIdWithRetry(user.id), 8000, "organization lookup");
      const row: any = {
        ...input,
        user_id: user.id,
        organization_id: orgId,
      };
      if ((row.source_type === "1099_k1" || row.source_type === "w2") && !row.company_id && row.company_name) {
        try {
          const { data: companies } = await withTimeout(
            supabase.from("companies").select("id, name, company_type") as any,
            6000,
            "company lookup",
          ) as any;
          const normTarget = normalizeCompanyName(row.company_name);
          const allowedTypes = row.source_type === "w2"
            ? ["w2", "scorp_w2"]
            : ["1099_schedule_c", "k1_partnership", "k1_s_corp", "scorp_distribution"];
          const matches = (companies || []).filter((c: any) =>
            allowedTypes.includes(String(c.company_type)) &&
            normalizeCompanyName(c.name) === normTarget,
          );
          if (matches.length === 1) row.company_id = matches[0].id;
        } catch (e) {
          console.warn("[useYtdCatchup] company lookup failed, continuing without company_id", e);
        }
      }
      let saved: any;
      let effectiveId = input.id;

      // Idempotency lookup — scoped by user + tax_year + source_type AND
      // EITHER company_id (preferred) OR exact non-empty normalized
      // company_name. CRITICAL: never collapse two distinct employers
      // into one row. A blank/missing company_name is NEVER allowed to
      // match an existing row, otherwise a second employer save can
      // silently overwrite the first (the multi-W-2 YTD bug this guard
      // exists to prevent).
      if (!effectiveId && row.tax_year && row.source_type) {
        try {
          const normTarget = normalizeCompanyName(row.company_name);
          const { data: existingRows } = await withTimeout(
            (supabase as any)
              .from("ytd_catchup_entries")
              .select("id, company_name, company_id, source_type, tax_year")
              .eq("user_id", user.id)
              .eq("tax_year", row.tax_year)
              .eq("source_type", row.source_type),
            6000,
            "existing catch-up lookup",
          ) as any;
          const candidates = (existingRows || []) as any[];
          // 1) company_id match (strongest signal).
          let match = row.company_id
            ? candidates.find((r) => r.company_id && r.company_id === row.company_id)
            : undefined;
          // 2) exact normalized company_name match (only if non-empty).
          if (!match && normTarget) {
            match = candidates.find(
              (r) => normalizeCompanyName(r.company_name) === normTarget,
            );
          }
          if (match?.id) {
            console.info("[useYtdCatchup] reusing existing catch-up row", {
              id: match.id,
              matched_name: match.company_name,
              matched_company_id: match.company_id,
              incoming_name: row.company_name,
              incoming_company_id: row.company_id,
            });
            effectiveId = match.id;
          } else {
            console.info("[useYtdCatchup] no idempotency match — will INSERT", {
              incoming_name: row.company_name,
              incoming_company_id: row.company_id,
              source_type: row.source_type,
              candidates: candidates.map((c) => ({
                id: c.id,
                name: c.company_name,
                company_id: c.company_id,
              })),
            });
          }
        } catch (e) {
          console.warn("[useYtdCatchup] idempotency lookup failed, falling back to insert", e);
        }
      }

      if (effectiveId) {
        const { data, error } = await withTimeout(
          (supabase as any)
            .from("ytd_catchup_entries")
            .update(row as any)
            .eq("id", effectiveId)
            .select()
            .single(),
          10000,
          "ytd_catchup_entries update",
        ) as any;
        if (error) throw new Error(`ytd_catchup_entries update failed: ${error.message}`);
        saved = data;
      } else {
        const { data, error } = await withTimeout(
          (supabase as any)
            .from("ytd_catchup_entries")
            .insert(row as any)
            .select()
            .single(),
          10000,
          "ytd_catchup_entries insert",
        ) as any;
        if (error) throw new Error(`ytd_catchup_entries insert failed: ${error.message}`);
        saved = data;
      }
      try {
        await withTimeout(
          syncCatchupMirror({
            catchupEntry: saved as YtdCatchupEntry,
            userId: user.id,
            orgId,
          }),
          10000,
          "ledger mirror sync",
        );
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
      qc.invalidateQueries({ queryKey: ["tax_payments"] });
      toast.success("YTD catch-up saved");
    },
    onError: (e: any) => {
      console.error("[useYtdCatchup] save failed", e);
      toast.error(e?.message || "Could not save catch-up entry");
    },
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
      // Remove any mirrored tax_payments row (business YTD estimated payment).
      try {
        await (supabase as any)
          .from("tax_payments")
          .delete()
          .ilike("notes", `[ytd-catchup:${id}]%`);
      } catch (e) {
        console.warn("[useYtdCatchup] failed to delete paired tax_payment", e);
      }
      const { error } = await supabase.from("ytd_catchup_entries" as any).delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEY });
      qc.invalidateQueries({ queryKey: ["transactions"] });
      qc.invalidateQueries({ queryKey: ["income_entries"] });
      qc.invalidateQueries({ queryKey: ["personal_income_entries"] });
      qc.invalidateQueries({ queryKey: ["tax_payments"] });
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

