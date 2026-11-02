# Focused monitoring fixes
- [x] Reject closed-period manual Planner conversions before writes; fresh lookup failures block writes, existing conversions remain no-ops.
- [x] Preserve original retirement recurrence anchors across closures; $800 × 10 = $8,000 verified; 61 focused tests passed, preview build OK; no real-record writes or publishing.
- [x] Preserve historical HSA limits for years before recorded coverage periods; verify regression.
- [x] Exclude unavailable taxpayer workplace-plan room in spouse-only households; verify regression.
- [x] Resolve both monitoring findings after verification.

# Simplified onboarding forecast
- [x] Integrate W-2 historical estimates into shared forecast with edit-safe provenance; business history deliberately deferred without expense provenance.
- [x] Recognize detailed YTD before creating plans and reuse shared Planner breakdown.
- [x] Run focused onboarding forecast tests (18 passed); automatic preview checks passed; no browser QA or publishing.