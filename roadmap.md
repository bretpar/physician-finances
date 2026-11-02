# Focused monitoring fixes
- [ ] Reject closed-period manual Planner conversions before writes; verify focused regressions.
- [ ] Preserve original retirement recurrence anchors across closures; verify $800 × 10 = $8,000 without record changes.
- [x] Preserve historical HSA limits for years before recorded coverage periods; verify regression.
- [x] Exclude unavailable taxpayer workplace-plan room in spouse-only households; verify regression.
- [x] Resolve both monitoring findings after verification.

# Simplified onboarding forecast
- [x] Integrate W-2 historical estimates into shared forecast with edit-safe provenance; business history deliberately deferred without expense provenance.
- [x] Recognize detailed YTD before creating plans and reuse shared Planner breakdown.
- [x] Run focused onboarding forecast tests (18 passed); automatic preview checks passed; no browser QA or publishing.