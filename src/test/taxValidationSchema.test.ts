// ============================================================================
// Compile-time + runtime schema guards for the Tax Validation Suite.
//
// Ensures the baseline JSON, SCENARIOS library, and ScenarioValues interface
// stay in lockstep. If a validated field is added/removed or a scenario id
// is renamed without updating the baseline, these tests (and the TS compiler)
// fail loudly instead of silently defaulting to 0.
// ============================================================================

import { describe, expect, it } from "vitest";
import {
  SCENARIOS,
  VALIDATED_FIELDS,
  type ValidatedField,
} from "@/lib/taxValidation/scenarios";
import type { ScenarioValues } from "@/lib/taxValidation/runValidation";
import baseline from "@/lib/taxValidation/expected.generated.json";

// ---------------------------------------------------------------------------
// Compile-time checks (fail `tsgo` if the shapes drift).
// ---------------------------------------------------------------------------

/** Assert `A` is assignable to `B` at compile time. */
type AssertAssignable<A, B extends A> = B;
/** Assert two types are mutually assignable. */
type AssertEqual<A, B> = [A] extends [B]
  ? [B] extends [A]
    ? true
    : never
  : never;

// 1. Every ValidatedField must be a key of ScenarioValues.
type _FieldsCoverScenarioValues = AssertAssignable<
  keyof ScenarioValues,
  ValidatedField
>;

// 2. ScenarioValues (with qbiDeduction defaulted) must cover exactly
//    the validated field set — no orphan keys, no missing ones.
type RequiredScenarioValues = Required<ScenarioValues>;
type _ExactFieldParity = AssertEqual<
  keyof RequiredScenarioValues,
  ValidatedField
>;

// 3. Baseline entries must be typed as ScenarioValues records.
const _typedBaseline: Record<string, ScenarioValues> =
  baseline as unknown as Record<string, ScenarioValues>;

// Reference the type aliases so `tsgo` reports drift instead of "unused".
type _Guards = [
  _FieldsCoverScenarioValues,
  _ExactFieldParity,
  typeof _typedBaseline,
];

// ---------------------------------------------------------------------------
// Runtime checks — catch data drift the compiler cannot see.
// ---------------------------------------------------------------------------

const baselineRecord = baseline as unknown as Record<
  string,
  Partial<Record<ValidatedField, number>>
>;

describe("Tax Validation Suite — schema integrity", () => {
  it("scenario ids are unique", () => {
    const ids = SCENARIOS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every scenario has a baseline entry", () => {
    const missing = SCENARIOS.filter((s) => !baselineRecord[s.id]).map(
      (s) => s.id,
    );
    expect(missing).toEqual([]);
  });

  it("baseline has no orphan scenario ids", () => {
    const known = new Set(SCENARIOS.map((s) => s.id));
    const orphans = Object.keys(baselineRecord).filter((id) => !known.has(id));
    expect(orphans).toEqual([]);
  });

  it("every baseline entry contains every validated field as a finite number", () => {
    const problems: string[] = [];
    for (const [id, entry] of Object.entries(baselineRecord)) {
      for (const field of VALIDATED_FIELDS) {
        const value = entry[field];
        if (typeof value !== "number" || !Number.isFinite(value)) {
          problems.push(`${id}.${field} = ${String(value)}`);
        }
      }
    }
    expect(problems).toEqual([]);
  });

  it("baseline entries expose no unknown fields", () => {
    const known = new Set<string>(VALIDATED_FIELDS);
    const problems: string[] = [];
    for (const [id, entry] of Object.entries(baselineRecord)) {
      for (const key of Object.keys(entry)) {
        if (!known.has(key)) problems.push(`${id}.${key}`);
      }
    }
    expect(problems).toEqual([]);
  });
});
