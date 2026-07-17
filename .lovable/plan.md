# Canonical Tax Engine Consolidation

## Audit result (good news)

Every live routed page already consumes the canonical engine (`useTaxEstimate` → `calculateFullEstimate` → `TaxDebugBreakdown`). No page silently re-derives federal, SE, state, or effective-rate math. Real gaps are narrower than the brief suggests:

| Issue | Location | Type |
|---|---|---|
| SS / Medicare / Additional Medicare not on `TaxDebugBreakdown`; `useTaxBreakdown` reaches past the contract with `as any` | `taxCalculationService.ts`, `useTaxBreakdown.ts:924` | Missing canonical field |
| `TaxPlanning.tsx` uses hardcoded 20% federal, 15.3% SE, own quarterly split — unrouted but present | `src/pages/TaxPlanning.tsx` | Dead-code drift risk |
| Intentional separate calculators (W‑2 FICA, marketing quickEstimate, quarterly, per-business, per-entry reserve) exist but aren't clearly labeled as "not the engine" | `w2PayrollTax.ts`, `quickEstimate.ts`, `quarterRecommendation.ts`, `businessSummary.ts`, `useIncomeRecommendation.ts` | Documentation gap |
| No dev tooling to prove pages share one estimate instance | — | Diagnostics gap |

## Changes

### 1. Extend canonical debug contract (no math changes)

- Add `ssTax`, `medicareTax`, `additionalMedicareTax` to `TaxDebugBreakdown` in `src/lib/taxCalculationService.ts`, populated from the values `calcSelfEmploymentTax` already returns inside the engine. No new formula — just surface existing internals.
- Remove the `seTaxFromEngine as any` escape hatch in `src/hooks/useTaxBreakdown.ts` and read the new typed fields.

### 2. Retire `TaxPlanning.tsx` drift risk

- Confirm no router / dynamic import references it, then delete the file (it's a hardcoded-rate parallel engine and the biggest latent drift risk). If a maintainer wants to keep it, replace its body with a stub that reads `useTaxEstimate` — but default plan is deletion.

### 3. Label intentional separations in code comments

Add short header comments explaining *why* each of these is not the main engine and what invariant keeps them aligned:
- `src/lib/w2PayrollTax.ts` — W‑2 FICA on wages (engine's SE math covers 1099/K‑1 only).
- `src/lib/quickEstimate.ts` — unauthenticated marketing preview; not to be imported by app pages.
- `src/lib/quarterRecommendation.ts` — needs per-period inputs the debug object doesn't carry; consumes engine output.
- `src/lib/businessSummary.ts` — per-company income aggregation, not tax liability.
- `src/hooks/useIncomeRecommendation.ts` — per-entry `netTaxable × canonicalEffectiveRate`; rate always sourced from engine.

### 4. Developer-only diagnostics (no user-facing UI)

New module `src/lib/taxEngineDiagnostics.ts`:
- `registerTaxEstimateConsumer(pageName, estimate)` — records the `TaxDebugBreakdown` object identity per page in a module-level `WeakMap` keyed by React Query cache entry.
- `assertSingleEstimateInstance()` — logs a warning if two consumers on the same render pass hold different debug object identities for the same scope (`actual` vs `forecast`).
- `assertNoDrift(pageName, field, displayedValue)` — compares a UI-displayed number to the canonical field; on mismatch > $1 or 0.01 pp, logs `[taxDrift] page=X field=Y displayed=... canonical=...`.
- Gated by `localStorage["debug:taxEngine"] = "1"` (mirroring existing `debug:withholding` and `debug:taxBreakdown` toggles). Zero runtime cost when off.

New dev-only hook `src/hooks/useTaxEstimateDiagnostics.ts` that wraps `useTaxEstimate`, auto-registers the caller, and returns the estimate unchanged. Wire it into the primary consumers (`Dashboard`, `Taxes`, `TaxReserve`, `EstimatedTax`, `QuarterlyTaxPlanner`, `ProjectedIncome`, `PersonalIncome`, `Reports`, `W4PaycheckAdjustmentCard`) so the diagnostic sees them; behavior identical to `useTaxEstimate` when the flag is off.

### 5. Tests

- Extend `src/test/unifiedTaxEngine.test.ts` (or add `src/test/taxDebugBreakdownFields.test.ts`) asserting the three new FICA fields equal the sum reported by `selfEmploymentTax` for representative scenarios.
- Add `src/test/taxEngineDiagnostics.test.ts` covering: registration, single-instance assertion, and drift detection with the flag on.

## Explicit non-goals (per constraints)

- No changes to tax formulas, rates, brackets, or deductions.
- No QBI, no NIIT.
- No schema changes.
- No onboarding, transaction, or user-visible UI changes.
- Not folding `quarterRecommendation` or `businessSummary` into `TaxDebugBreakdown` — they need out-of-scope inputs (dates, per-company splits); they stay as separate canonical modules with clarifying comments.

## Files touched

```text
src/lib/taxCalculationService.ts          (add 3 fields)
src/lib/taxEngine.ts                      (expose SE breakdown to service; may already return it)
src/hooks/useTaxBreakdown.ts              (drop `as any` cast)
src/lib/w2PayrollTax.ts                   (header comment)
src/lib/quickEstimate.ts                  (header comment)
src/lib/quarterRecommendation.ts          (header comment)
src/lib/businessSummary.ts                (header comment)
src/hooks/useIncomeRecommendation.ts      (header comment)
src/lib/taxEngineDiagnostics.ts           (new)
src/hooks/useTaxEstimateDiagnostics.ts    (new, thin wrapper)
src/pages/{Dashboard,Taxes,TaxReserve,EstimatedTax,QuarterlyTaxPlanner,ProjectedIncome,PersonalIncome,Reports}.tsx  (swap hook import)
src/components/tax/W4PaycheckAdjustmentCard.tsx  (swap hook import)
src/pages/TaxPlanning.tsx                 (delete, pending confirmation it's unrouted)
src/test/taxDebugBreakdownFields.test.ts  (new)
src/test/taxEngineDiagnostics.test.ts     (new)
```

Confirm before I start? In particular: OK to delete `src/pages/TaxPlanning.tsx` if grep confirms zero references in the router?
