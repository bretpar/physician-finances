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
- Business income gross vs net-deposit selection for merge groups goes only through `applyMergeLineageGross` (src/lib/taxRecordSelection.ts), applied once in useTaxEstimate before scoping — in-memory only, ambiguous groups are flagged, never repaired.
