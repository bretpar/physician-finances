# AGENTS.md

## Testing / Playwright visibility rules

When running Playwright E2E tests for user flows, prefer a visual/debuggable test-patient workflow.

Default behavior:
- Use Playwright UI mode when available:
  `npx playwright test --ui`
- If UI mode is unavailable, use headed mode:
  `npx playwright test --headed`
- If the Codex environment cannot display a live browser window, do not block the task.
  Instead, save visual artifacts:
  - Playwright trace
  - Screenshots at each major step
  - Video when available
  - Diagnostic markdown report

Required artifacts for patient-flow tests:
- Login or signup
- Onboarding step 1
- Company/employer setup
- Income/paycheck entry
- Personal Income ledger
- Tax Overview
- Settings if reset/delete is involved

Do not change app code just to make the browser visible.
Only change app code if the test reveals a real app bug.
- Planner → Business Activity conversion (manual, in-app auto, and daily job) must write the single linked income_entries mirror via `upsertBusinessIncomeMirror` (or its edge-function equivalent) — owner deductions like employee/employer retirement live there, and reusing by linked_transaction_id keeps retries duplicate-free.
- Link Review (/link-review) builds its list in the pure `src/lib/linkReview.ts` from the canonical record-selection bridge and resolves only via the existing linking hooks; "reviewed" state lives in `link_review_dismissals`, so dismissing never edits tax records.
- Business income gross vs net-deposit selection for merge groups goes only through `applyMergeLineageGross` (src/lib/taxRecordSelection.ts), applied once in useTaxEstimate before scoping — in-memory only; exact proof applies automatically, near-proof shapes (deposit-mirror entry, cents-truncated Net Received) apply only after a `lineage-confirm:<groupId>` key exists in `link_review_dismissals`; ambiguous groups are flagged, never repaired. Why: user must confirm any correction not provable from records.
- Onboarding annual-income plans go through `buildOnboardingIncomePlan` (src/lib/onboardingIncomePlan.ts): one Planner stream per company starting today, metadata in `advanced_field_visibility.onboarding_income_plan`; never ledger rows or withholding. Why: earlier-in-year income stays an estimate and cannot be double-counted or auto-converted.
- Onboarding historical W-2 estimates enter only forecast assembly through `buildOnboardingForecast`, using canonical counted records, overlap-adjusted catch-ups, active occurrences, and a fixed original historical ceiling in company metadata; Planner displays that shared breakdown. Why: actuals replace estimates while edits/deletions cannot refill future income; business history is deferred without historical expense provenance.
- Company closure lives only in `company_closure_periods` (close/reopen via `close_company`/`reopen_company` RPCs; `closed_on` = first inactive day, `reopened_on` = first active day). Closed companies stay in `companies`, history, summaries and tax calculations; forward-looking inputs check the occurrence's own date via `src/lib/companyClosure.ts` (`generateProjectedPaychecks` closure arg, `closureWindowForYear` for saved annual targets, `openSegments` for recurring contributions), and the daily job duplicates that rule. Why: closure must be reversible, never touch saved records, and never backfill closed-period income.
