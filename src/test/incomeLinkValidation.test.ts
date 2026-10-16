import { describe, it, expect } from "vitest";
import { validateIncomeLinks } from "@/lib/incomeLinkValidation";
const tx = (o: any) => ({ transaction_type: "income", status: "active", vendor: "Vituity", amount: 1000, transaction_date: "2026-03-01", ...o });
describe("validateIncomeLinks", () => {
  it("flags two entries on one transaction as duplicate", () => {
    const r = validateIncomeLinks({ transactions: [tx({ id: "t1" })], incomeEntries: [{ id: "a", linked_transaction_id: "t1" }, { id: "b", linked_transaction_id: "t1" }] });
    expect(r.map((i) => i.kind)).toEqual(["duplicate"]);
  });
  it("flags a link to a missing record", () => {
    const r = validateIncomeLinks({ transactions: [], incomeEntries: [{ id: "a", linked_transaction_id: "gone" }] });
    expect(r[0].kind).toBe("missing");
  });
  it("flags a group with two counted records as conflicting", () => {
    const r = validateIncomeLinks({ transactions: [tx({ id: "t1", linked_group_id: "g" }), tx({ id: "t2", linked_group_id: "g", amount: 500 })], incomeEntries: [] });
    expect(r.some((i) => i.kind === "conflicting")).toBe(true);
  });
  it("reports nothing for a clean link and does not mutate input", () => {
    const input = { transactions: [tx({ id: "t1" })], incomeEntries: [{ id: "a", linked_transaction_id: "t1", income_date: "2026-03-02" }] };
    const snap = JSON.stringify(input);
    expect(validateIncomeLinks(input)).toEqual([]);
    expect(JSON.stringify(input)).toBe(snap);
  });
});
