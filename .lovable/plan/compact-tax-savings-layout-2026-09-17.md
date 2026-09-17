# Compact Tax Savings layout

## Goal
Make the Tax Savings page faster to scan on mobile without changing any deduction, savings, eligibility, or contribution calculations.

## Changes
- Tighten the top summary into one compact card that keeps annual estimated tax savings, total deductions, active-strategy count, and the existing positive context when applicable.
- Split strategy data into three presentation groups:
  - **Business Tax Savings:** configured business strategies only.
  - **Personal Tax Savings:** configured personal strategies only.
  - **More Tax Savings:** every not configured, incomplete, unavailable, or coming-soon strategy, with an opportunity count.
- Render configured strategies as compact bordered list rows with icon, strategy name, right-aligned amount, and chevron.
- Keep expand/collapse only for configured strategies. Move descriptions, supporting details, educational content, and action buttons into the lighter expanded area.
- Remove the Configured badge from collapsed and expanded list presentation.
- Render More Tax Savings as compact non-expanding rows with icon, strategy name, concise status, and chevron/action affordance when setup is available; coming-soon rows remain unavailable.
- Remove the separate large “Recommended Next Step” card from this page because the opportunities now live together in More Tax Savings.
- Preserve existing deep links, forms, buttons, section totals, category visibility, and all tax logic.

## Technical details
- Update the Tax Savings page presentation in `src/pages/Mileage.tsx`.
- Add focused reusable compact-row presentation in `src/components/tax-savings/OpportunityCard.tsx` if needed, without changing category metadata or calculations.
- Keep existing accordion state for active rows and route setup actions through the existing content/actions.
- Verify with the existing focused Tax Savings tests, a TypeScript check, and mobile/desktop screenshots only; no broad QA.
