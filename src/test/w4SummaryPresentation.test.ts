import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { selectW4SummaryPresentation } from "@/lib/w4SummaryPresentation";

const recommendation = (company: string, amount: number, remainingPaychecks = 6) => ({
  row: { streamId: company, company, remainingPaychecks },
  change: {
    currentExtraPerPaycheck: 0,
    recommendedExtraPerPaycheck: amount,
    deltaPerPaycheck: amount,
    changeAmountPerPaycheck: amount,
    direction: "increase" as const,
    label: `Increase by $${amount}/paycheck`,
  },
});

describe("W-2 summary presentation", () => {
  const annualShortfall = 12_668.48;

  it("uses the canonical $1,920 employer allocation on both summaries, never the annual shortfall", () => {
    expect(selectW4SummaryPresentation([recommendation("Optum", 1_920)], annualShortfall)).toEqual({
      kind: "per_paycheck",
      amount: 1_920,
      employerName: "Optum",
    });

    for (const screen of ["pages/Dashboard.tsx", "pages/Taxes.tsx"]) {
      const source = readFileSync(join(process.cwd(), "src", screen), "utf8");
      expect(source).toContain("selectW4SummaryPresentation");
      expect(source).not.toMatch(/recommendedSetAside[^\n]*(extra per paycheck|per paycheck)/i);
    }
  });

  it("uses annual wording when no usable allocation exists", () => {
    expect(selectW4SummaryPresentation([], annualShortfall)).toEqual({
      kind: "annual_fallback",
      amount: annualShortfall,
    });
  });

  it("never sums multiple employer per-paycheck recommendations", () => {
    expect(
      selectW4SummaryPresentation(
        [recommendation("Optum", 1_920), recommendation("Clinic", 480)],
        annualShortfall,
      ),
    ).toEqual({ kind: "review" });
  });
});