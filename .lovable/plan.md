# Plan: Test/seed harness for Codex E2E

Add a token-gated, production-safe way for Codex to (1) create predictable test
users with realistic May 2026 onboarding data and (2) read back the key
calculated values from the tax engine — without depending on direct Supabase
Auth signup or browser automation.

## What gets built

### 1. Secret + token gate

- New project secret: `TEST_SEED_ADMIN_TOKEN`.
- Both edge functions reject requests unless the `Authorization: Bearer …`
  header matches that env var. No public exposure.

### 2. Edge function: `test-seed-users` (POST)

- Uses the service role key to upsert three deterministic test users via
  `auth.admin.createUser` (auto-confirmed):
  - `test-w2@paycheckmd.test`
  - `test-w2-1099@paycheckmd.test`
  - `test-1099@paycheckmd.test`
  - Password: `TestSeed!2026` (returned in response).
- For each user, the existing `handle_new_user` trigger creates the
  organization/profile/tax_settings rows. The function then:
  - Updates `tax_settings`: filing status, household income flags,
    `subscription_tier = 'premium'`, `onboarding_complete = true`,
    `income_profile_type` matching the persona.
  - Inserts seeded companies (W-2 employer and/or 1099 entity).
  - Inserts seeded `income_entries` for May 2026 YTD (W-2 paychecks and/or
    business income) plus `projected_income_streams` for future periods.
  - Inserts seeded `investment_income_entries`: short-term gain, long-term
    gain, qualified dividend, plus a small short-term loss.
- Idempotent: re-running wipes prior seed rows for those users (matched by a
  `notes` tag like `"[test-seed]"`) and reseeds. Real users are never
  touched (the function only operates on the three known test emails).
- Returns `{ users: [{ email, user_id, organization_id, password }], summary }`.

### 3. Edge function: `test-verify-user` (POST)

- Token-gated. Body: `{ email }`.
- Reads the seeded user's data with the service role and returns:
  - `premium`, `filing_status`, `income_profile_type`, `onboarding_complete`
  - Ledger counts: income entries, business transactions, investment entries,
    projected streams, mileage rows
  - Sums: `total_personal_w2_gross`, `total_business_gross`,
    `total_investment_taxable`, short-term/long-term/dividend buckets
  - `recommended_tax_set_aside` and `tax_recommendation` totals stored on
    each entry by the in-app engine (these are the same numbers shown in the
    UI, which is the closest server-side proxy to the engine output).
- Codex compares expected vs actual on the JSON, no browser needed.

### 4. Stable test selectors (`data-testid`)

Add stable attributes — UI is unchanged visually:

- `signup-email`, `signup-password`, `signup-submit` (Signup page)
- `onboarding-income-type-w2`, `onboarding-income-type-w2-1099`,
  `onboarding-income-type-1099` (income setup choice)
- `onboarding-ytd-income` (YTD catch-up amount field)
- `investment-add-entry`, `investment-entry-type`, `investment-taxable-amount`
- `tax-overview-effective-rate`, `tax-overview-total-gross-income`,
  `tax-overview-federal-tax`, `tax-overview-recommended-set-aside`
  (Tax Overview / Estimate page)

### 5. Docs

- Append a "Test seed harness" section to `e2e/README.md` covering:
  - How to set `TEST_SEED_ADMIN_TOKEN`
  - `curl` examples for both endpoints
  - The three personas and their seeded shape
  - Note that the harness is disabled when the token env var is unset

## Production safety

- Both functions return 401 unless `TEST_SEED_ADMIN_TOKEN` is set AND the
  caller's Bearer token matches.
- Seed only operates on the three reserved `*.test` emails — cannot mutate
  real accounts.
- All seeded rows carry a `[test-seed]` marker in `notes` for easy cleanup.
- Endpoints are not referenced by client code, so they don't ship in the app
  bundle.

## Files touched

- New: `supabase/functions/test-seed-users/index.ts`
- New: `supabase/functions/test-verify-user/index.ts`
- Edited: `src/pages/Signup.tsx`, `src/pages/Onboarding.tsx`,
  `src/pages/InvestmentIncome.tsx`, `src/components/tax-breakdown/SummaryCards.tsx`
  (or the equivalent Tax Overview headline component) — `data-testid` only
- Edited: `e2e/README.md`
