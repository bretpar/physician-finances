import { describe, it, expect } from "vitest";
import {
  computeCategoryUsage,
  sortCategoriesByUsage,
  frequentlyUsedCategories,
} from "@/lib/categoryUsage";

const CATALOG = ["Advertising", "Supplies", "Travel", "Meals", "Utilities"];

describe("categoryUsage", () => {
  it("counts usage and tracks recency", () => {
    const usage = computeCategoryUsage([
      { category: "Travel", transaction_date: "2026-01-02" },
      { category: "Travel", transaction_date: "2026-03-02" },
      { category: "Meals", transaction_date: "2026-05-02" },
      { category: "Uncategorized", transaction_date: "2026-05-02" },
      { category: null, transaction_date: "2026-05-02" },
    ]);
    expect(usage.stats.Travel.count).toBe(2);
    expect(usage.stats.Meals.count).toBe(1);
    expect(usage.stats.Uncategorized).toBeUndefined();
    expect(usage.stats.Travel.lastUsed).toBe(Date.parse("2026-03-02"));
  });

  it("keeps default order with no history", () => {
    expect(sortCategoriesByUsage(CATALOG, computeCategoryUsage([]))).toEqual(CATALOG);
    expect(sortCategoriesByUsage(CATALOG, null)).toEqual(CATALOG);
  });

  it("sorts by count, then recency, then catalog order", () => {
    const usage = computeCategoryUsage([
      { category: "Travel", transaction_date: "2026-01-01" },
      { category: "Travel", transaction_date: "2026-01-02" },
      { category: "Meals", transaction_date: "2026-06-01" },
      { category: "Utilities", transaction_date: "2026-02-01" },
    ]);
    expect(sortCategoriesByUsage(CATALOG, usage)).toEqual([
      "Travel",
      "Meals",
      "Utilities",
      "Advertising",
      "Supplies",
    ]);
  });

  it("drops categories that are no longer in the catalog and never duplicates", () => {
    const usage = computeCategoryUsage([
      { category: "Retired Category", transaction_date: "2026-01-01" },
      { category: "Meals", transaction_date: "2026-01-01" },
      { category: "Travel", transaction_date: "2026-01-01" },
    ]);
    const sorted = sortCategoriesByUsage(CATALOG, usage);
    expect(sorted).not.toContain("Retired Category");
    expect(new Set(sorted).size).toBe(sorted.length);
    expect(sorted.length).toBe(CATALOG.length);
  });

  it("frequently used requires >= 2 distinct categories and caps at 5", () => {
    const one = computeCategoryUsage([{ category: "Meals", transaction_date: "2026-01-01" }]);
    expect(frequentlyUsedCategories(CATALOG, one)).toEqual([]);

    const many = computeCategoryUsage(
      CATALOG.map((c, i) => ({ category: c, transaction_date: `2026-01-0${i + 1}` })),
    );
    expect(frequentlyUsedCategories(CATALOG, many, 3)).toHaveLength(3);
    expect(frequentlyUsedCategories(CATALOG, many)).toHaveLength(5);
  });
});
