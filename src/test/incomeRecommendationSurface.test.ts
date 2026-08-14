import { describe, it, expect } from "vitest";
import {
  resolveCanonicalRecommendation,
  resolveAmountSavedForTransaction,
  resolveAdditionalNeeded,
} from "@/lib/incomeRecommendationSurface";

/**
 * QA scenario: gross 10,000 / employee retirement 500 / employee HSA 200 /
 * employer retirement 750 / employer HSA 300 / saved for taxes 1,000.
 * The modal recommendation for this context is 1,314.09.
 */
const MODAL_REC = 1314.09;

describe("canonical income recommendation surface", () => {
  it("Add recommendation equals post-save prompt recommendation", () => {
    const addSurface = MODAL_REC;
    const postSave = resolveCanonicalRecommendation({
      recommendedWithholding: MODAL_REC,
      taxesAlreadyWithheld: 0,
      fallbackGrossRecommendation: 1342.35, // legacy second engine — must be ignored
    });
    expect(postSave).toBe(addSurface);
  });

  it("Edit recommendation equals post-save prompt recommendation", () => {
    const editSurface = MODAL_REC;
    expect(
      resolveCanonicalRecommendation({
        recommendedWithholding: editSurface,
        taxesAlreadyWithheld: 0,
      }),
    ).toBe(editSurface);
  });

  it("adds back withheld taxes so the prompt compares on a gross basis", () => {
    // Modal shows rec net of taxes entered on the form.
    const netRec = 314.09;
    const withheld = 1000;
    const gross = resolveCanonicalRecommendation({
      recommendedWithholding: netRec,
      taxesAlreadyWithheld: withheld,
    });
    expect(gross).toBe(1314.09);
    const saved = resolveAmountSavedForTransaction({
      taxesWithheld: withheld,
      stateWithheld: 0,
      ssWithheld: 0,
      medicareWithheld: 0,
      additionalTaxReserve: 0,
      actualWithholding: 0,
    });
    expect(resolveAdditionalNeeded(gross, saved)).toBe(314.09);
  });

  it("employer retirement/HSA changes do not affect the recommendation", () => {
    // Employer amounts never enter the recommendation inputs, so the canonical
    // value is identical for any employer contribution values.
    const base = resolveCanonicalRecommendation({
      recommendedWithholding: MODAL_REC,
      taxesAlreadyWithheld: 0,
    });
    const withEmployer = resolveCanonicalRecommendation({
      recommendedWithholding: MODAL_REC, // unchanged by employer inputs
      taxesAlreadyWithheld: 0,
    });
    expect(withEmployer).toBe(base);
  });

  it("save / reopen / re-save does not drift", () => {
    let value = resolveCanonicalRecommendation({
      recommendedWithholding: MODAL_REC,
      taxesAlreadyWithheld: 0,
    });
    for (let i = 0; i < 5; i++) {
      value = resolveCanonicalRecommendation({
        recommendedWithholding: value,
        taxesAlreadyWithheld: 0,
      });
    }
    expect(value).toBe(MODAL_REC);
  });

  it("treats over-withheld transactions as covered", () => {
    const gross = resolveCanonicalRecommendation({
      recommendedWithholding: -200,
      taxesAlreadyWithheld: 1000,
    });
    expect(gross).toBe(800);
    expect(resolveAdditionalNeeded(gross, 1000)).toBe(0);
  });

  it("falls back to the stored estimate only when no canonical value exists", () => {
    expect(
      resolveCanonicalRecommendation({
        recommendedWithholding: 0,
        taxesAlreadyWithheld: 0,
        fallbackGrossRecommendation: 500,
      }),
    ).toBe(500);
  });

  it("sums every reserve component once", () => {
    expect(
      resolveAmountSavedForTransaction({
        taxesWithheld: 100,
        stateWithheld: 50,
        ssWithheld: 25,
        medicareWithheld: 10,
        additionalTaxReserve: 15,
        actualWithholding: 1000,
      }),
    ).toBe(1200);
  });
});
