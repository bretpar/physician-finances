# E2E test harness

## Disposable-user spec (`disposable-user.spec.ts`)

Each test in this spec:

1. Creates a brand-new Supabase user via public auth (`e2e+{label}-{ts}-{rand}@paycheckmd-e2e.test`, password `Test1234!`).
2. Waits for the `handle_new_user` trigger to provision profile + organization + tax_settings.
3. Marks onboarding complete and seeds realistic fixtures **through RLS** as that user:
   - 1 company (1099 Schedule C)
   - 2 income entries totalling $50,000 gross
   - 1 business expense transaction of $8,000
   - 1 projected income stream with `forecast_expense_per_period = $1,500`
   - 1 YTD catch-up entry (W-2 sliver, $5,000)
4. Logs in via the UI and asserts Dashboard, Business Activity, Taxes, and Projected Income pages reflect the seeded data.

## Cleanup

Disposable users are **kept and tagged with a timestamp** (per project preference). They are not auto-deleted. Run `bunx tsx scripts/cleanup-e2e-users.ts` for the listing/purge SQL snippets.

## Requirements

- Email auto-confirm must be enabled on the backend (it is — set during harness install).
- Tests use the public anon key only; no service role required.

## Running

Inside the Lovable agent environment (preview wiring auto-loaded via
`lovable-agent-playwright-config`):

```
bunx playwright test e2e/disposable-user.spec.ts
```

### Running from Codex / standard environments

`playwright.config.ts` falls back to a standard Chromium-only config when the
Lovable agent config package is not installed, so the same specs run anywhere:

```
corepack enable
pnpm install
pnpm exec playwright install --with-deps chromium
pnpm exec playwright test
```

### Playwright dependency expectations

Both packages are declared as devDependencies and must resolve at runtime:

- `@playwright/test` — the test runner / fixture API used by every spec
  (`import { test, expect } from "@playwright/test"`).
- `playwright` — the core browser-automation runtime. The CLI shim
  (`pnpm exec playwright ...`) works without it, but `require('playwright')`
  / scripted Chromium harnesses need the package installed.

Sanity checks after `pnpm install`:

```
pnpm exec playwright --version
pnpm exec node -e "require('playwright'); console.log('playwright runtime ok')"
pnpm exec node -e "require('@playwright/test'); console.log('@playwright/test runtime ok')"
```

Environment variables:

- `PLAYWRIGHT_BASE_URL` or `BASE_URL` — target app URL. Defaults to
  `https://app.paycheckmd.com`.
- `PLAYWRIGHT_IGNORE_HTTPS_ERRORS` — `1` to force `ignoreHTTPSErrors: true`,
  `0` to force it off. When unset, defaults to `true` in CI (where containers
  often lack an up-to-date root CA bundle and would otherwise fail with
  `ERR_CERT_AUTHORITY_INVALID`) and `false` locally.
- `TEST_SEED_ADMIN_TOKEN` — required only when invoking the
  `test-seed-users` / `test-verify-user` edge functions (see below).
- `SUPABASE_URL` — required for the seed/verify curl examples below.

The fallback config:

- Runs Chromium only
- 60s test timeout, 10s expect timeout, 15s action / 30s navigation timeouts
- Captures screenshots, videos, and traces on failure
- Picks up every `e2e/*.spec.ts`

---

## Test seed harness (Codex / non-Playwright automation)

Two token-gated edge functions let external automation (e.g. Codex) verify
onboarding, premium status, income setup, ledgers, investment inputs, and the
tax engine **without** direct Supabase Auth signup or browser automation.

Set the project secret `TEST_SEED_ADMIN_TOKEN` to enable. Both endpoints
return 503 when the secret is unset and 401 on bad tokens. They only operate
on emails ending in `@paycheckmd.test` — real users are never touched.

### `POST /functions/v1/test-seed-users`

Creates / refreshes 3 deterministic test accounts with realistic May 2026
data. Idempotent — re-running wipes prior `[test-seed]`-tagged rows and
reseeds.

```
curl -X POST "$SUPABASE_URL/functions/v1/test-seed-users" \
  -H "Authorization: Bearer $TEST_SEED_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"reset": true}'
```

| Email                              | Profile        | Premium | Seeded                                                                                  |
| ---------------------------------- | -------------- | ------- | --------------------------------------------------------------------------------------- |
| `test-w2@paycheckmd.test`          | W-2 only       | Yes     | 1 W-2 employer, 2 paychecks + YTD W-2 catch-up, planner stream, investment entries      |
| `test-w2-1099@paycheckmd.test`     | W-2 + 1099     | Yes     | Both employers, mixed YTD + planner streams, investment entries                         |
| `test-1099@paycheckmd.test`        | 1099 only      | Yes     | 1 business entity, 2 1099 deposits + YTD biz catch-up, planner stream, investment entries |

All accounts share the password `TestSeed!2026`.
Investment seeds always include short-term gain, long-term gain, qualified
dividend, and a small short-term loss.

### `POST /functions/v1/test-verify-user`

Returns calculated values + ledger counts for a seeded user so Codex can
compare expected vs actual without rendering the UI.

```
curl -X POST "$SUPABASE_URL/functions/v1/test-verify-user" \
  -H "Authorization: Bearer $TEST_SEED_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"email":"test-w2-1099@paycheckmd.test"}'
```

Response includes: `premium`, `filing_status`, `income_profile_type`,
`onboarding_complete`, `state_tax_enabled`, ledger counts, and totals
(personal/business/investment gross, withholdings, retirement, dividend
buckets, recommended investment tax).

### Stable `data-testid` selectors

Browser tests can target:

- `signup-email`, `signup-password`, `signup-submit`
- `onboarding-income-type-w2`, `onboarding-income-type-w2-1099`, `onboarding-income-type-1099`
- `onboarding-ytd-yes`, `onboarding-ytd-no`, `onboarding-ytd-skip`
- `onboarding-continue`
- `ytd-catchup-company-name`, `ytd-catchup-gross-income`,
  `ytd-catchup-federal-withheld`, `ytd-catchup-state-withheld`,
  `ytd-catchup-ss-withheld`, `ytd-catchup-medicare-withheld`,
  `ytd-catchup-save`, `ytd-catchup-error`, `ytd-catchup-saved-banner`
- `dashboard-summary`, `paychecks-ledger`, `tax-overview-summary`
- `investment-add-entry`, `investment-entry-type`, `investment-taxable-amount`
- `tax-overview-total-gross-income`, `tax-overview-total-tax`,
  `tax-overview-effective-rate`, `tax-overview-federal-tax`,
  `tax-overview-recommended-set-aside`

### Cleanup

Seeded rows are tagged with `[test-seed]` in their `notes` field. Re-running
`test-seed-users` with the default `reset: true` wipes prior seed rows for
the three test accounts before reseeding.

### Transient network retries during seeding

`e2e/helpers/seed.ts` wraps `client.auth.signUp` with a bounded retry +
exponential backoff (≤4 attempts, jittered). It retries only transient
network/DNS/fetch errors — `EAI_AGAIN`, `ENOTFOUND`, `ECONNRESET`,
`ETIMEDOUT`, `fetch failed`, `network timeout`, etc. Real auth/validation
errors (invalid email, weak password, duplicate user) surface immediately.
If all retries fail you'll see: `Network transient: Supabase signup failed
after retries`. Secrets like `TEST_SEED_ADMIN_TOKEN` are never logged.
