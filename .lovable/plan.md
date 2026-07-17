
## Goal

Introduce a third canonical HSA contribution type — **employer** — alongside existing **employee payroll** and **individual**. Employer HSA must count toward the annual limit but must not reduce take-home pay and must not create a second above-the-line deduction.

## 1. Database (migration)

`public.hsa_contributions`:
- Add `contribution_type TEXT` with CHECK `IN ('employee_payroll','employer','individual')`.
- Backfill from existing `source_type`:
  - `payroll` → `employee_payroll`
  - `individual` → `individual`
- Keep `source_type` column for backward compatibility (writes mirror both during transition; reads prefer `contribution_type`).
- Add nullable `linked_income_entry_role TEXT CHECK IN ('employee','employer')` so paycheck-synced employer and employee rows have distinct stable identities (unique partial index on `(income_entry_id, linked_income_entry_role) WHERE income_entry_id IS NOT NULL`).

`public.income_entries`:
- Add `employer_hsa_contribution NUMERIC NOT NULL DEFAULT 0`.
- Add `linked_employer_hsa_contribution_id UUID` (separate from existing `linked_hsa_contribution_id`, which stays as the employee-payroll link).

RLS/GRANTs unchanged (columns added to existing tables).

## 2. Sync (`src/lib/incomeEntryHsaSync.ts`)

Extend the existing single-code-path helper to synchronize **two** rows per paycheck:
- Employee row (`contribution_type='employee_payroll'`, `linked_income_entry_role='employee'`) tracked via `linked_hsa_contribution_id`.
- Employer row (`contribution_type='employer'`, `linked_income_entry_role='employer'`) tracked via `linked_employer_hsa_contribution_id`.

Rules for each row independently:
- Upsert on non-zero amount; update in place on edit.
- Delete row (and null the link) when amount → 0.
- Delete both when paycheck is deleted.
- Repair routine extended to cover employer rows too, keyed by `(income_entry_id, linked_income_entry_role)` to prevent duplicates.

## 3. Hooks / types

- `useHsaContributions.ts`: add `contribution_type` to the row type; treat `source_type` as legacy shim. Default `addContribution` = `individual`. Sum uses `contribution_type`.
- `useIncome.ts` / paycheck save path: pass through `employer_hsa_contribution` and invoke the extended sync helper.
- `hsaComputation.ts`: accept the three types; `totalContributions = employeePayroll + employer + individual`. **Deductible-cap allocation**: employer + employee_payroll consume limit room first (already excluded from wages / not deductible again); remaining room caps the individual above-the-line deduction. Employer amount is reported as "counted toward limit, non-deductible".

## 4. Tax engine (`taxEngine.ts` / `useTaxEstimate.ts`)

- W-2 wage reduction path stays: employee payroll HSA (Section 125) still reduces federal wages and FICA wages exactly as today. **No change** to `calcW2PayrollTax` inputs.
- Employer HSA: **not** added to gross wages, **not** added to `hsaAboveTheLine`, but included in `totalHsaContributions` for the annual-limit summary.
- Above-the-line HSA deduction = min(individual, remainingRoomAfterPayrollAndEmployer).

## 5. UI

`W-2 income entry Advanced` (existing paycheck form):
- Split the current HSA input into two labelled fields with tooltips:
  - **Employee HSA contribution** — "Taken from your paycheck and counted toward your annual HSA limit."
  - **Employer HSA contribution** — "Contributed by your employer. It counts toward your annual HSA limit but does not reduce your paycheck."

HSA ledger (Settings › HSA and the ledger table):
- Column/badge for contribution type: `Employee payroll` / `Employer` / `Individual`.
- For linked rows, show employer/company name + paycheck date (already available via `income_entry_id` join).

## 6. Reports & Tax Prep PDF

`Reports.tsx` and `taxPrepPdf.ts` HSA section — replace the single line with:
- Employee payroll HSA
- Employer HSA
- Individual HSA
- **Total contributions**
- Deductible amount applied
- Excess contribution (if any)

## 7. Tests

New (`src/test/hsaEmployer.test.ts` plus additions to existing files):
1. Employer-only contribution → counted toward limit, zero deduction.
2. Employee + employer on one paycheck → two distinct ledger rows, correct totals.
3. Employee + employer + individual → total sums; individual deduction capped by remaining room.
4. Employer counts toward annual limit (limit summary).
5. Employer does not change take-home (paycheck net unchanged vs. employer=0).
6. Employer does not appear in above-the-line deductions in tax engine output.
7. Edit employer amount → in-place update, no duplicate.
8. Employer amount → 0 removes the ledger row.
9. Delete paycheck removes both employee and employer rows.
10. Multi-employer paychecks: each pair uses its own linked ids.
11. Re-running sync twice produces no duplicates (idempotency).
12. Reports and PDF render all four lines with correct values.

Preserve every existing HSA / W-2 payroll / FICA / tax-engine / sync test.

## 8. Verification

- `tsgo` typecheck.
- Vitest: `hsaLimits`, `hsaClassification`, `w2PayrollTax`, `taxEngine`, `taxPipeline`, `hsaEmployer` (new), `taxPrepPdfSummary`.
- Regenerate tax-validation baseline only if scenario values actually change (they should not — no employer HSA in existing scenarios).

## Technical notes

- Legacy rows are migrated deterministically in SQL; nothing is silently reclassified at read time.
- `linked_income_entry_role` gives employee and employer rows distinct stable identities so the sync helper can never overwrite one with the other.
- Employer HSA never enters `TaxDebugBreakdown.hsaAboveTheLine`; it is surfaced only in the HSA limit summary (`hsaTotalContributions`, `hsaEmployerContributions`).
