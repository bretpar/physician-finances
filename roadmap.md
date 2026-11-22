# Focused monitoring fixes
- [x] Keep unconfirmed employer match estimates out of actual Planner conversions; confirmed/manual contributions transfer once. Signed-in conversion and Personal Income read-back verified; temporary records removed.
- [x] Preserve intentional $0 employer contributions in occurrence, recurring-stream and actual-paycheck overrides; 40 focused tests passed, preview build OK. No database changes or publishing requested/performed by this task.
- [x] Fix FSA recommendations, employer/date defaults, classified FICA wages, shared limits, and save failures.
- [x] Protect Planner pre-tax amounts that already include FSA; carry FSA consistently into forecasts without changing historical actuals.
- [x] Preserve the three FSA breakdowns through idempotent paycheck conversion and Dashboard/Tax Overview projections; browser and release QA deferred to Codex as requested.
- [x] Run focused regression coverage (76 passed); automatic preview type/build checks passed; target database has all three FSA columns. No deployment or publishing.
- [x] Simplify Retirement presentation: one shared employee bar, company-level employer cards and optional explanations; unchanged calculations/history, 23 focused tests passed, signed-in desktop/mobile checked, no publishing.
- [x] Trace automatic retirement inputs: mixed WWEP 401(k)/Solo labels and same-limit unresolved payroll unnecessarily blocked company capacity; Vituity lacks partnership plan terms, not financial data.
- [x] Correct company-level options, precise statuses, partnership estimate and year-scoped planned expenses; 53 focused tests passed and signed-in desktop/mobile calculator verified without record changes or publishing.
- [x] Replace retirement presentation with labeled contribution bars and compact year-end room summary.
- [x] Show company-grouped self-employed opportunities conservatively; preserve history and editing. Account-specific joint employee allocation and hypothetical scenarios deferred because canonical outputs do not establish them.
- [x] Run focused tests (32 passed) and a signed-in desktop/mobile visual check; do not publish.
- [x] Reject closed-period manual Planner conversions before writes; fresh lookup failures block writes, existing conversions remain no-ops.
- [x] Preserve original retirement recurrence anchors across closures; $800 × 10 = $8,000 verified; 61 focused tests passed, preview build OK; no real-record writes or publishing.
- [x] Preserve historical HSA limits for years before recorded coverage periods; verify regression.
- [x] Exclude unavailable taxpayer workplace-plan room in spouse-only households; verify regression.
- [x] Resolve both monitoring findings after verification.

# Simplified onboarding forecast
- [x] Integrate W-2 historical estimates into shared forecast with edit-safe provenance; business history deliberately deferred without expense provenance.
- [x] Recognize detailed YTD before creating plans and reuse shared Planner breakdown.
- [x] Run focused onboarding forecast tests (18 passed); automatic preview checks passed; no browser QA or publishing.