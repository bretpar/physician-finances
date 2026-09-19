# Retirement Tax Savings presentation redesign

## Goal
Replace the current retirement summary and duplicate number grids with one mobile-first view that answers: how much has been contributed, where it went, and where additional valid room remains. All displayed amounts and unknown states will come from the existing canonical retirement engine; no retirement or tax formulas will change.

## What will change

### 1. Canonical presentation model
- Extend the existing retirement room view adapter to expose the engine’s canonical bucket and plan details directly to the UI: shared employee bucket, governmental 457(b), SIMPLE, IRA contribution/deductibility/eligibility, actual and projected employer capacity, plan reasons, compensation/profit basis, and unknown states.
- Add one centralized mapping from retirement reason codes to short, plain-language messages. Raw reason-code strings will never appear on screen.
- Compute only presentation totals in this adapter: total contributed and the sum of known remaining opportunities. Unknown employer capacity will be excluded from that sum and reported separately by plan count.

### 2. New retirement overview
- Replace `RetirementRoomSummary` with a focused `2026 Retirement` overview showing:
  - Total contributed
  - Additional contribution opportunity
  - A secondary notice when one or more employer opportunities are unknown
- Add compact expandable bucket cards for:
  - **Employee retirement:** shared 401(k)/403(b)/Solo 401(k) employee bucket, progress, remaining room, applicable catch-up, and company/plan contribution breakdown
  - **Governmental 457(b):** separate limit and room, shown only when applicable
  - **SIMPLE:** its own canonical limit and room, shown only when applicable
  - **IRA:** one shared Traditional + Roth limit, remaining room, Traditional deductible amount or an explicit unknown-income message, and Roth direct-contribution eligibility
- Keep tax-law detail inside expansions and info tooltips rather than in the default view.

### 3. Employer retirement section
- Show one compact company/plan row using projected year-end opportunity when Planner data is available, otherwise current opportunity.
- Expanded details will show YTD contribution, current and projected allowable employer amounts, current/projected business profit or eligible compensation, total plan additions, and the canonical plan ceiling when known.
- For `unknown_plan_data`, show the recorded employer contribution and explain that additional capacity depends on the employer’s plan; never substitute unused statutory ceiling as opportunity.

### 4. Contribution details and existing actions
- Replace the current standalone summary grid, recent-activity card, standalone table, and separate paycheck-linked table with one collapsed **Contribution details** section.
- Group rows by company/plan and funding source, with dedicated Traditional IRA and Roth IRA groups.
- Show account/plan, company when applicable, employee/employer/personal label, amount, and useful date/frequency context.
- Preserve existing standalone contribution edit/delete actions and keep paycheck-linked entries read-only.
- Preserve the existing add, save, cancel, and delete-confirmation behavior.

### 5. Contribution form hierarchy
- Reorder the existing form to choose account first, then show who made the contribution only when relevant, then company when required.
- Use the requested account labels, including “governmental 457(b).”
- Force Traditional/Roth IRA to personal, prevent employee SEP selections unless explicit SARSEP metadata exists, and require a company for employer-sponsored plans. Stored values remain unchanged; no migration is needed.

### 6. Mobile behavior
- Use a single-column hierarchy, large primary amounts, compact rows, stable progress bars, and touch-sized expand/edit/delete controls.
- Avoid dense tables and keep secondary calculations collapsed on phones and desktop.
- Verify the Tax Savings Retirement section at the current phone viewport and a desktop viewport, including empty, known-capacity, unknown-capacity, and expanded-detail states.

## Old retirement UI removed
- Duplicate Total Contributions, Employee, Employer, Estimated Personal Deduction, Standalone Annual, withholding, and per-paycheck summary cards
- Separate Recent activity card
- Generic per-plan capacity presentation and global Actual/Projected toggle
- Separate standalone and paycheck-linked contribution tables

## Focused validation
- Update retirement UI tests to use canonical engine/view fixtures rather than legacy retirement-room helpers.
- Cover shared employee, separate 457(b), separate SIMPLE, catch-up text, combined IRA limit, Traditional deductible versus unknown deductibility, Roth eligibility states, projected employer opportunity, `unknown_plan_data`, zero-contribution plans, reason-code copy, and exclusion of unknown capacity from the overview total.
- Cover form account/type constraints and preservation of Add/Edit/Delete actions.
- Run only the focused retirement tests and the TypeScript check, then perform phone and desktop browser verification with screenshots.

## Scope safeguards
- No changes to `computeRetirementOpportunity()`, tax-engine formulas, IRS rules, database schema, unrelated Tax Savings categories, or investment recommendations.
- No backdoor Roth guidance and no broad page refactor.
