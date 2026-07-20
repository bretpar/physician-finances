/**
 * Versioned HHS federal poverty guidelines used by IDR discretionary-income
 * formulas. Values are keyed by (year, region). Never hardcode these numbers
 * elsewhere.
 *
 * Sources:
 *  - 2024/2025: aspe.hhs.gov (Federal Register FR notices)
 *  - 2026: Federal Register Vol. 91, No. 10, January 15, 2026
 *          (FR Doc. 2026-00755); aspe.hhs.gov detailed-guidelines-2026.pdf
 *
 * FSA IDR formulas historically use the PRIOR calendar year's guidelines.
 * The `povertyYear` selection lives in `computePlanPayment.ts`.
 */

import type { PovertyGuidelineTable, PovertyRegion } from "./types";

const SRC_2026 = "https://aspe.hhs.gov/topics/poverty-economic-mobility/poverty-guidelines";
const SRC_2025 = SRC_2026;
const SRC_2024 = SRC_2026;

export const POVERTY_GUIDELINES: PovertyGuidelineTable[] = [
  // ── 2026 ────────────────────────────────────────────────────────────
  {
    year: 2026,
    region: "contiguous_48_dc",
    base: 15960,
    perAdditionalPerson: 5680,
    sourceUrl: SRC_2026,
    publishedAt: "2026-01-15",
    verification: "confirmed",
  },
  {
    year: 2026,
    region: "alaska",
    base: 19950,
    perAdditionalPerson: 7100, // (69650-19950)/7 ≈ 7100
    sourceUrl: SRC_2026,
    publishedAt: "2026-01-15",
    verification: "confirmed",
  },
  {
    year: 2026,
    region: "hawaii",
    base: 18360, // provisional; not captured from PDF in July 2026 research
    perAdditionalPerson: 6540, // provisional
    sourceUrl: SRC_2026,
    publishedAt: "2026-01-15",
    verification: "pending",
  },
  // ── 2025 ────────────────────────────────────────────────────────────
  {
    year: 2025,
    region: "contiguous_48_dc",
    base: 15650,
    perAdditionalPerson: 5500,
    sourceUrl: SRC_2025,
    publishedAt: "2025-01-17",
    verification: "confirmed",
  },
  {
    year: 2025,
    region: "alaska",
    base: 19550,
    perAdditionalPerson: 6870,
    sourceUrl: SRC_2025,
    publishedAt: "2025-01-17",
    verification: "confirmed",
  },
  {
    year: 2025,
    region: "hawaii",
    base: 17990,
    perAdditionalPerson: 6320,
    sourceUrl: SRC_2025,
    publishedAt: "2025-01-17",
    verification: "confirmed",
  },
  // ── 2024 ────────────────────────────────────────────────────────────
  {
    year: 2024,
    region: "contiguous_48_dc",
    base: 15060,
    perAdditionalPerson: 5380,
    sourceUrl: SRC_2024,
    publishedAt: "2024-01-17",
    verification: "confirmed",
  },
  {
    year: 2024,
    region: "alaska",
    base: 18810,
    perAdditionalPerson: 6730,
    sourceUrl: SRC_2024,
    publishedAt: "2024-01-17",
    verification: "confirmed",
  },
  {
    year: 2024,
    region: "hawaii",
    base: 17310,
    perAdditionalPerson: 6190,
    sourceUrl: SRC_2024,
    publishedAt: "2024-01-17",
    verification: "confirmed",
  },
];

export function getPovertyTable(year: number, region: PovertyRegion): PovertyGuidelineTable {
  const exact = POVERTY_GUIDELINES.find((t) => t.year === year && t.region === region);
  if (exact) return exact;
  // Fall back to newest available for the region.
  const regional = POVERTY_GUIDELINES
    .filter((t) => t.region === region)
    .sort((a, b) => b.year - a.year);
  if (regional.length > 0) return regional[0];
  // Final fallback: newest contiguous_48_dc.
  return POVERTY_GUIDELINES.filter((t) => t.region === "contiguous_48_dc").sort(
    (a, b) => b.year - a.year,
  )[0];
}

export function computePovertyGuideline(
  familySize: number,
  year: number,
  region: PovertyRegion,
): { amount: number; table: PovertyGuidelineTable } {
  const table = getPovertyTable(year, region);
  const size = Math.max(1, Math.floor(familySize || 1));
  return {
    amount: table.base + table.perAdditionalPerson * (size - 1),
    table,
  };
}

/** Convenience: latest available poverty year across all regions. */
export function latestPovertyYear(): number {
  return POVERTY_GUIDELINES.reduce((m, t) => Math.max(m, t.year), 0);
}
