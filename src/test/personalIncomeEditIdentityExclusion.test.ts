/**
 * Edit Income must exclude exactly the paycheck being edited from its own
 * annual baseline — by entry ID for direct entries, by linked transaction ID
 * for bank/Planner-linked rows — and the preview must show cents.
 */
import { describe, it, expect } from "vitest";
import { excludeIncomeEntriesLinkedToTransaction } from "@/lib/taxRecommendationContext";
import { recommendationDisplayCents } from "@/lib/personalIncomeRecommendationAdapters";

const directEdited = { id: "pi-direct-1", linked_transaction_id: null, gross_amount: 10_000, federal_withholding: 500 };
const directOther = { id: "pi-direct-2", linked_transaction_id: null, gross_amount: 8_000, federal_withholding: 900 };
const linkedRow = { id: "pi-linked-3", linked_transaction_id: "tx-bank-9", gross_amount: 7_000, federal_withholding: 700 };
const rows = [directEdited, directOther, linkedRow];
const sum = (r: typeof rows) => r.reduce((s, e) => s + e.gross_amount, 0);

describe("Personal Income edit exclusion identity", () => {
  it("excludes a directly entered paycheck by its own ID and keeps the other paycheck", () => {
    const out = excludeIncomeEntriesLinkedToTransaction(rows, "pi-direct-1");
    expect(out.map((e) => e.id)).toEqual(["pi-direct-2", "pi-linked-3"]);
    expect(sum(out)).toBe(15_000);
  });

  it("excludes a linked paycheck by its linked transaction ID only", () => {
    const out = excludeIncomeEntriesLinkedToTransaction(rows, "tx-bank-9");
    expect(out.map((e) => e.id)).toEqual(["pi-direct-1", "pi-direct-2"]);
  });

  it("excludes nothing when not editing or the ID is unknown (no duplicate or lost income)", () => {
    expect(sum(excludeIncomeEntriesLinkedToTransaction(rows, null))).toBe(25_000);
    expect(excludeIncomeEntriesLinkedToTransaction(rows, "unrelated")).toHaveLength(3);
  });
});

describe("Personal Income preview display precision", () => {
  it("shows the canonical recommendation to the cent, not whole dollars", () => {
    expect(recommendationDisplayCents(964.17)).toBe(964.17);
    expect(recommendationDisplayCents(964.166666)).toBe(964.17);
    expect(recommendationDisplayCents(-5)).toBe(0);
  });
});
