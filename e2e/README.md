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

```
bunx playwright test e2e/disposable-user.spec.ts
```
