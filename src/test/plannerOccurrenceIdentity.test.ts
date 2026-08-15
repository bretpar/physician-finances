/**
 * Planner conversion identity — a conversion must affect ONLY the exact
 * originating planner occurrence.
 *
 * Regression for the production bug where a converted 1099 occurrence on
 * 2026-10-15 for $25,000 caused a *different* W-2 occurrence with the same
 * date and amount to flip to "Matched deposit", removing two planned
 * occurrences from the forecast for a single actual transaction.
 */
import { describe, it, expect } from "vitest";
import { format, addDays } from "date-fns";
import {
  generateProjectedPaychecks,
  getProjectedTotals,
  type ProjectedIncomeStream,
  type MatchableIncomeEntry,
  type MatchableBusinessTransaction,
  type PlannerConversionRef,
} from "@/hooks/useProjectedIncome";

/** A future date inside the current calendar year. */
const FUTURE = format(addDays(new Date(), 20), "yyyy-MM-dd");
const FUTURE_PLUS_10 = format(addDays(new Date(), 30), "yyyy-MM-dd");

function makeStream(over: Partial<ProjectedIncomeStream> = {}): ProjectedIncomeStream {
  return {
    id: "s1",
    user_id: "u1",
    organization_id: null,
    company: "Acme Hospital",
    company_type: "w2",
    pay_frequency: "single",
    custom_interval_days: null,
    start_date: FUTURE,
    end_date: null,
    paycheck_amount: 25000,
    taxes_withheld: 0,
    retirement_401k: 0,
    pre_tax_deductions: 0,
    is_active: true,
    include_in_tax: true,
    source_id: null,
    ui_income_subtype: null,
    federal_withholding: 0,
    state_withholding: 0,
    ss_withholding: 0,
    medicare_withholding: 0,
    healthcare_deduction: 0,
    hsa_contribution: 0,
    additional_tax_reserve: 0,
    notes: "",
    forecast_expense_per_period: 0,
    forecast_expense_notes: "",
    created_at: "",
    updated_at: "",
    ...over,
  } as ProjectedIncomeStream;
}

const w2Stream = makeStream({
  id: "W2-A",
  company: "Optum",
  company_type: "w2",
  source_id: "co-optum",
});

const bizStream = makeStream({
  id: "BIZ-A",
  company: "Locums LLC",
  company_type: "1099_schedule_c",
  source_id: "co-locums",
});

/** Ledger rows + conversion produced by converting the 1099 occurrence. */
const convertedBizTx: MatchableBusinessTransaction = {
  id: "tx-biz",
  transaction_date: FUTURE,
  vendor: "Locums LLC",
  amount: 25000,
  source_id: "co-locums",
  status: "active",
  transaction_type: "income",
  origin_planner_conversion_id: "pc-biz",
  origin_type: "planner_converted",
};

const convertedBizEntry: MatchableIncomeEntry = {
  id: "ie-biz",
  income_date: FUTURE,
  company: "Locums LLC",
  paycheck_amount: 25000,
  gross_amount: 25000,
  income_type: "1099_schedule_c",
  status: "received",
  source_id: "co-locums",
  entry_kind: "planner_conversion",
  origin_planner_conversion_id: "pc-biz",
};

const bizConversion: PlannerConversionRef = {
  stream_id: "BIZ-A",
  bonus_event_id: null,
  occurrence_date: FUTURE,
  status: "converted",
  income_entry_id: "ie-biz",
  transaction_id: "tx-biz",
};

function run(
  streams: ProjectedIncomeStream[],
  entries: MatchableIncomeEntry[] = [],
  conversions: PlannerConversionRef[] = [],
  txs: MatchableBusinessTransaction[] = [],
) {
  return generateProjectedPaychecks(streams, [], entries, [], conversions, txs);
}

describe("same date + same amount collision (W-2 vs 1099)", () => {
  it("converts only BIZ-A and leaves W2-A active/unmatched", () => {
    const before = run([w2Stream, bizStream]);
    const beforeTotals = getProjectedTotals(before, [w2Stream, bizStream]);
    expect(beforeTotals.grossIncome).toBe(50000);

    const after = run(
      [w2Stream, bizStream],
      [convertedBizEntry],
      [bizConversion],
      [convertedBizTx],
    );

    const biz = after.find((p) => p.streamId === "BIZ-A")!;
    const w2 = after.find((p) => p.streamId === "W2-A")!;
    expect(biz.matchStatus).toBe("converted");
    expect(w2.matchStatus).toBe("active");
    expect(w2.matchedIncomeId).toBeUndefined();
    expect(w2.suggestedIncomeId).toBeUndefined();

    // Remaining planned drops by exactly the converted $25,000, so projected
    // annual income (actual + remaining planned) is unchanged.
    const afterTotals = getProjectedTotals(after, [w2Stream, bizStream]);
    expect(afterTotals.grossIncome).toBe(25000);
    const actualIncome = 25000;
    expect(actualIncome + afterTotals.grossIncome).toBe(beforeTotals.grossIncome);
  });

  it("a $30,000 actual for a $25,000 plan raises projected income by $5,000", () => {
    const after = run(
      [w2Stream, bizStream],
      [{ ...convertedBizEntry, paycheck_amount: 30000, gross_amount: 30000 }],
      [bizConversion],
      [{ ...convertedBizTx, amount: 30000 }],
    );
    const afterTotals = getProjectedTotals(after, [w2Stream, bizStream]);
    const projected = 30000 + afterTotals.grossIncome;
    expect(projected).toBe(55000);
  });
});

describe("cross-source protection", () => {
  it("does not match a 1099 ledger entry to a W-2 occurrence (same date + amount)", () => {
    const orphan1099: MatchableIncomeEntry = {
      id: "ie-1099",
      income_date: FUTURE,
      company: "Locums LLC",
      paycheck_amount: 25000,
      gross_amount: 25000,
      income_type: "1099_schedule_c",
      status: "received",
      source_id: "co-locums",
    };
    const res = run([w2Stream], [orphan1099]);
    expect(res[0].matchStatus).toBe("active");
  });

  it("does not match a K-1 ledger entry to a W-2 occurrence", () => {
    const k1: MatchableIncomeEntry = {
      id: "ie-k1",
      income_date: FUTURE,
      company: "Partnership LLP",
      paycheck_amount: 25000,
      gross_amount: 25000,
      income_type: "k1_partnership",
      status: "received",
      source_id: "co-partner",
    };
    expect(run([w2Stream], [k1])[0].matchStatus).toBe("active");
  });

  it("does not match one employer's deposit to another employer's occurrence", () => {
    const otherEmployer: MatchableIncomeEntry = {
      id: "ie-other",
      income_date: FUTURE,
      company: "Mercy Health",
      paycheck_amount: 25000,
      gross_amount: 25000,
      income_type: "w2",
      status: "received",
      source_id: "co-mercy",
    };
    expect(run([w2Stream], [otherEmployer])[0].matchStatus).toBe("active");
  });

  it("does not let converting Business A affect Business B (same date + amount)", () => {
    const bizB = makeStream({
      id: "BIZ-B",
      company: "Second Locums Co",
      company_type: "1099_schedule_c",
      source_id: "co-second",
    });
    const after = run(
      [bizStream, bizB],
      [convertedBizEntry],
      [bizConversion],
      [convertedBizTx],
    );
    expect(after.find((p) => p.streamId === "BIZ-A")!.matchStatus).toBe("converted");
    expect(after.find((p) => p.streamId === "BIZ-B")!.matchStatus).toBe("active");
  });

  it("same amount but different dates never cross-matches", () => {
    const laterEntry: MatchableIncomeEntry = {
      id: "ie-late",
      income_date: FUTURE_PLUS_10,
      company: "Optum",
      paycheck_amount: 25000,
      gross_amount: 25000,
      income_type: "w2",
      status: "received",
      source_id: "co-optum",
    };
    expect(run([w2Stream], [laterEntry])[0].matchStatus).toBe("active");
  });

  it("same date but a very different amount never matches on date alone", () => {
    const wrongAmount: MatchableIncomeEntry = {
      id: "ie-small",
      income_date: FUTURE,
      company: "Unrelated Vendor",
      paycheck_amount: 400,
      gross_amount: 400,
      income_type: "w2",
      status: "received",
      source_id: "co-unrelated",
    };
    expect(run([w2Stream], [wrongAmount])[0].matchStatus).toBe("active");
  });
});

describe("ambiguous legacy fallback", () => {
  it("leaves the occurrence unmatched when two equally plausible candidates exist", () => {
    // Legacy rows: no source_id, no conversion id — identical company/date/amount.
    const legacyA: MatchableIncomeEntry = {
      id: "legacy-a",
      income_date: FUTURE,
      company: "Optum",
      paycheck_amount: 25000,
      gross_amount: 25000,
      income_type: "w2",
      status: "received",
    };
    const legacyB = { ...legacyA, id: "legacy-b" };
    const res = run([makeStream({ id: "W2-A", company: "Optum" })], [legacyA, legacyB]);
    expect(res[0].matchStatus).toBe("active");
    expect(res[0].suggestedIncomeId).toBeUndefined();
  });

  it("still suggests a match when exactly one legacy candidate is plausible", () => {
    const legacy: MatchableIncomeEntry = {
      id: "legacy-a",
      income_date: FUTURE,
      company: "Optum",
      paycheck_amount: 25000,
      gross_amount: 25000,
      income_type: "w2",
      status: "received",
    };
    const res = run([makeStream({ id: "W2-A", company: "Optum" })], [legacy]);
    expect(res[0].matchStatus).toBe("suggested");
    expect(res[0].suggestedIncomeId).toBe("legacy-a");
  });
});
