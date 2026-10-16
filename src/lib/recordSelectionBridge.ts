/**
 * Read-only record-selection bridge for the tax reconciliation export.
 *
 * Explains, per record, whether the canonical calculation used it and why.
 * "Included" is NEVER recomputed here — it is read from the canonical
 * selection (useTaxEstimate.recordSelection). Reasons are explanatory only.
 * Nothing is deleted, merged, reclassified or restored.
 */
import type { ProjectedPaycheck } from "@/hooks/useProjectedIncome";

type Row = Record<string, any>;

export interface BridgeSelection {
  businessIncomeTransactionIds: string[];
  linkedEnrichmentEntryIds: string[];
  personalEntryIds: string[];
  projectedPaychecks: ProjectedPaycheck[];
}

export interface BridgeArgs {
  incomeEntries: Row[];
  transactions: Row[];
  transactionLinks: Row[];
  plannerConversions: Row[];
  selection: BridgeSelection;
}

const num = (v: unknown) => Number(v) || 0;
const round2 = (n: number) => Math.round(n * 100) / 100;

function entryDeductions(e: Row) {
  return {
    retirement_401k: num(e.retirement_401k),
    employer_retirement_contribution: num(e.employer_retirement_contribution),
    pre_tax_deductions: num(e.pre_tax_deductions),
    healthcare_deduction: num(e.healthcare_deduction),
    hsa_contribution: num(e.hsa_contribution),
    employer_hsa_contribution: num(e.employer_hsa_contribution),
  };
}
function entryWithholding(e: Row) {
  return {
    federal_withholding: num(e.federal_withholding),
    state_withholding: num(e.state_withholding),
    ss_withholding: num(e.ss_withholding),
    medicare_withholding: num(e.medicare_withholding),
    taxes_withheld: num(e.taxes_withheld),
  };
}

export function buildRecordSelectionBridge(args: BridgeArgs) {
  const txById = new Map(args.transactions.map((t) => [t.id as string, t]));
  const bizTx = new Set(args.selection.businessIncomeTransactionIds);
  const linked = new Set(args.selection.linkedEnrichmentEntryIds);
  const personal = new Set(args.selection.personalEntryIds);

  const incomeEntries = args.incomeEntries.map((e) => {
    const tx = e.linked_transaction_id ? txById.get(e.linked_transaction_id) : undefined;
    let included: "gross" | "deductions_only" | "excluded";
    let reason: string;
    if (personal.has(e.id)) {
      included = "gross";
      reason = "personal-bucket actual entry selected by the canonical estimate";
    } else if (linked.has(e.id)) {
      included = "deductions_only";
      reason = "linked to an active business income transaction; gross comes from that transaction";
    } else {
      included = "excluded";
      const status = String(e.status ?? "received");
      if (status === "merged" || status === "deleted" || status === "unlinked") reason = `entry status ${status}`;
      else if (e.include_in_tax_estimate === false) reason = "include_in_tax_estimate is false";
      else if (e.linked_transaction_id && !tx) reason = "linked transaction not found";
      else if (tx && tx.status !== "active") reason = `linked transaction status ${tx.status}`;
      else if (tx && !bizTx.has(tx.id)) reason = "linked transaction excluded by business-exclusion rule or outside scope date";
      else if (e.is_actual === false) reason = "not actual; planned income comes from Planner occurrences";
      else if (e.source_bucket !== "personal") reason = "business entry without an active linked transaction";
      else reason = "not selected by the canonical estimate (date scope, business income type, or duplicate)";
    }
    return {
      id: e.id,
      source_id: e.source_id ?? null,
      linked_transaction_id: e.linked_transaction_id ?? null,
      linked_group_id: tx?.linked_group_id ?? null,
      origin_planner_conversion_id: e.origin_planner_conversion_id ?? null,
      earner: null as string | null,
      company: e.company ?? null,
      date: e.income_date,
      status: e.status ?? null,
      source_bucket: e.source_bucket ?? null,
      income_type: e.income_type ?? null,
      tax_category: e.tax_category ?? null,
      gross_amount_stored: num(e.paycheck_amount),
      deposited_amount_stored: num(e.deposited_amount),
      gross_selected_for_calculation: included === "gross" ? num(e.paycheck_amount) : 0,
      deductions: entryDeductions(e),
      withholding: entryWithholding(e),
      included,
      reason,
    };
  });

  const incomeTransactions = args.transactions
    .filter((t) => t.transaction_type === "income")
    .map((t) => {
      const included = bizTx.has(t.id);
      let reason = included ? "active business income transaction (canonical gross)" : "";
      if (!included) {
        if (t.status !== "active") reason = `status ${t.status}`;
        else if (t.excluded_from_reports) reason = "excluded_from_reports";
        else if ((t.category || "").trim() === "Personal") reason = "Personal category";
        else reason = "outside scope date";
      }
      return {
        id: t.id,
        source_id: t.source_id ?? null,
        entity: t.entity ?? null,
        date: t.transaction_date,
        status: t.status ?? null,
        source_type: t.source_type ?? null,
        origin_type: t.origin_type ?? null,
        origin_planner_conversion_id: t.origin_planner_conversion_id ?? null,
        linked_group_id: t.linked_group_id ?? null,
        amount: Math.abs(num(t.amount)),
        gross_selected_for_calculation: included ? Math.abs(num(t.amount)) : 0,
        linked_income_entry_ids: args.incomeEntries.filter((e) => e.linked_transaction_id === t.id).map((e) => e.id),
        included: included ? "gross" : "excluded",
        reason,
      };
    });

  const plannerOccurrences = args.selection.projectedPaychecks.map((p) => {
    const conv = args.plannerConversions.find(
      (c) => c.stream_id === p.streamId && c.occurrence_date === p.date,
    );
    return {
      stream_id: p.streamId,
      date: p.date,
      type: p.type,
      label: p.label,
      gross_amount: p.grossAmount,
      deductions: {
        retirement_401k: p.retirement401k,
        employer_retirement_contribution: p.employerRetirementContribution ?? 0,
        pre_tax_deductions: p.preTaxDeductions,
        healthcare_deduction: p.healthcareDeduction,
        hsa_contribution: p.hsaContribution,
      },
      withholding: {
        taxes_withheld: p.taxesWithheld,
        federal_withholding: p.federalWithholding ?? null,
        state_withholding: p.stateWithholding ?? null,
        ss_withholding: p.ssWithholding ?? null,
        medicare_withholding: p.medicareWithholding ?? null,
      },
      match_status: p.matchStatus,
      matched_income_id: p.matchedIncomeId ?? null,
      suggested_income_id: p.suggestedIncomeId ?? null,
      suggested_transaction_id: p.suggestedTransactionId ?? null,
      planner_conversion_id: conv?.id ?? null,
      converted_transaction_id: conv?.transaction_id ?? null,
      converted_income_entry_id: conv?.income_entry_id ?? null,
      gross_selected_for_calculation: p.matchStatus === "active" ? p.grossAmount : 0,
      included: p.matchStatus === "active" ? "planned" : "excluded",
      reason: p.matchStatus === "active" ? "active Planner occurrence" : `occurrence ${p.matchStatus}`,
    };
  });

  // Trace merge groups behind income entries whose linked transaction is not active.
  const mergeGroups = new Map<string, any>();
  for (const e of args.incomeEntries) {
    const tx = e.linked_transaction_id ? txById.get(e.linked_transaction_id) : undefined;
    if (!tx || tx.status === "active") continue;
    const groupId: string | null = tx.linked_group_id ?? null;
    const key = groupId ?? `no-group:${tx.id}`;
    if (!mergeGroups.has(key)) {
      const links = groupId ? args.transactionLinks.filter((l) => l.linked_group_id === groupId) : [];
      const memberIds = new Set<string>();
      for (const l of links) {
        if (l.manual_transaction_id) memberIds.add(l.manual_transaction_id);
        if (l.plaid_transaction_record_id) memberIds.add(l.plaid_transaction_record_id);
      }
      if (groupId) for (const t of args.transactions) if (t.linked_group_id === groupId) memberIds.add(t.id);
      memberIds.add(tx.id);
      const members = [...memberIds].map((id) => {
        const t = txById.get(id);
        return t
          ? { id, status: t.status, source_type: t.source_type ?? null, date: t.transaction_date, amount: Math.abs(num(t.amount)), counted: bizTx.has(id) }
          : { id, status: "missing", source_type: null, date: null, amount: null, counted: false };
      });
      const survivors = members.filter((m) => m.status === "active");
      mergeGroups.set(key, {
        linked_group_id: groupId,
        link_statuses: links.map((l) => ({ id: l.id, status: l.status, manual_transaction_id: l.manual_transaction_id, plaid_transaction_record_id: l.plaid_transaction_record_id })),
        members,
        surviving_transaction_ids: survivors.map((m) => m.id),
        stranded_income_entries: [] as any[],
        surviving_income_entries: args.incomeEntries
          .filter((x) => survivors.some((s) => s.id === x.linked_transaction_id))
          .map((x) => ({ id: x.id, linked_transaction_id: x.linked_transaction_id, gross: num(x.paycheck_amount), deposited: num(x.deposited_amount), deductions: entryDeductions(x), withholding: entryWithholding(x) })),
      });
    }
    mergeGroups.get(key).stranded_income_entries.push({
      id: e.id,
      company: e.company,
      date: e.income_date,
      linked_transaction_id: tx.id,
      gross: num(e.paycheck_amount),
      deposited: num(e.deposited_amount),
      deductions: entryDeductions(e),
      withholding: entryWithholding(e),
    });
  }
  const mergeGroupFindings = [...mergeGroups.values()].map((g) => {
    const strandedGross = round2(g.stranded_income_entries.reduce((s: number, x: any) => s + x.gross, 0));
    const survivingCounted = round2(
      g.members.filter((m: any) => m.counted).reduce((s: number, m: any) => s + (m.amount || 0), 0),
    );
    const flags: string[] = [];
    if (!g.linked_group_id) flags.push("unresolved: linked transaction has no linked_group_id");
    if (g.surviving_transaction_ids.length === 0) flags.push("unresolved: no active surviving transaction in group");
    if (g.surviving_transaction_ids.length > 1) flags.push("unresolved: more than one active survivor");
    if (g.surviving_income_entries.length === 0) flags.push("deductions/withholding of the stranded entry are not carried by any surviving entry");
    if (survivingCounted && Math.abs(survivingCounted - strandedGross) >= 0.01)
      flags.push("surviving counted amount differs from stranded saved gross (survivor may be a bank deposit, not gross pay)");
    return { ...g, stranded_gross: strandedGross, surviving_counted_amount: survivingCounted, flags };
  });

  return {
    incomeEntries,
    incomeTransactions,
    plannerOccurrences,
    mergeGroups: mergeGroupFindings,
    notes: [
      "included is read from the canonical selection; reasons are explanatory.",
      "earner identity is not stored on income records (only ytd_catchup_entries.owner_person).",
      "Stranded merged-entry gross is NOT added to annual income: a surviving representation may already count it.",
    ],
  };
}

/** Gross of the exact canonical records (business tx + personal entries + active occurrences). */
export function canonicalRecordGross(sel: {
  businessIncomeTransactions: Row[];
  personalEntries: Row[];
  projectedPaychecks: ProjectedPaycheck[];
}, opts: { includePlanned?: boolean } = {}) {
  const includePlanned = opts.includePlanned ?? true;
  const business = sel.businessIncomeTransactions.reduce((s, t) => s + Math.abs(num(t.amount)), 0);
  const personal = sel.personalEntries.reduce((s, e) => s + num(e.paycheck_amount), 0);
  const planned = !includePlanned ? 0 : sel.projectedPaychecks.filter((p) => p.matchStatus === "active").reduce((s, p) => s + p.grossAmount, 0);
  return { business: round2(business), personal: round2(personal), planned: round2(planned), total: round2(business + personal + planned) };
}

/** Sum of the Tax Breakdown income-source cards (business/W-2/other; cap gains reported separately). */
export function sourceCardGross(sources: Row[]) {
  let business = 0, w2 = 0, other = 0, capitalGains = 0;
  for (const s of sources) {
    if (s.kind === "business") business += num(s.revenue);
    else if (s.kind === "w2") w2 += num(s.grossWages);
    else if (s.kind === "other") other += num(s.grossAmount);
    else if (s.kind === "capital_gains") capitalGains += num(s.net) + num(s.dividends);
  }
  return { business: round2(business), w2: round2(w2), other: round2(other), capitalGains: round2(capitalGains), recordTotal: round2(business + w2 + other) };
}

/**
 * Actual Only must compare against actual records only: the shared selection
 * still carries Planner occurrences (for matching), but projected additions
 * are never part of the Actual Only calculation.
 */
export function buildSourceCardReconciliation(
  sources: Row[],
  sel: Parameters<typeof canonicalRecordGross>[0],
  scope: "actualOnly" | "actualPlusPlanned" = "actualPlusPlanned",
) {
  const cards = sourceCardGross(sources);
  const canonical = canonicalRecordGross(sel, { includePlanned: scope === "actualPlusPlanned" });
  const difference = round2(cards.recordTotal - canonical.total);
  return { cards, canonicalRecords: canonical, difference, reconciled: Math.abs(difference) < 0.01 };
}
