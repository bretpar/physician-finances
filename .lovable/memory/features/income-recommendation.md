---
name: Two-Step Income Recommendation Flow
description: Two-modal income entry flow with base estimate (Modal 1) and smart dynamic recommendation (Modal 2) with additional tax reserve
type: feature
---

## Architecture
- Modal 1: Income entry form with base estimated tax reserve at bottom
- Modal 2: Post-save smart recommendation with quarterly status, shown via RecommendationModal component
- All premium features gated behind feature flags (all enabled for testing)

## New DB Fields on income_entries
- base_tax_estimate — system-calculated tax for this paycheck
- dynamic_tax_recommendation — full-year-aware recommendation
- quarterly_adjustment_amount — catch-up/reduction for quarterly payments
- additional_tax_reserve — user-chosen extra reserve amount
- recommendation_status — ahead / on_track / behind

## Shortfall Spread Logic (useIncomeRecommendation.ts)
Three tiers of confidence:
1. **High** — projected income streams exist in Income Planner. Count exact events before next deadline, spread shortfall evenly.
2. **Estimated** — no projections but ≥2 recent income entries in last 6 months. Use average cadence to estimate events. Show disclaimer.
3. **Low** — no projections, no reliable history. Show total shortfall as-is. Recommend adding Income Planner entries.

Always shows: total shortfall by deadline (exact) AND per-event adjustment (spread).

## Key Files
- src/hooks/useIncomeRecommendation.ts — smart recommendation engine with projected income integration
- src/components/RecommendationModal.tsx — Modal 2 UI with confidence messaging
- src/lib/featureFlags.ts — premium feature flags (all unlocked)

## Feature Flags Added
- static_tax_estimate (core)
- dynamic_paycheck_recommendation (advanced)
- quarterly_payment_tracking (advanced)
- recommendation_modal (advanced)
- premium_visibility (advanced)

## Labels
Use "Additional tax reserve" NOT "extra withholding"
