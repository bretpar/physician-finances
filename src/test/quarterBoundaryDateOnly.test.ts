/**
 * Date-only quarter boundary regression.
 *
 * `YYYY-MM-DD` values are calendar dates. Parsing them with `new Date(iso)`
 * makes them UTC midnight, which is the *previous* local day in Pacific time —
 * so a Jun 1 paycheck fell into Q2 and an Aug 31 paycheck into Q3's exclusion,
 * inflating Q3 withholding ($12,000 observed vs $5,000 expected).
 *
 * These tests pin the intended windows:
 *   Q2 = [Apr 1, Jun 1)   Q3 = [Jun 1, Sep 1)   Q4 = [Sep 1, Jan 1)
 */
import { describe, it, expect, afterAll } from "vitest";
import {
  buildQuarterRecommendation,
  type QuarterRecommendationInput,
} from "@/lib/quarterRecommendation";

const Y = 2026;
const NOW = new Date(Y, 11, 31); // late in year so nothing is "future"

const w = (date: string, federal_withholding: number) => ({
  income_date: date,
  gross_amount: 10_000,
  federal_withholding,
});

const q = (quarter: QuarterRecommendationInput["quarter"], entries: ReturnType<typeof w>[]) =>
  buildQuarterRecommendation({
    annualTaxLiability: 40_000,
    year: Y,
    quarter,
    now: NOW,
    personalEntries: entries,
  });

describe("quarter boundaries for date-only values", () => {
  it("May 31 belongs to Q2, not Q3", () => {
    expect(q(2, [w(`${Y}-05-31`, 1_000)]).paidFromWithholding).toBe(1_000);
    expect(q(3, [w(`${Y}-05-31`, 1_000)]).paidFromWithholding).toBe(0);
  });

  it("June 1 belongs to Q3, not Q2", () => {
    expect(q(3, [w(`${Y}-06-01`, 2_000)]).paidFromWithholding).toBe(2_000);
    expect(q(2, [w(`${Y}-06-01`, 2_000)]).paidFromWithholding).toBe(0);
  });

  it("August 31 belongs to Q3, not Q4", () => {
    expect(q(3, [w(`${Y}-08-31`, 3_000)]).paidFromWithholding).toBe(3_000);
    expect(q(4, [w(`${Y}-08-31`, 3_000)]).paidFromWithholding).toBe(0);
  });

  it("September 1 belongs to Q4, not Q3", () => {
    expect(q(4, [w(`${Y}-09-01`, 4_000)]).paidFromWithholding).toBe(4_000);
    expect(q(3, [w(`${Y}-09-01`, 4_000)]).paidFromWithholding).toBe(0);
  });

  it("Q3 withholding sums only the Jun 1 – Aug 31 paychecks ($5,000)", () => {
    const entries = [
      w(`${Y}-05-31`, 3_000), // Q2
      w(`${Y}-06-01`, 2_000), // Q3
      w(`${Y}-08-31`, 3_000), // Q3
      w(`${Y}-09-01`, 4_000), // Q4
    ];
    expect(q(3, entries).paidFromWithholding).toBe(5_000);
  });
});

describe("quarter boundaries are timezone-independent", () => {
  const original = process.env.TZ;
  afterAll(() => {
    process.env.TZ = original;
  });

  for (const tz of ["America/Los_Angeles", "UTC", "Asia/Tokyo"]) {
    it(`holds in ${tz}`, () => {
      process.env.TZ = tz;
      const entries = [
        w(`${Y}-05-31`, 3_000),
        w(`${Y}-06-01`, 2_000),
        w(`${Y}-08-31`, 3_000),
        w(`${Y}-09-01`, 4_000),
      ];
      expect(q(3, entries).paidFromWithholding).toBe(5_000);
    });
  }
});
