
## Research findings (July 2026, sourced from studentaid.gov, ed.gov, Federal Register, HHS)

Landscape has changed materially since the current app was built. Plan statuses to encode:

| Plan | Status | Notes |
|---|---|---|
| Standard 10-Year | Current | All loan types |
| Graduated | Current | 10y (10–30y Consolidation) |
| Extended (Fixed / Graduated) | Current | Requires >$30k Direct/FFEL, 25y |
| Tiered Standard Plan | Current (effective 2026-07-01) | Mandatory default for loans first disbursed ≥ 2026-07-01; tiered term by balance; not PSLF-eligible |
| RAP (Repayment Assistance Plan) | Current (effective 2026-07-01) | Mandatory sole IDR for post-7/1/2026 loans; tiered % of AGI (0%→10%), −$50/dependent, floor $10; 30y/360-pmt forgiveness; Parent PLUS ineligible |
| IBR (new borrower ≥ 2014-07-01, 10%) | Legacy | 150% poverty, capped at Std-10; 20y forgiveness |
| IBR (older borrower, 15%) | Legacy | 150% poverty, capped at Std-10; 25y forgiveness |
| PAYE | Legacy | 10% of discretionary (150% poverty), Std-10 cap, 20y; new-loan-after-7/1/2026 cutoff |
| ICR | Legacy (bridge) | Lesser of 20% discretionary (100% poverty) OR 12y income-adjusted; only path for Parent-PLUS consolidators to reach IBR; slated for elimination |
| SAVE | Closed/Terminated | 8th Cir. ruled unlawful; ED March 27 2026 termination; not selectable — "Estimate unavailable" |
| REPAYE | Historical | Superseded by SAVE in 2023; not selectable |

Open items flagged in registry as `verification: "pending"`: Hawaii 2026 poverty figures, exact ICR poverty multiplier vs May-1-2026 final rule, PAYE closure-vs-legacy reconciliation, ICR/parent-PLUS bridge deadline.

## Files to create

**Rules registry (`src/lib/studentLoan/rules/`)**
- `types.ts` — `PlanStatus`, `PlanRule`, `SpouseIncomeRule`, `DiscretionaryIncomeRule`, `EligibilityRule`, `PovertyRegion`, `RulesVersion`.
- `povertyGuidelines.ts` — versioned table keyed by `year` × `region` (`contiguous_48_dc` | `alaska` | `hawaii`), with `perAdditionalPerson`, source URL, `publishedAt`. Seed 2024, 2025, 2026 (48/DC + AK; HI marked `pending` with fallback).
- `plans/standard.ts`, `graduated.ts`, `extended.ts`, `tieredStandard.ts`, `rap.ts`, `ibrNew.ts`, `ibrOld.ts`, `paye.ts`, `icr.ts`, `save.ts` (Closed), `repaye.ts` (Historical). Each exports a fully-populated `PlanRule` with all 24 fields you listed (id, displayName, status, effectiveStart/End, loanTypes, borrowerEligibility, discretionary rule, spouse rules for MFJ/MFS, cap rule, minPayment, term, UG/GR handling, subsidy, ParentPLUS, rounding, source URL, sourceUpdatedAt, rulesVersion).
- `index.ts` — `getPlan(id)`, `listPlans({status, asOf})`, `REGISTRY_VERSION` constant, `assertPlanSelectable(plan, borrower)` returning `{ok, reason}`.

**Calculation engine (`src/lib/studentLoan/`)**
- Replace generic `calculator.ts` with per-plan pure functions:
  - `calc/standard.ts`, `graduated.ts`, `extended.ts`, `tieredStandard.ts`
  - `calc/rap.ts` — AGI-bracket tiered %, dependent deduction, floor
  - `calc/ibr.ts` — parameterized by 10% vs 15% + forgiveness term
  - `calc/paye.ts` — 10% discretionary, Std-10 cap
  - `calc/icr.ts` — `min(20% × discretionary_100pov, twelveYearIncomeAdjusted(balance, AGI))`
  - `calc/save.ts`, `repaye.ts` — throw `PlanUnavailableError`
- `discretionaryIncome.ts` — `computeDiscretionary({agi, familySize, region, povertyYear, multiplier})` returns full breakdown fields (guideline, multiplier, protected, discretionary).
- `computePlanPayment.ts` — dispatcher taking `(planId, borrower, registryDate)`; returns `PlanPaymentResult { monthly, annual, breakdown: CalculationBreakdown, assumptions[], rulesVersion, sourceUpdatedAt, eligibility: 'confirmed'|'assumed'|'ineligible' }`.
- `mfsComparison.ts` — updated to consult each plan's `spouseIncomeRule` (do NOT assume MFS always excludes spouse income); adds spouse-loan household-payment allocation for RAP/IBR where applicable.

**Data / borrower inputs**
- Migration `add_borrower_eligibility_fields` on `student_loans`: `loan_type` (enum), `first_disbursement_date`, `had_outstanding_balance_2014_07_01` (bool), `undergrad_balance`, `grad_balance`, `parent_plus_balance`, `parent_plus_consolidated` (bool), `family_size`, `poverty_region`, `spouse_agi`, `spouse_federal_loan_balance`, `current_plan_id`, `current_monthly_payment`. All nullable; existing rows unaffected.
- GRANTs preserved; no RLS change (existing policies cover new cols).
- Regenerate types.

**UI (`src/pages/StudentLoans.tsx` + new components)**
- `components/studentLoan/PlanPicker.tsx` — filters by `assertPlanSelectable`; disabled plans show status badge + tooltip with source; Closed/Historical never in picker.
- `components/studentLoan/BorrowerEligibilityForm.tsx` — collects new fields; missing-info banner "Eligibility not confirmed" per your spec; explicit "Proceed with assumptions" toggle that lists assumptions used.
- `components/studentLoan/CalculationBreakdown.tsx` — expandable "How this was calculated" showing every field you listed (AGI, spouse in/out, family size, poverty year/amount/multiplier, protected income, discretionary, %, annual, monthly, cap applied?, final, rounding, assumptions, rulesVersion, sourceUpdatedAt).
- `components/studentLoan/MfsComparisonCard.tsx` — updated to surface per-plan spouse-rule assumptions and spouse-loan allocation.
- Safety: uncertain/legacy-bridge/closed → render "Estimate unavailable pending current rule verification"; never silent fallback.

**Admin diagnostics (`src/pages/admin/StudentLoanValidation.tsx`, route `/admin/student-loan-validation`)**
- Dev-only guard (matches existing `/admin/tax-validation` pattern).
- Shows: registry version, all plans + status + effective dates + source URL + `sourceUpdatedAt`, poverty-guideline year in use, plans missing source verification, plans with `verification: 'pending'`, expired rules, passing/failing test count from a `runRegistrySelfCheck()`.

**Tests (`src/test/`)**
- `studentLoan/registry.test.ts` — every plan has required fields, source URL, effective dates.
- `studentLoan/povertyGuidelines.test.ts` — AK ≠ 48-state, HI marked pending, 2026 values match FR notice.
- `studentLoan/plans/*.test.ts` — one file per plan covering: zero discretionary → minimum payment; positive discretionary → correct %; caps (PAYE, IBR); ICR two-part min; new-vs-old IBR %; RAP AGI brackets + dependent deduction + $10 floor; Tiered Standard term tiers; Parent PLUS rejection for RAP/PAYE/IBR-direct; Closed plans reject `assertPlanSelectable`.
- `studentLoan/mfs.test.ts` — spouse-income inclusion per plan (RAP MFJ combined vs MFS filer-only; IBR/PAYE MFS excludes; ICR MFS excludes; community-property AGI split).
- `studentLoan/golden.test.ts` — 8–12 fixed scenarios with expected `{discretionary, annual, monthly, cap, eligibility}`, matched to reproducible FSA Loan Simulator inputs where possible; tolerance $1/month; each documents any delta reason.
- Non-regression: existing `studentLoanCalculator.test.ts` scenarios migrated to per-plan files; the old file is removed.

## Technical details

- `RulesVersion = "2026.07.06"` (studentaid.gov big-updates last-updated date); registry constant + emitted with every result so QA can trace.
- Rounding: all IDR plans round monthly payment to nearest cent, then to nearest dollar for display; `rounding: 'nearest_dollar'` recorded on each plan.
- Poverty year selection: uses prior-calendar-year guideline per FSA convention; overrideable in registry per plan (some 2026 rules require current-year — flagged in `povertyYearRule`).
- `PlanUnavailableError` carries `{planId, reason, sourceUrl}` and is caught in the UI to render the "Estimate unavailable" card; never falls back to another plan's formula.
- No changes to tax engine, Income Planner writes, or any file outside `src/lib/studentLoan/`, `src/pages/StudentLoans.tsx`, `src/components/studentLoan/`, `src/pages/admin/`, `src/hooks/useStudentLoans.ts`, migration, and tests.

## Out of scope (explicit)

- Not migrating existing user rows to new plans; existing `current_plan` values that are now Legacy/Closed will surface a one-time banner suggesting review, no auto-change.
- Not verifying Hawaii poverty numbers or ICR final-rule multiplier in this batch — both ship as `verification: 'pending'` and are excluded from golden tests until verified.
- Not implementing PSLF qualifying-payment tracking.
- Not implementing interest capitalization/amortization schedule changes beyond what current calculator does.

## Acceptance check I'll run before reporting done

Typecheck clean, `vitest run src/test/studentLoan` green, `/admin/student-loan-validation` renders with 0 failing plans and lists pending-verification items, `/student-loans` picker hides Closed/Historical, RAP+Tiered Standard selectable and produce breakdowns, SAVE/REPAYE unreachable, golden scenarios within $1 tolerance.
