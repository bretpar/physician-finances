---
name: Retirement Opportunity Engine
description: Canonical pure engine owning retirement limits, IRA deductibility, employer capacity, and annualization
type: feature
---

`src/lib/retirementOpportunityEngine.ts` is the single source of truth for retirement limits and capacity. Pure: no Supabase, no React, no clock reads.

## Rules (2026)
- §402(g) employee deferral 24,500; catch-up 8,000 (50+), 11,250 (60–63); §415(c) 72,000; comp cap 360,000.
- Catch-up dollars sit OUTSIDE the §415(c) annual-additions limit.
- Governmental 457(b): own 24,500 bucket, never pooled with §402(g). No final-3-years catch-up — return a reason instead.
- SIMPLE: 17,000 / +4,000 / +5,250; own bucket, but still consumes the cross-plan employee deferral limit.
- IRA: 7,500 + 1,100 (50+), Traditional + Roth share one limit, capped by eligible taxable compensation.

## Invariants
- Contribution room ≠ deductibility. Traditional IRA returns contributed / deductible / nondeductible separately; only the deductible part enters AGI. Roth deduction is always 0.
- Employer capacity is entity-aware: schedule_c/sep uses self-employed earned income with the reduced rate (25% → 20%); s_corp uses W-2 wages, never distributions; partnership K-1 needs service earned income; unknown W-2 formulas return `unknown_plan_data` rather than filling §415(c) room.
- Employer retirement never reduces the SE-tax base.
- W-2 employer contributions must never enter `businessRetirement` — `useRetirementContributions` exposes `employerBusinessTotal` (solo_401k / sep_ira only) for that routing.
- Per-paycheck annualization uses real company `pay_frequency` and tax-year occurrences; documented fallback is biweekly. One-time rows stay exact and belong to their contribution year only.
- Projected self-employed room = actual YTD net profit + remaining planned gross − remaining planned expenses (never gross-only).

## Delegating callers
`retirementContributionRoom.ts` (limits tables), `useRetirementContributions.ts` (annualization), `useTaxEstimate.ts` (businessRetirement routing), `Mileage.tsx` (row annualization).
