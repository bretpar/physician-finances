/**
 * Guard test: exactly ONE recommendation architecture.
 *
 * User-facing recommendation surfaces must derive their numbers from the
 * canonical annual allocation (`computeEventTaxTarget` /
 * `computeCanonicalEventRecommendation` / `getCanonicalBucketRatePct`).
 * `getSavingsRateForIncomeBucket` is legacy blended-rate logic and is only
 * allowed inside the canonical layer itself (where it supplies display
 * metadata and source-specific marginal rates).
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";

const ROOT = join(process.cwd(), "src");

/** Files intentionally allowed to reference the legacy helper. */
const ALLOWED = new Set<string>([
  "lib/savingsRateSelection.ts", // definition + tax-law rate helpers
  "lib/canonicalEventRecommendation.ts", // canonical layer: display metadata only
]);

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      walk(full, out);
    } else if (/\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name)) {
      out.push(full);
    }
  }
  return out;
}

describe("canonical recommendation architecture guard", () => {
  const files = walk(ROOT);

  it("has no unapproved use of getSavingsRateForIncomeBucket", () => {
    const offenders = files
      .filter((f) => readFileSync(f, "utf8").includes("getSavingsRateForIncomeBucket"))
      .map((f) => f.slice(ROOT.length + 1).replace(/\\/g, "/"))
      .filter((rel) => !ALLOWED.has(rel));
    expect(offenders).toEqual([]);
  });

  it("useW4Calculation derives future business reserves from the canonical allocation", () => {
    const src = readFileSync(join(ROOT, "hooks/useW4Calculation.ts"), "utf8");
    expect(src).toContain("getCanonicalBucketRatePct");
    expect(src).not.toContain("getSavingsRateForIncomeBucket");
  });

  it("W-4 card and bucket-rate display surfaces use the canonical helper", () => {
    for (const rel of [
      "components/tax/W4PaycheckAdjustmentCard.tsx",
      "pages/Dashboard.tsx",
      "pages/Taxes.tsx",
    ]) {
      const src = readFileSync(join(ROOT, rel), "utf8");
      expect(src, rel).toContain("getCanonicalBucketRatePct");
    }
  });
});
