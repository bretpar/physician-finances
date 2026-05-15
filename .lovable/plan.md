# Planned business expenses for 1099 / SE forecast

**Problem.** "Include planned income" adds projected 1099 / K-1 / Schedule C gross receipts to the forecast, but there is no place to enter expected business expenses against that projected gross. The tax engine therefore models projected business income as 100% net profit, overstating SE tax and federal/state liability for any 1099 physician with real overhead.

**Approach.** Add a per-stream forecast expense field on business-type projected income streams plus a clearly labelled forecast assumption note. The field flows into the unified tax engine so projected SE / business income is reduced by expected expenses before SE tax, QBI, and federal/state calcs run. W-2 streams are unaffected.

## Scope

1. **Schema.** Add two columns to `projected_income_streams`:
   - `forecast_expense_per_period numeric not null default 0` — dollars of expected business expense per pay period (mirrors the per-paycheck shape of every other field on the row).
   - `forecast_expense_notes text not null default ''` — free-text assumption, e.g. "malpractice $X/mo + CME".
   
   No data migration needed (defaults make existing rows behave identically to today).

2. **Hook (`useProjectedIncome.ts`).**
   - Extend `ProjectedIncomeStream` and `ProjectedPaycheck` types with the new fields.
   - Carry `forecast_expense_per_period` from the stream into each generated paycheck (`generateProjectedPaychecks`).
   - Aggregate `forecastBusinessExpenses` in `getProjectedTotals`, summing only paychecks whose stream classifies as `se` (1099 / K-1) and whose `matchStatus === "active"`. W-2 and "other" streams contribute 0.

3. **Tax wiring (`useTaxEstimate.ts`).**
   - Read `projTotals.forecastBusinessExpenses` and add it onto the existing `businessExpenses` total that is passed to the engine. This naturally reduces `seIncome - businessExpenses` net profit, SE tax, and the federal/state taxable base — the same overlap-safe math already used for actual transactions.
   - No change to withholding routing or to actual-only mode (totals only kick in when `incomeScope === "actualPlusPlanned"` because the projected SE income itself only counts then).

4. **UI (`ProjectedIncome.tsx`).**
   - In the create/edit stream form, when the resolved subtype is a business filing (`1099_schedule_c`, `k1_partnership`, `scorp_distribution`), render a "Forecast business expenses (per pay period)" currency input plus a "Assumption notes" textarea. Hide both for W-2.
   - Add a one-line helper under the field: *"Estimated overhead reduces projected business profit before SE tax. Leave 0 to forecast gross receipts only."*
   - Show the per-period expense and an annualized total ("≈ $X / yr") on the stream card so the assumption is visible at a glance.

5. **Tests.**
   - Extend `unifiedTaxEngine.test.ts` with a case: $200k projected SE gross + $5k/period forecast expense over N periods → engine receives `seIncome=200k`, `businessExpenses += N*5000`, net SE profit drops accordingly, SE tax drops.
   - Extend `useProjectedIncome` totals test (or add one) to confirm W-2 streams never contribute forecast expenses.

## Out of scope

- No Plaid / transaction-level "planned expense" rows. The field is a simple per-stream assumption, not a ledger entry.
- No category breakdown. Single dollar amount + notes is enough to remove the gross-only blind spot.
- Past-due or matched paychecks do not contribute forecast expenses (actual transactions cover them).

## Files touched

- New migration: `projected_income_streams` add columns.
- `src/hooks/useProjectedIncome.ts` — types, paycheck generation, totals.
- `src/hooks/useTaxEstimate.ts` — feed forecast expenses into engine input.
- `src/pages/ProjectedIncome.tsx` — form + card display.
- `src/test/unifiedTaxEngine.test.ts` (+ optional projected totals test).
