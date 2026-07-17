
# HSA Annual Limits & Excess-Contribution Protection

## Scope

Add tax-year HSA legal-limit tracking. Preserve existing correct behavior for payroll HSA federal deduction, direct individual HSA deduction, payroll HSA FICA exclusion, ledger sync, and payroll-HSA double-deduction avoidance.

## 1. Centralized per-year limit config

New file: `src/lib/hsaLimits.ts`

```
export type HsaCoverageType = "individual" | "family";
export interface HsaLimits {
  taxYear: number;
  individual: number;
  family: number;
  catchUp: number;   // age 55+
}
export const HSA_LIMITS_BY_YEAR: Record<number, HsaLimits> = {
  2023: { taxYear: 2023, individual: 3850,  family: 7750,  catchUp: 1000 },
  2024: { taxYear: 2024, individual: 4150,  family: 8300,  catchUp: 1000 },
  2025: { taxYear: 2025, individual: 4300,  family: 8550,  catchUp: 1000 },
  2026: { taxYear: 2026, individual: 4400,  family: 8750,  catchUp: 1000 },
};
export function getHsaLimits(year: number): HsaLimits { /* fallback to latest */ }
export function getApplicableHsaLimit(year, coverage, catchUp): number;
```

New file: `src/lib/hsaComputation.ts`

```
computeHsaContributionSummary({
  taxYear, coverage, catchUpEligible,
  contributions: HsaContribution[],  // filtered externally or by taxYear
  employerContribution?: number,     // future — accepted but currently 0
}): {
  payrollEmployee, individual, employer, total,
  applicableLimit, remaining, excess,
  deductibleTotal,           // = min(total, applicableLimit)
  deductiblePayroll,         // uncapped payroll (already reduced W-2 upstream)
  deductibleIndividual,      // = max(0, applicableLimit - payrollEmployee - employer) capped at individual
}
```

Rule for cap:
- Payroll HSA already reduced W-2 wages upstream. Do NOT retroactively add it back.
- The above-the-line individual HSA deduction is reduced so that (payroll + employer + allowedIndividual) never exceeds the applicable limit.
- If payroll alone > limit: allowedIndividual = 0 and `excess = total - limit` surfaced in UI/PDF, but the engine does NOT create a negative deduction.

## 2. Settings + schema

Migration `add_hsa_coverage_and_catchup` adds to `tax_settings`:
- `hsa_coverage_type text default 'individual'` check in `('individual','family')`
- `hsa_age55_catchup boolean default false`

Update `useTaxSettings.ts` (types, DEFAULT_RATES, mapper, updater payload).

## 3. Settings UI

`src/components/settings/HsaSection.tsx`: when `hsaEnabled`, show
- Coverage type radio (Individual / Family)
- Age-55 catch-up toggle

## 4. Deductions page HSA card

Update the HSA display block (Deductions page) to show:
- Coverage type + annual limit
- Employee payroll / Individual / Total contributions
- Progress: "$X of $Y used" with progress bar
- Remaining
- Excess warning (destructive alert) when over limit

## 5. Tax engine wiring

`useTaxBreakdown.ts` / consumers that pass `personalNonW2HsaAboveLine` and `businessNonW2HsaAboveLine`:
- Pull the ledger for the tax year, compute summary via `computeHsaContributionSummary` using user's coverage/catch-up settings.
- Cap the non-W2 (individual) HSA above-the-line at `deductibleIndividual` instead of raw ledger sum.
- Payroll HSA path unchanged (already flows through W-2 wages upstream; engine untouched there).

`taxCalculationService.ts` and `taxEngine.ts` — no signature change needed; caller passes already-capped values. Add a debug field `nonW2HsaAboveLineDeductionCapped` = value passed in (documenting cap application at caller).

## 6. Reports + PDF

- `src/pages/Reports.tsx`: change `hsa` deduction line to show total contributions and deductible amount side-by-side, plus excess line when > 0. CSV: emit `HSA Contributions (Total)`, `HSA Deductible Applied`, `HSA Excess`.
- `src/lib/taxPrepPdf.ts`: `DeductionsSummary.hsa` split into `{ total, deductible, excess }`; render as three rows; only `deductible` is counted in totals.

Historical: Reports already scope contributions by `taxYear`; use `getHsaLimits(taxYear)` so old reports use the old limit.

## 7. Tests

`src/test/hsaLimits.test.ts` — pure computation:
1. Individual below limit
2. Individual at limit
3. Individual above limit → excess > 0, deductible capped
4. Family coverage
5. Age-55 catch-up (limit += 1000)
6. Payroll + direct combined below limit
7. Contributions in 2024 vs 2025 use different limits
8. Payroll alone > limit → allowedIndividual = 0, deductible = limit, excess = payroll − limit, no negative deduction
9. Direct added after payroll fills limit → direct is fully treated as excess
10. Parity test asserting Tax Overview total, Deductions page total, Reports total, and PDF total all use `computeHsaContributionSummary` (imports the same helper and equal totals for a fixed fixture)

Preserve `src/test/hsaClassification.test.ts` and `src/test/w2PayrollTax.test.ts` fixtures unchanged.

## Verification

- `npx tsgo --noEmit`
- `bunx vitest run src/test/hsaLimits.test.ts src/test/hsaClassification.test.ts src/test/w2PayrollTax.test.ts src/test/taxEngine.test.ts src/test/taxPrepPdfSummary.test.ts src/lib/taxValidation`

## Out of scope (deferred per your note)

- Employer HSA contribution ingestion UI/schema — helper accepts `employerContribution` param but no ingestion yet.
- Excess-withdrawal / 6% excise-tax modeling.

Approve and I'll implement in one pass.
