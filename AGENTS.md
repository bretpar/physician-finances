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
- Company closure lives only in `company_closure_periods` (close/reopen via `close_company`/`reopen_company` RPCs; `closed_on` = first inactive day, `reopened_on` = first active day). Closed companies stay in `companies`, history, summaries and tax calculations; forward-looking inputs check the occurrence's own date via `src/lib/companyClosure.ts` (`generateProjectedPaychecks` closure arg, `closureWindowForYear` for saved annual targets, original anchored retirement dates filtered with `isClosedOn`), and the daily job duplicates that rule. Manual conversion reads fresh closure history and fails closed before writes. Why: closure must be reversible, never touch saved records, and never backfill or reanchor closed-period income.
- Settings deep links (`/settings?company=<id>[&open=withholding]`, `/settings?section=companies`) resolve in the pure `src/lib/settingsDeepLink.ts`, and the Companies `SectionCard` is controlled (`open`/`onOpenChange`) so the link itself reveals the section; a later manual header click wins over the URL. Why: a collapsed section would hide the employer and withholding fields the warning told the user to open.
- Retirement capacity: plans are attributed per company + plan kind (payroll money resolves before aggregation: no explicit plan → default kind, one → that kind, several → its own flagged `payroll_unresolved` plan; plan ids are aggregation keys, sorted) and same-employer plans share one §415(c)/formula capacity in `applySharedEmployerLimits`; all business plans of one earner (any capacity) across multiple businesses are flagged `capacityUnverified` and excluded from the headline (`computeRetirementHeadline`). Actual = through today; future recurring rows and active Planner occurrences enter only the projected run as scheduled. Why: the same eligible earnings must never fund two independent capacities, and related-employer status isn't recorded.
- Related-business retirement settings live in `companies.advanced_field_visibility.retirement_relationship` (src/lib/businessRelationships.ts): named groups share one combined annual-additions limit (optional recorded cap), "unrelated" keeps separate room, absent = unverified. Why: metadata only; never edits income or tax records.
- W-2 employer match/profit-sharing formulas live in `companies.advanced_field_visibility.employer_contribution_formula` (src/lib/employerContributionFormula.ts): match/tiered/flat kinds produce an estimated employer contribution that the engine counts toward used room (capacity, headroom, shared-employer groups) but never toward recorded totals. Why: metadata only; estimates must reduce room without fabricating actual contributions.
- Retirement visual business opportunities select canonical `computeRetirementHeadline` room with shared employee capacity reserved first; do not assert account-specific employee allocations or personal partnership Solo ownership without verified inputs. Why: independent maxima can overlap and company type alone does not establish a personal plan.
