import { describe, it, expect } from "vitest";
import { decideW2PaycheckRecDisplay } from "@/lib/w2PaycheckRecMethod";

describe("decideW2PaycheckRecDisplay — W-2 paycheck recommendation method", () => {
  describe("paycheck_target method (legacy)", () => {
    it("returns null for W-2 entries so caller renders legacy paycheck-target UI", () => {
      const out = decideW2PaycheckRecDisplay({
        method: "paycheck_target",
        isW2: true,
        signedAnnualGap: 5000,
        extraPerPaycheck: 200,
      });
      expect(out).toBeNull();
    });

    it("returns null for non-W-2 entries regardless of method", () => {
      const out = decideW2PaycheckRecDisplay({
        method: "paycheck_target",
        isW2: false,
        signedAnnualGap: 12345,
        extraPerPaycheck: 500,
      });
      expect(out).toBeNull();
    });
  });

  describe("annual_w4 method — W-2 only", () => {
    it("falls back to legacy UI for non-W-2 entries (hybrid users)", () => {
      const out = decideW2PaycheckRecDisplay({
        method: "annual_w4",
        isW2: false,
        signedAnnualGap: 8000,
        extraPerPaycheck: 300,
      });
      expect(out).toBeNull();
    });

    it("shows on-track messaging when annual W-4 gap is $0", () => {
      const out = decideW2PaycheckRecDisplay({
        method: "annual_w4",
        isW2: true,
        signedAnnualGap: 0,
        extraPerPaycheck: 250, // ignored on-track
      });
      expect(out).not.toBeNull();
      expect(out!.mode).toBe("w4_on_track");
      expect(out!.primary).toMatch(/no extra w-4 withholding/i);
      expect(out!.amount).toBeNull();
    });

    it("shows on-track messaging when annual W-4 gap is negative (over-withheld)", () => {
      const out = decideW2PaycheckRecDisplay({
        method: "annual_w4",
        isW2: true,
        signedAnnualGap: -1500,
        extraPerPaycheck: 0,
      });
      expect(out!.mode).toBe("w4_on_track");
      expect(out!.amount).toBeNull();
    });

    it("shows W-4 adjustment recommendation when annual gap > 0", () => {
      const out = decideW2PaycheckRecDisplay({
        method: "annual_w4",
        isW2: true,
        signedAnnualGap: 5200,
        extraPerPaycheck: 425,
      });
      expect(out!.mode).toBe("w4_extra_needed");
      expect(out!.primary).toMatch(/w-4 adjustment recommended.*\$425.*per paycheck/i);
      expect(out!.amount).toBe(425);
      expect(out!.rightLabel).toBe("Extra per paycheck");
    });

    it("rounds per-paycheck amount to nearest dollar and never goes negative", () => {
      const out = decideW2PaycheckRecDisplay({
        method: "annual_w4",
        isW2: true,
        signedAnnualGap: 1000,
        extraPerPaycheck: -50, // floor at 0
      });
      expect(out!.amount).toBe(0);
    });

    it("references the W-4 Calculator tab in secondary copy", () => {
      const out = decideW2PaycheckRecDisplay({
        method: "annual_w4",
        isW2: true,
        signedAnnualGap: 100,
        extraPerPaycheck: 25,
      });
      expect(out!.secondary).toMatch(/W-4 Calculator/);
    });
  });

  describe("Acceptance: confusing 'save extra hundreds' is suppressed for W-2-only on-track users", () => {
    it("never shows 'extra needed' or 'save' messaging when annual_w4 + gap=0", () => {
      const out = decideW2PaycheckRecDisplay({
        method: "annual_w4",
        isW2: true,
        signedAnnualGap: 0,
        extraPerPaycheck: 0,
      });
      expect(out!.primary.toLowerCase()).not.toMatch(/extra needed/);
      expect(out!.primary.toLowerCase()).not.toMatch(/save/);
    });
  });
});
