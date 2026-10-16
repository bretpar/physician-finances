import { describe, it, expect } from "vitest";
import { buildLinkReviewItems, manualLinkCandidates } from "@/lib/linkReview";

const base = { incomeEntries: [], transactionLinks: [], suggestions: [], bridge: null, dismissedKeys: new Set<string>(), today: "2026-10-16" };
const dep = { id: "d1", transaction_type: "income", status: "active", source_type: "plaid", amount: 3180, transaction_date: "2026-05-07", vendor: "WWEP" };
const man = { id: "m1", transaction_type: "income", status: "active", source_type: "manual", amount: 6840, transaction_date: "2026-05-06", vendor: "WWEP" };

describe("link review", () => {
  it("lists an unlinked deposit and an unconfirmed entry", () => {
    const kinds = buildLinkReviewItems({ ...base, transactions: [dep, man] }).map((i) => i.kind).sort();
    expect(kinds).toEqual(["unconfirmed_income", "unlinked_deposit"]);
  });
  it("hides reviewed items", () => {
    const items = buildLinkReviewItems({ ...base, transactions: [dep], dismissedKeys: new Set(["deposit:d1"]) });
    expect(items).toHaveLength(0);
  });
  it("skips linked and expense records", () => {
    const items = buildLinkReviewItems({ ...base, transactions: [{ ...dep, match_status: "linked" }, { ...man, transaction_type: "expense" }] });
    expect(items).toHaveLength(0);
  });
  it("merge group links every member and the stranded entry's record", () => {
    const bridge = { incomeTransactions: [], mergeGroups: [{ linked_group_id: "g", flags: ["x"], stranded_gross: 6840, surviving_counted_amount: 3180,
      members: [{ id: "d1", status: "active" }, { id: "d2", status: "merged" }, { id: "d3", status: "merged" }],
      stranded_income_entries: [{ linked_transaction_id: "m1", company: "WWEP", date: "2026-05-07" }] }] };
    const [g] = buildLinkReviewItems({ ...base, transactions: [], bridge });
    expect(g.linkAllIds?.sort()).toEqual(["d1", "d2", "d3", "m1"]);
  });
  it("offers entries for a deposit and deposits for an entry", () => {
    expect(manualLinkCandidates(dep, [dep, man]).map((t) => t.id)).toEqual(["m1"]);
    expect(manualLinkCandidates(man, [dep, man]).map((t) => t.id)).toEqual(["d1"]);
  });
});
