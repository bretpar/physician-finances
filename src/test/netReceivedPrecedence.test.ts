import { describe, it, expect } from "vitest";
import { resolveNetReceived } from "@/lib/netReceivedPrecedence";

describe("Net Received precedence", () => {
  it("saved deposited_amount beats linked Plaid amount (edit hydration)", () => {
    expect(
      resolveNetReceived({
        gross: 8130,
        savedDeposited: 7330,
        siblingAmount: 1410,
        linkedPlaidAmount: 1410,
      }),
    ).toBe(7330);
  });

  it("saved deposited_amount beats linked Plaid amount (transaction detail)", () => {
    expect(
      resolveNetReceived({
        gross: 8130,
        savedDeposited: 7330,
        linkedPlaidAmount: 1410,
        calculatedNet: 6000,
      }),
    ).toBe(7330);
  });

  it("linked Plaid sibling is the initial fallback when no saved deposited amount exists", () => {
    expect(
      resolveNetReceived({
        gross: 8130,
        savedDeposited: 0,
        siblingAmount: 1410,
      }),
    ).toBe(1410);
  });

  it("denormalized linked_plaid_amount used when no sibling present", () => {
    expect(
      resolveNetReceived({
        gross: 8130,
        linkedPlaidAmount: 1410,
      }),
    ).toBe(1410);
  });

  it("planner placeholder deposited (== gross) is skipped in favor of Plaid amount", () => {
    expect(
      resolveNetReceived({
        gross: 8130,
        savedDeposited: 8130,
        linkedPlaidAmount: 1410,
      }),
    ).toBe(1410);
  });

  it("falls back to calculated net when no deposited or Plaid amount", () => {
    expect(
      resolveNetReceived({
        gross: 8130,
        calculatedNet: 6500,
      }),
    ).toBe(6500);
  });

  it("final fallback is gross so the user always sees a number", () => {
    expect(resolveNetReceived({ gross: 8130 })).toBe(8130);
  });
});
