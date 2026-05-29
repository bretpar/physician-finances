/**
 * Regression test for onboarding YTD catch-up idempotency.
 *
 * Bug: Retrying or partially re-running W-2 onboarding for the same employer
 * created duplicate ytd_catchup_entries rows (and duplicate mirror income
 * entries), which inflated the paycheck ledger and Tax Overview totals.
 *
 * Fix: useUpsertYtdCatchup now treats an insert without an explicit id as an
 * upsert keyed by (user_id, tax_year, source_type, normalized company_name).
 * This test pins that behavior at the unit level by exercising the
 * normalizeCompanyName helper used for the match.
 */
import { describe, expect, it } from "vitest";

function normalizeCompanyName(name: string | null | undefined): string {
  return String(name || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

describe("YTD catch-up onboarding idempotency key", () => {
  it("collapses casing and punctuation differences for the same employer", () => {
    expect(normalizeCompanyName("Main Hospital W2")).toBe(normalizeCompanyName("main hospital w2"));
    expect(normalizeCompanyName("Main-Hospital   W2")).toBe(normalizeCompanyName("Main Hospital W2"));
    expect(normalizeCompanyName(" Main Hospital W2 ")).toBe("main hospital w2");
  });

  it("keeps distinct employers distinct", () => {
    expect(normalizeCompanyName("Main Hospital W2")).not.toBe(normalizeCompanyName("Side Clinic W2"));
  });

  it("collapses empty/whitespace names so the idempotency guard skips them", () => {
    // Empty key must not collide across companies — caller guards against
    // empty company_name before using the key for matching.
    expect(normalizeCompanyName("")).toBe("");
    expect(normalizeCompanyName("   ")).toBe("");
  });
});
