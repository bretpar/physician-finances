import { describe, it, expect } from "vitest";
import { computeLinkEligibility } from "@/hooks/useTransactionMatching";

describe("computeLinkEligibility", () => {
  it("allows linking two unlinked duplicate-looking transactions", () => {
    const r = computeLinkEligibility({
      selectedTxIds: ["a", "b"],
      directLinks: [],
      groupRows: [],
      liveTxIds: new Set(["a", "b"]),
    });
    expect(r.trulyLinked).toEqual([]);
    expect(r.staleLinkIds).toEqual([]);
  });

  it("treats an orphan single-sided link row as stale, not linked", () => {
    // tx 'a' has a link row whose partner side is null (other side was
    // deleted). Should not block re-linking; should mark link as stale.
    const r = computeLinkEligibility({
      selectedTxIds: ["a", "b"],
      directLinks: [
        { id: "L1", manual_transaction_id: "a", plaid_transaction_record_id: null, linked_group_id: "G1" },
      ],
      groupRows: [
        { id: "L1", manual_transaction_id: "a", plaid_transaction_record_id: null, linked_group_id: "G1" },
      ],
      liveTxIds: new Set(["a", "b"]),
    });
    expect(r.trulyLinked).toEqual([]);
    expect(r.staleLinkIds).toEqual(["L1"]);
  });

  it("treats group whose partner tx no longer exists as stale", () => {
    const r = computeLinkEligibility({
      selectedTxIds: ["a"],
      directLinks: [
        { id: "L1", manual_transaction_id: "a", plaid_transaction_record_id: "deleted", linked_group_id: "G1" },
      ],
      groupRows: [
        { id: "L1", manual_transaction_id: "a", plaid_transaction_record_id: "deleted", linked_group_id: "G1" },
      ],
      liveTxIds: new Set(["a"]), // 'deleted' not live
    });
    expect(r.trulyLinked).toEqual([]);
    expect(r.staleLinkIds).toEqual(["L1"]);
  });

  it("blocks re-linking when transaction is in a truly active group", () => {
    const r = computeLinkEligibility({
      selectedTxIds: ["a", "c"],
      directLinks: [
        { id: "L1", manual_transaction_id: "a", plaid_transaction_record_id: "b", linked_group_id: "G1" },
      ],
      groupRows: [
        { id: "L1", manual_transaction_id: "a", plaid_transaction_record_id: "b", linked_group_id: "G1" },
      ],
      liveTxIds: new Set(["a", "b", "c"]),
    });
    expect(r.trulyLinked).toHaveLength(1);
    expect(r.trulyLinked[0]).toMatchObject({ txId: "a", groupId: "G1" });
    expect(r.staleLinkIds).toEqual([]);
  });

  it("allows re-linking after partner unlinked even if denormalized fields remain", () => {
    // Caller passes no directLinks for tx 'a' (because the link row has
    // status='unlinked' and is filtered out at fetch time). Stale
    // tx.linked_group_id is handled separately by the caller, not here.
    const r = computeLinkEligibility({
      selectedTxIds: ["a", "b"],
      directLinks: [],
      groupRows: [],
      liveTxIds: new Set(["a", "b"]),
    });
    expect(r.trulyLinked).toEqual([]);
  });
});
