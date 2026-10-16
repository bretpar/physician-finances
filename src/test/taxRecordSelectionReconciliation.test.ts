/**
 * Reconciliation pass: record selection shared by the annual estimate and the
 * Tax Breakdown cards, plus the read-only export bridge. Anonymized fixtures.
 */
import { describe, expect, it } from "vitest";
import { addDays, format } from "date-fns";
import {
  buildMatchableBusinessIncomeTransactions,
  isCanonicalBusinessIncomeTx,
  plannedOccurrences,
  selectLinkedEnrichmentEntries,
} from "@/lib/taxRecordSelection";
import { buildRecordSelectionBridge, buildSourceCardReconciliation } from "@/lib/recordSelectionBridge";
import {
  RECONCILIATION_DATASETS,
  buildReconciliationExport,
  isForbiddenKey,
  stripForbidden,
} from "@/lib/taxReconciliationExport";
import { generateProjectedPaychecks, type ProjectedIncomeStream } from "@/hooks/useProjectedIncome";

const FUTURE = format(addDays(new Date(), 20), "yyyy-MM-dd");
const FUTURE_MINUS_1 = format(addDays(new Date(), 19), "yyyy-MM-dd");

const tx = (over: Record<string, any>) => ({
  id: "t", transaction_type: "income", transaction_date: "2026-03-01", amount: 1000,
  status: "active", category: "Income", excluded_from_reports: false, source_id: "co-a", entity: "Group A",
  ...over,
});

// Merge group G1: manual gross row merged into a surviving bank deposit.
const txMergedManual = tx({ id: "tx-manual", status: "merged", amount: 10000, linked_group_id: "G1", source_type: "manual" });
const txSurvivingDeposit = tx({ id: "tx-deposit", status: "active", amount: 7000, linked_group_id: "G1", source_type: "plaid" });
const txs = [txMergedManual, txSurvivingDeposit];

const entryStranded = {
  id: "ie-stranded", company: "Group A", source_id: "co-a", income_date: "2026-03-01", status: "received",
  source_bucket: "business", is_actual: true, paycheck_amount: 10000, deposited_amount: 7000,
  linked_transaction_id: "tx-manual", retirement_401k: 1500, federal_withholding: 900,
};
const personalW2 = {
  id: "ie-w2", company: "Hospital B", income_date: "2026-03-05", status: "received", source_bucket: "personal",
  is_actual: true, paycheck_amount: 4000, linked_transaction_id: null,
};
const personalMergedHistorical = { ...personalW2, id: "ie-w2-merged", status: "merged", is_actual: false };

describe("merged-status exclusion", () => {
  it("never counts a merged transaction as business gross", () => {
    expect(isCanonicalBusinessIncomeTx(txMergedManual as any)).toBe(false);
    expect(isCanonicalBusinessIncomeTx(txSurvivingDeposit as any)).toBe(true);
  });

  it("an entry linked to a merged transaction adds no enrichment", () => {
    expect(selectLinkedEnrichmentEntries([entryStranded], txs as any)).toEqual([]);
  });

  it("merged transactions are not matchable for Planner conversion", () => {
    expect(buildMatchableBusinessIncomeTransactions(txs as any).map((t) => t.id)).toEqual(["tx-deposit"]);
  });
});

describe("converted-payment exclusion", () => {
  const stream = {
    id: "S1", user_id: "u", organization_id: null, company: "Group A", company_type: "k1_partnership",
    pay_frequency: "single", custom_interval_days: null, start_date: FUTURE, end_date: null,
    paycheck_amount: 5000, taxes_withheld: 0, retirement_401k: 0, pre_tax_deductions: 0, is_active: true,
    include_in_tax: true, source_id: "co-a", ui_income_subtype: null, federal_withholding: 0,
    state_withholding: 0, ss_withholding: 0, medicare_withholding: 0, healthcare_deduction: 0,
    hsa_contribution: 0, additional_tax_reserve: 0, notes: "", forecast_expense_per_period: 0,
    forecast_expense_notes: "", created_at: "", updated_at: "",
  } as unknown as ProjectedIncomeStream;
  const convertedTx = tx({ id: "tx-conv", transaction_date: FUTURE_MINUS_1, amount: 5000, origin_type: "planner_converted", origin_planner_conversion_id: "pc1", vendor: "Group A" });
  const conversion = { stream_id: "S1", bonus_event_id: null, occurrence_date: FUTURE, status: "converted", transaction_id: "tx-conv", income_entry_id: null };

  it("an occurrence converted to a transaction one day earlier is not planned income", () => {
    const paychecks = generateProjectedPaychecks(
      [stream], [], [], [], [conversion], buildMatchableBusinessIncomeTransactions([convertedTx] as any),
    );
    expect(paychecks).toHaveLength(1);
    expect(plannedOccurrences({ projectedPaychecks: paychecks })).toHaveLength(0);
  });

  it("without the canonical conversion state it would have been counted (regression guard)", () => {
    const paychecks = generateProjectedPaychecks([stream], [], [], []);
    expect(plannedOccurrences({ projectedPaychecks: paychecks })).toHaveLength(1);
  });
});

describe("source-card / canonical reconciliation", () => {
  const selection = {
    businessIncomeTransactions: [txSurvivingDeposit],
    personalEntries: [personalW2],
    projectedPaychecks: [
      { streamId: "S1", date: FUTURE, grossAmount: 5000, matchStatus: "active" },
      { streamId: "S1", date: FUTURE, grossAmount: 5425, matchStatus: "converted" },
    ] as any[],
  };

  it("cards built from the canonical records reconcile to the cent", () => {
    const sources = [
      { kind: "business", revenue: 7000 + 5000 },
      { kind: "w2", grossWages: 4000 },
      { kind: "capital_gains", net: 300, dividends: 0 },
    ];
    const r = buildSourceCardReconciliation(sources, selection);
    expect(r.canonicalRecords.total).toBe(16000);
    expect(r.difference).toBe(0);
    expect(r.reconciled).toBe(true);
  });

  it("flags a card that still counts a merged entry's gross", () => {
    const sources = [{ kind: "business", revenue: 7000 + 10000 + 5000 }, { kind: "w2", grossWages: 4000 }];
    const r = buildSourceCardReconciliation(sources, selection);
    expect(r.difference).toBe(10000);
    expect(r.reconciled).toBe(false);
  });
});

describe("record-selection bridge", () => {
  const bridge = buildRecordSelectionBridge({
    incomeEntries: [entryStranded, personalW2, personalMergedHistorical],
    transactions: txs,
    transactionLinks: [{ id: "L1", linked_group_id: "G1", manual_transaction_id: "tx-manual", plaid_transaction_record_id: "tx-deposit", status: "active" }],
    plannerConversions: [],
    selection: {
      businessIncomeTransactionIds: ["tx-deposit"],
      linkedEnrichmentEntryIds: [],
      personalEntryIds: ["ie-w2"],
      projectedPaychecks: [],
    },
  });

  it("explains included and excluded entries", () => {
    const byId = Object.fromEntries(bridge.incomeEntries.map((e) => [e.id, e]));
    expect(byId["ie-w2"].included).toBe("gross");
    expect(byId["ie-stranded"].included).toBe("excluded");
    expect(byId["ie-stranded"].reason).toBe("linked transaction status merged");
    expect(byId["ie-w2-merged"].reason).toBe("entry status merged");
    expect(byId["ie-w2-merged"].gross_selected_for_calculation).toBe(0);
  });

  it("traces the merge group and flags the deposit-vs-gross gap", () => {
    expect(bridge.mergeGroups).toHaveLength(1);
    const g = bridge.mergeGroups[0];
    expect(g.surviving_transaction_ids).toEqual(["tx-deposit"]);
    expect(g.stranded_gross).toBe(10000);
    expect(g.surviving_counted_amount).toBe(7000);
    expect(g.flags).toContain("deductions/withholding of the stranded entry are not carried by any surviving entry");
    expect(g.flags.some((f: string) => f.includes("bank deposit"))).toBe(true);
  });
});

describe("export coverage and key filter", () => {
  it("exports investment income with the fields needed to trace gains and tax saved", () => {
    const cols = RECONCILIATION_DATASETS.investment_income_entries as readonly string[];
    for (const c of ["id", "entry_date", "investment_income_type", "taxable_amount", "cost_basis", "sale_proceeds", "actual_tax_saved"]) {
      expect(cols).toContain(c);
    }
  });

  it("keeps businessNonW2HsaAboveLine while dropping real secrets", () => {
    expect(isForbiddenKey("businessNonW2HsaAboveLine")).toBe(false);
    expect(isForbiddenKey("ssn")).toBe(true);
    expect(isForbiddenKey("spouseSsn")).toBe(true);
    expect(isForbiddenKey("plaid_access_token")).toBe(true);
    expect(isForbiddenKey("accessToken")).toBe(true);
    expect(isForbiddenKey("date_of_birth")).toBe(true);
    expect(stripForbidden({ businessNonW2HsaAboveLine: 1200, accessToken: "x" })).toEqual({ businessNonW2HsaAboveLine: 1200 });
  });

  it("does not certify a truncated dataset or a missing bridge as complete", () => {
    const out = buildReconciliationExport({
      taxYear: 2026, generatedAt: new Date("2026-10-16T00:00:00Z"), timezone: "UTC", build: {}, selectedTaxMode: "actual",
      datasets: { transactions: { status: "ok", rows: [{ id: "a" }], truncated: true } },
      calculations: {},
    });
    expect(out.metadata.complete).toBe(false);
    expect(out.metadata.unavailable.map((u) => u.dataset)).toEqual(
      expect.arrayContaining(["transactions", "recordSelectionBridge", "reconciliation"]),
    );
  });
});
