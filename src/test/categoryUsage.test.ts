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

describe("categoryUsage regression: ordering integrity", () => {
  const CATALOG_LG = [
    "Advertising",
    "Supplies",
    "Travel",
    "Meals",
    "Utilities",
    "Insurance",
    "Home Office",
  ];

  it("never duplicates and never surfaces archived/unavailable categories", () => {
    const usage = computeCategoryUsage([
      // heavy usage of a category that has since been archived
      ...Array.from({ length: 9 }, (_, i) => ({
        category: "Archived Category",
        transaction_date: `2026-02-0${i + 1}`,
      })),
      { category: "Travel", transaction_date: "2026-04-01" },
      { category: "Travel", transaction_date: "2026-04-05" },
      { category: "Meals", transaction_date: "2026-06-01" },
      { category: "Meals", transaction_date: "2026-06-02" },
      { category: "Supplies", transaction_date: "2026-01-01" },
      // duplicate-prone: same category repeated many times
      { category: "Supplies", transaction_date: "2026-01-01" },
    ]);

    const sorted = sortCategoriesByUsage(CATALOG_LG, usage);

    // no duplicates
    expect(new Set(sorted).size).toBe(sorted.length);
    // exact catalog membership, nothing added or dropped
    expect(sorted.length).toBe(CATALOG_LG.length);
    expect([...sorted].sort()).toEqual([...CATALOG_LG].sort());
    // archived category never leaks through either surface
    expect(sorted).not.toContain("Archived Category");
    expect(frequentlyUsedCategories(CATALOG_LG, usage)).not.toContain("Archived Category");

    // ordering contract: count desc, then recency desc, then catalog order
    expect(sorted).toEqual([
      "Meals", // 2 uses, most recent
      "Travel", // 2 uses, older
      "Supplies", // 2 uses, oldest
      "Advertising",
      "Utilities",
      "Insurance",
      "Home Office",
    ]);
  });

  it("frequently-used shortlist is a deduped subset of the catalog", () => {
    const usage = computeCategoryUsage(
      CATALOG_LG.flatMap((c, i) =>
        Array.from({ length: CATALOG_LG.length - i }, (_, n) => ({
          category: c,
          transaction_date: `2026-03-${String(n + 1).padStart(2, "0")}`,
        })),
      ).concat([{ category: "Ghost Category", transaction_date: "2026-12-31" }]),
    );

    const top = frequentlyUsedCategories(CATALOG_LG, usage);
    expect(new Set(top).size).toBe(top.length);
    expect(top.every((c) => CATALOG_LG.includes(c))).toBe(true);
    expect(top).toEqual(["Advertising", "Supplies", "Travel", "Meals", "Utilities"]);

    // shortlist order must match the full sorted order's prefix
    expect(top).toEqual(sortCategoriesByUsage(CATALOG_LG, usage).slice(0, top.length));
  });
});
