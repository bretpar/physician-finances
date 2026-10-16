import { describe, it, expect } from "vitest";
import { applyMergeLineageGross, lineageConfirmationKey } from "@/lib/taxRecordSelection";

// Anonymized shapes reproducing the real Vituity/WWEP groups (no personal data).
const SRC = "src-k1";
function vituityGroup(gid: string, date: string, gross: number, deposit: number, savedNet: number) {
  const survivor = { id: `${gid}-plaid`, transaction_type: "income", status: "active", source_type: "plaid", linked_group_id: gid, amount: deposit, transaction_date: date, source_id: SRC };
  const merged = { id: `${gid}-manual`, transaction_type: "income", status: "merged", source_type: "manual", linked_group_id: gid, amount: gross, transaction_date: date, source_id: SRC };
  const mirror = { id: `${gid}-mirror`, linked_transaction_id: survivor.id, income_type: "k1", paycheck_amount: deposit, gross_amount: 0, deposited_amount: 0, retirement_401k: 0, employer_retirement_contribution: 0, healthcare_deduction: 0, income_date: date, source_id: SRC };
  const stub = { id: `${gid}-stub`, linked_transaction_id: merged.id, income_type: "k1", paycheck_amount: gross, gross_amount: 0, deposited_amount: savedNet, retirement_401k: 181.25, employer_retirement_contribution: 351.85, healthcare_deduction: 2493, income_date: date, source_id: SRC };
  return { txs: [survivor, merged], entries: [mirror, stub] };
}

describe("merge lineage — real account shapes", () => {
  it("truncated Net Received + imported mirror is proposed, not applied, until confirmed", () => {
    const g = vituityGroup("g1", "2026-02-17", 17770, 14542.98, 14542);
    const r = applyMergeLineageGross(g.txs, g.entries);
    expect(r.findings[0].status).toBe("proposed_pending_confirmation");
    expect(r.findings[0].proposedMapping).toMatchObject({ gross: 17770, survivorDeposit: 14542.98, savedNetReceived: 14542, mirrorEntryId: "g1-mirror" });
    expect(r.transactions).toBe(g.txs); // nothing changed
    expect(r.incomeEntries).toBe(g.entries);
  });

  it("after confirmation counts gross once and drops only the mirror copy", () => {
    const g = vituityGroup("g1", "2026-02-17", 17770, 14542.98, 14542);
    const r = applyMergeLineageGross(g.txs, g.entries, { confirmedGroupIds: new Set(["g1"]) });
    expect(r.findings[0].status).toBe("authoritative_gross_applied");
    expect(r.transactions.find((t) => t.id === "g1-plaid")!.amount).toBe(17770);
    expect(r.incomeEntries.map((e) => e.id)).toEqual(["g1-stub"]);
    expect(r.incomeEntries[0].linked_transaction_id).toBe("g1-plaid");
    expect(lineageConfirmationKey("g1")).toBe("lineage-confirm:g1");
    expect(g.txs[0].amount).toBe(14542.98); // originals untouched
  });

  it("does not widen tolerance: a Net Received off by more than the dropped cents stays ambiguous", () => {
    const g = vituityGroup("g2", "2026-03-16", 24228.52, 20807.74, 20806);
    const r = applyMergeLineageGross(g.txs, g.entries, { confirmedGroupIds: new Set(["g2"]) });
    expect(r.findings[0].status).toBe("ambiguous");
    expect(r.transactions.find((t) => t.id === "g2-plaid")!.amount).toBe(20807.74);
  });

  it("a survivor entry with its own deductions is not treated as a mirror", () => {
    const g = vituityGroup("g3", "2026-04-15", 15210, 12059.78, 12059);
    (g.entries[0] as any).retirement_401k = 100;
    const r = applyMergeLineageGross(g.txs, g.entries, { confirmedGroupIds: new Set(["g3"]) });
    expect(r.findings[0].status).toBe("ambiguous");
  });

  it("WWEP-style group with three separate receipts stays unresolved and lists the components", () => {
    const gid = "w";
    const txs = [
      { id: "a", transaction_type: "income", status: "active", source_type: "plaid", linked_group_id: gid, amount: 3180 },
      { id: "b", transaction_type: "income", status: "merged", source_type: "plaid", linked_group_id: gid, amount: 300 },
      { id: "c", transaction_type: "income", status: "merged", source_type: "plaid", linked_group_id: gid, amount: 3360 },
      { id: "p", transaction_type: "income", status: "merged", source_type: "merged", linked_group_id: gid, amount: 6840 },
    ];
    const entries = [
      { id: "e1", linked_transaction_id: "a", paycheck_amount: 3180, deposited_amount: 300 },
      { id: "e2", linked_transaction_id: "p", paycheck_amount: 6840, deposited_amount: 0, retirement_401k: 750 },
    ];
    const r = applyMergeLineageGross(txs, entries, { confirmedGroupIds: new Set([gid]) });
    expect(r.findings[0].status).toBe("ambiguous");
    expect(r.findings[0].components?.map((c) => c.amount).sort((x, y) => x - y)).toEqual([300, 3360]);
    expect(r.transactions).toBe(txs);
  });
});
