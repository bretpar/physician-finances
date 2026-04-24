import { describe, it, expect } from "vitest";
import { isExcludedFromBusiness, keepBusinessOnly } from "@/lib/businessExclusion";

describe("isExcludedFromBusiness", () => {
  it("excludes when excluded_from_reports=true", () => {
    expect(
      isExcludedFromBusiness({ excluded_from_reports: true, transaction_type: "income" }),
    ).toBe(true);
  });

  it("excludes Personal-category expenses", () => {
    expect(
      isExcludedFromBusiness({ category: "Personal", transaction_type: "expense" }),
    ).toBe(true);
  });

  it("excludes transfers", () => {
    expect(isExcludedFromBusiness({ transaction_type: "transfer" })).toBe(true);
  });

  it("includes regular business income", () => {
    expect(
      isExcludedFromBusiness({
        excluded_from_reports: false,
        category: "Consulting",
        transaction_type: "income",
      }),
    ).toBe(false);
  });

  it("keepBusinessOnly removes excluded txs", () => {
    const txs = [
      { id: "a", transaction_type: "income", excluded_from_reports: false },
      { id: "b", transaction_type: "income", excluded_from_reports: true },
      { id: "c", transaction_type: "expense", category: "Personal" },
      { id: "d", transaction_type: "transfer" },
      { id: "e", transaction_type: "expense", category: "Office" },
    ] as any[];
    expect(keepBusinessOnly(txs).map((t) => t.id)).toEqual(["a", "e"]);
  });
});
