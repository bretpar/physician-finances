import { describe, it, expect } from "vitest";
import { buildQuarterRecommendation } from "@/lib/quarterRecommendation";

const YEAR = 2026;
const TODAY = new Date(YEAR, 5, 9, 12, 0, 0); // Jun 9, 2026

describe("Quarterly estimator remaining caveats", () => {
  // ── 1. Business "Amount you're saving for taxes" persists as Saved ──────
  describe("Business saved reserve (tx.actual_withholding)", () => {
    const baseTx = {
      id: "tx-biz-1",
      transaction_type: "income",
      transaction_date: `${YEAR}-04-20`,
      amount: 10_000,
      actual_withholding: 2_500,
      excluded_from_business: false,
    } as any;
    const linkedEntry = {
      linked_transaction_id: "tx-biz-1",
      income_date: `${YEAR}-04-20`,
      additional_tax_reserve: 0,
      federal_withholding: 0,
      company: "Biz",
    } as any;

    const inputBase = {
      annualTaxLiability: 60_000,
      year: YEAR,
      quarter: 2 as const,
      quarterMethod: "even" as const,
      transactions: [baseTx],
      incomeEntries: [linkedEntry],
      personalEntries: [],
      investmentEntries: [],
      projectedPaychecks: [],
      payments: [],
      manualSavings: [],
      now: TODAY,
    };

    it("counts $2,500 as Saved (not Paid)", () => {
      const r = buildQuarterRecommendation(inputBase);
      expect(r.savedThisQuarter).toBeGreaterThanOrEqual(2_500);
      expect(r.paidThisQuarter).toBe(0);
    });

    it("saved reserve does NOT reduce recommendedPaymentToMake", () => {
      const withReserve = buildQuarterRecommendation(inputBase);
      const withoutReserve = buildQuarterRecommendation({
        ...inputBase,
        transactions: [{ ...baseTx, actual_withholding: 0 }],
      });
      expect(withReserve.recommendedPaymentToMake).toBe(
        withoutReserve.recommendedPaymentToMake,
      );
    });

    it("saved reserve reduces stillNeedToSave / improves coverage", () => {
      const withReserve = buildQuarterRecommendation(inputBase);
      const withoutReserve = buildQuarterRecommendation({
        ...inputBase,
        transactions: [{ ...baseTx, actual_withholding: 0 }],
      });
      expect(withReserve.progressAmount).toBeGreaterThan(
        withoutReserve.progressAmount,
      );
    });
  });

  // ── 2. W-2 YTD catch-up federal withholding allocates across quarters ──
  describe("W-2 YTD catch-up federal withholding allocation", () => {
    const ytdMirror = {
      income_date: `${YEAR}-06-09`,
      federal_withholding: 5_000,
      additional_tax_reserve: 0,
      company: "Hospital",
      origin_type: "ytd_catchup",
      entry_kind: "ytd_catchup",
    } as any;

    const base = {
      annualTaxLiability: 60_000,
      quarterMethod: "even" as const,
      transactions: [],
      incomeEntries: [],
      personalEntries: [ytdMirror],
      investmentEntries: [],
      projectedPaychecks: [],
      payments: [],
      manualSavings: [],
      now: TODAY,
    };

    it("Q2 paid is > 0 (was $0 before the fix)", () => {
      const q2 = buildQuarterRecommendation({ ...base, year: YEAR, quarter: 2 });
      expect(q2.paidThisQuarter).toBeGreaterThan(0);
    });

    it("Q2 paid is its quarter-window slice of the YTD allocation", () => {
      // Period Jan 1 → Jun 9 = 159 days; Q2 window [Apr 1, Jun 1] = 61 days.
      // Slice = 61/159 ≈ 0.384 → expect ~$1,918.
      const q2 = buildQuarterRecommendation({ ...base, year: YEAR, quarter: 2 });
      expect(q2.paidThisQuarter).toBeGreaterThan(1_500);
      expect(q2.paidThisQuarter).toBeLessThan(2_300);
    });

    it("Q3 on Jun 9 only credits the Jun 1–today slice (not full YTD)", () => {
      const q3 = buildQuarterRecommendation({ ...base, year: YEAR, quarter: 3 });
      // Q3 slice [Jun 1, Jun 9] = 8 of 159 days → ~$251.
      expect(q3.paidThisQuarter).toBeGreaterThan(100);
      expect(q3.paidThisQuarter).toBeLessThan(500);
    });

    it("Q1+Q2+Q3 slices sum to the full YTD-catchup amount (no future credit)", () => {
      const q1 = buildQuarterRecommendation({ ...base, year: YEAR, quarter: 1 });
      const q2 = buildQuarterRecommendation({ ...base, year: YEAR, quarter: 2 });
      const q3 = buildQuarterRecommendation({ ...base, year: YEAR, quarter: 3 });
      expect(q1.paidThisQuarter + q2.paidThisQuarter + q3.paidThisQuarter).toBeCloseTo(5_000, 0);
    });

    it("future YTD-catchup withholding (period_end > today) does not count as paid for prior quarters", () => {
      const futureMirror = { ...ytdMirror, income_date: `${YEAR}-12-31` };
      const q1 = buildQuarterRecommendation({
        ...base,
        personalEntries: [futureMirror],
        year: YEAR,
        quarter: 1,
      });
      // Q1 slice [Jan 1, Apr 1] = 90 days, period [Jan 1, Dec 31] = 364 days
      // → ratio ≈ 0.247 → ~$1,237. Future portion never inflates Q1.
      expect(q1.paidThisQuarter).toBeLessThan(2_000);
    });

  });

  // ── 3. IRS quarter window: Jun 5 income maps to Q3, not Q2 ─────────────
  describe("IRS estimated-tax periods", () => {
    const jun5Tx = {
      id: "tx-jun5",
      transaction_type: "income",
      transaction_date: `${YEAR}-06-05`,
      amount: 10_000,
      actual_withholding: 2_500,
    } as any;
    const linkedEntry = {
      linked_transaction_id: "tx-jun5",
      income_date: `${YEAR}-06-05`,
      additional_tax_reserve: 0,
      federal_withholding: 0,
      company: "Biz",
    } as any;
    const base = {
      annualTaxLiability: 60_000,
      quarterMethod: "even" as const,
      transactions: [jun5Tx],
      incomeEntries: [linkedEntry],
      personalEntries: [],
      investmentEntries: [],
      projectedPaychecks: [],
      payments: [],
      manualSavings: [],
      now: TODAY,
    };

    it("Jun 5 income/reserve is NOT in Q2 (Apr 1 – May 31)", () => {
      const q2 = buildQuarterRecommendation({ ...base, year: YEAR, quarter: 2 });
      expect(q2.savedThisQuarter).toBe(0);
    });

    it("Jun 5 income/reserve IS in Q3 (Jun 1 – Aug 31)", () => {
      const q3 = buildQuarterRecommendation({ ...base, year: YEAR, quarter: 3 });
      expect(q3.savedThisQuarter).toBeGreaterThanOrEqual(2_500);
    });

    it("Q2 window is Apr 1 – Jun 1 (exclusive)", () => {
      const q2 = buildQuarterRecommendation({ ...base, year: YEAR, quarter: 2 });
      expect(q2.start.getMonth()).toBe(3); // April
      expect(q2.end.getMonth()).toBe(5); // June (exclusive)
    });

    it("Q3 window is Jun 1 – Sep 1 (exclusive)", () => {
      const q3 = buildQuarterRecommendation({ ...base, year: YEAR, quarter: 3 });
      expect(q3.start.getMonth()).toBe(5); // June
      expect(q3.end.getMonth()).toBe(8); // September (exclusive)
    });
  });

  // ── 4. Estimated payment of $500 reduces both surfaces identically ─────
  it("$500 Q2 estimated payment reduces recommendedPaymentToMake by $500", () => {
    const base = {
      annualTaxLiability: 60_000,
      year: YEAR,
      quarter: 2 as const,
      quarterMethod: "even" as const,
      transactions: [],
      incomeEntries: [],
      personalEntries: [],
      investmentEntries: [],
      projectedPaychecks: [],
      manualSavings: [],
      now: TODAY,
    };
    const before = buildQuarterRecommendation({ ...base, payments: [] });
    const after = buildQuarterRecommendation({
      ...base,
      payments: [
        {
          applied_quarter: "Q2",
          applied_tax_year: YEAR,
          payment_date: `${YEAR}-05-15`,
          amount: 500,
        },
      ],
    });
    expect(before.recommendedPaymentToMake - after.recommendedPaymentToMake).toBeCloseTo(500, 0);
  });
});
