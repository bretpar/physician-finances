# Fix W-2 per-paycheck summary display

## Implementation
- Add one small pure presentation selector that consumes `useW4Calculation().employerW4Recommendations` without recalculating W-4 amounts.
- For exactly one active employer with a usable allocation, return that employer’s canonical `change.recommendedExtraPerPaycheck` and employer name.
- For multiple active employers, return a “Review W-4 recommendations” state linking to the existing W-4 Calculator instead of summing employer amounts.
- When no usable allocation exists, return an annual fallback state using the existing remaining estimated annual tax.
- Update the W-2 planned summaries on Dashboard and Tax Overview to render the shared selector result. Keep annual tax due and withholding displayed separately.

## Focused verification
- Add one regression test covering the production values: `$12,668.48` annual shortfall and `$1,920` canonical employer allocation.
- Verify both screen presentations select `$1,920`, never label `$12,668.48` per paycheck, use annual wording without an allocation, and do not sum multiple employers.
- Run only the focused regression test and a TypeScript check.

## Scope
- No changes to the tax engine, W-4 allocation math, `remainingPayPeriods`, paycheck modal, stored data, quarterly calculations, or non-W-2 recommendations.
- No card redesign.
