# Goal
Make the W-2 reusable Codex scenario pass end-to-end for `brendantparker+codexw2@gmail.com` while preserving existing behavior for everyone else. Four distinct bugs, fixed with the smallest possible surface area.

# Findings from the codebase

1. **Safe erase** (`DangerZoneSection` + `account-cleanup` edge function): the edge function already resets `tax_settings` with `onboarding_complete=false`, and the client hard-navigates to `/onboarding?reset=1` after clearing React Query and `paycheckmd-*` storage. The previous regression test exists at `e2e/safe-erase-onboarding-routing.spec.ts`. If routing still fails for this user, the most likely cause is a stale `taxSettings` read racing the hard nav, or the Onboarding page redirecting on a transient cached value.
2. **Multi-W2 persistence**: `Onboarding.createOnboardingCompanies` reads `supabase.from("companies").select("name, company_type")` without a `user_id` scope. Under org RLS this can return rows from other users in the same org and silently dedupe the new W-2 against another user's company. It also never captures `pay_frequency`, which is why “Not set” appears in Settings.
3. **YTD W-2 → ledger**: `YtdCatchupForm` writes to `ytd_catchup_entries` only. `backfillYtdCatchupCompanies` only mirrors **1099/K-1** entries into `transactions`; W-2 catch-ups are never reflected as `income_entries`, so the Personal Income ledger shows zero.
4. **Tax Overview zeros**: `useDashboardSummary` / Tax Overview read `income_entries` + tax engine; with no W-2 entries created, totals are 0. Fixing #3 fixes #4.

# Changes

## 1. Safe-erase routing hardening
- `src/pages/Onboarding.tsx`: when the URL contains `?reset=1` OR `localStorage["paycheckmd:erase-complete"]` is set, force `taxSettings` to refetch on mount and never short-circuit redirect to `/` even if the in-flight query returns a stale `onboardingComplete=true`. Clear the marker once Onboarding is rendered with fresh `false`.
- Keep `App.tsx` guard unchanged.

## 2. W-2 onboarding company persistence
- `src/lib/onboarding.ts`: extend `OnboardingCompanyDraft` with `payFrequency?: PayFrequency` (biweekly | weekly | semimonthly | monthly | quarterly | annual).
- `src/pages/Onboarding.tsx`:
  - Add a pay-frequency `<Select>` next to each company draft (W-2 rows only; default biweekly).
  - Scope the dedupe query to `user_id`: `.select("name, company_type").eq("user_id", user.id)`.
  - Pass `pay_frequency` into the insert payload.

## 3. YTD W-2 → income_entries mirror
- `src/hooks/useYtdCatchup.ts`:
  - Extend `backfillYtdCatchupCompanies` (or add a sibling `mirrorW2YtdToIncome`) so each W-2 catch-up row is mirrored as a single `income_entries` row with `income_type="w2"`, `entry_kind="ytd_catchup"`, `gross_amount=gross_income`, federal/state/SS/Medicare withholding fields populated, `retirement_401k`, `healthcare_deduction`, `hsa_contribution`, `income_date=period_end`, `linked_ytd_catchup_id=<entry.id>`, `source_bucket="personal"`, `include_in_tax_estimate=true`.
  - Idempotent: skip if an income_entries row already exists with that `linked_ytd_catchup_id`.
  - Call this from `createOnboardingCompanies` (already calls the 1099 backfill).

## 4. Regression tests
- Update `e2e/scenarios/w2-reusable-scenario.spec.ts` to:
  - Set per-company pay frequency from the scenario object.
  - After onboarding, assert each company's `pay_frequency` in Settings is not "Not set".
  - Assert Personal Income ledger shows ≥1 W-2 entry per company with the right gross.
  - Assert Tax Overview shows non-zero W-2 income and federal withholding ≥ scenario totals.

# Non-goals / what I will NOT change
- Tax engine math.
- Anything that hardcodes this specific user.
- The 1099/K-1 mirror path (already works for Business Activity).
- AuthContext or the App route guard logic.

# Risk
- Adding pay-frequency to onboarding changes existing onboarding UI (one extra select per row, defaulting to biweekly — safe).
- YTD W-2 mirror could double-count if a user later imports payroll for the same period; mitigation: `entry_kind="ytd_catchup"` is excluded from projected matching today and the existing dedupe-cleanup card already handles linked YTD entries.

Please confirm and I'll implement in one pass.