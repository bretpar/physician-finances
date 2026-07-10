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

  describe("edge cases — null/undefined and gross-equal deposited_amount", () => {
    it("undefined savedDeposited falls through to sibling amount", () => {
      expect(
        resolveNetReceived({
          gross: 8130,
          savedDeposited: undefined,
          siblingAmount: 1410,
          linkedPlaidAmount: 1410,
        }),
      ).toBe(1410);
    });

    it("null savedDeposited falls through to sibling amount", () => {
      expect(
        resolveNetReceived({
          gross: 8130,
          savedDeposited: null,
          siblingAmount: 1410,
        }),
      ).toBe(1410);
    });

    it("null savedDeposited with no sibling falls through to linkedPlaidAmount", () => {
      expect(
        resolveNetReceived({
          gross: 8130,
          savedDeposited: null,
          siblingAmount: null,
          linkedPlaidAmount: 1410,
        }),
      ).toBe(1410);
    });

    it("undefined savedDeposited with no Plaid data falls through to calculated net", () => {
      expect(
        resolveNetReceived({
          gross: 8130,
          savedDeposited: undefined,
          siblingAmount: undefined,
          linkedPlaidAmount: undefined,
          calculatedNet: 6500,
        }),
      ).toBe(6500);
    });

    it("all null/undefined inputs return gross as the final fallback", () => {
      expect(
        resolveNetReceived({
          gross: 8130,
          savedDeposited: null,
          siblingAmount: null,
          linkedPlaidAmount: null,
          calculatedNet: null,
        }),
      ).toBe(8130);
    });

    it("savedDeposited exactly equal to gross is treated as planner placeholder → sibling wins", () => {
      expect(
        resolveNetReceived({
          gross: 7330,
          savedDeposited: 7330,
          siblingAmount: 1410,
          linkedPlaidAmount: 1410,
        }),
      ).toBe(1410);
    });

    it("savedDeposited ≈ gross (within 0.5 tolerance) is treated as placeholder", () => {
      expect(
        resolveNetReceived({
          gross: 7330,
          savedDeposited: 7330.25,
          linkedPlaidAmount: 1410,
        }),
      ).toBe(1410);
    });

    it("savedDeposited just outside tolerance (>0.5 diff from gross) is honored", () => {
      expect(
        resolveNetReceived({
          gross: 7330,
          savedDeposited: 7329,
          linkedPlaidAmount: 1410,
        }),
      ).toBe(7329);
    });

    it("savedDeposited == gross with no Plaid data falls through to calculated net", () => {
      expect(
        resolveNetReceived({
          gross: 8130,
          savedDeposited: 8130,
          calculatedNet: 6500,
        }),
      ).toBe(6500);
    });

    it("savedDeposited == gross with no Plaid or calculated net falls through to gross", () => {
      expect(
        resolveNetReceived({
          gross: 8130,
          savedDeposited: 8130,
        }),
      ).toBe(8130);
    });

    it("zero savedDeposited is not treated as an explicit override", () => {
      expect(
        resolveNetReceived({
          gross: 8130,
          savedDeposited: 0,
          linkedPlaidAmount: 1410,
        }),
      ).toBe(1410);
    });

    it("negative Plaid sibling amount is normalized via absolute value", () => {
      expect(
        resolveNetReceived({
          gross: 8130,
          savedDeposited: null,
          siblingAmount: -1410,
        }),
      ).toBe(1410);
    });
  });
});

