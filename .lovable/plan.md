# Multi-User Data Isolation Audit & Hardening

## Current state (from audit)

- **All 32 public tables have RLS enabled.**
- **All user-owned tables have both `user_id` and `organization_id`** (only exceptions: `organizations` itself, `user_roles`, and join/system tables — all correct by design).
- **Dual-policy pattern is already in place on every user table**: an org-scoped policy via `organization_id IN get_user_org_ids(auth.uid())` plus an "Owner fallback" policy for legacy rows where `organization_id IS NULL AND auth.uid() = user_id`.
- **Signup is already correct**: `handle_new_user()` trigger on `auth.users` creates `organizations`, `organization_members` (role `owner`), `profiles`, and `tax_settings` rows — all keyed to `NEW.id`.
- **Most hooks already call `getUserOrgId()`** and insert `organization_id` on writes.

So the foundation is sound. This plan focuses on the remaining gaps and on **proving** isolation with tests + a debug report.

## Gaps to fix

### A. Database / RLS

1. **`plaid_items` SELECT** is owner-only (one policy, `auth.uid() = user_id`) — inconsistent with the dual-policy pattern. Add an org-scoped SELECT policy so org members can view shared Plaid items, mirroring the other Plaid tables.
2. **`transaction_match_ignores`** is missing an UPDATE policy (intentional since rows are immutable) — leave as is, but document.
3. **`transaction_attachments`** has only one UPDATE and one DELETE policy — verify the single policy covers both org + owner-fallback; if not, split into the standard pair.
4. Add a **trigger** on every user-owned table that enforces `NEW.user_id = auth.uid()` on INSERT when called from an authenticated context (defense-in-depth so a future buggy policy can't let one user write rows under another user's id). Skip for service-role / edge-function paths by checking `auth.role() = 'authenticated'`.

### B. Frontend hooks

Sweep all hooks under `src/hooks/` and ensure every user-write path:

- Calls `getUserOrgId()` and includes `organization_id: orgId` in inserts.
- Includes `user_id: user.id` in inserts (RLS already requires it but be explicit).
- Adds `.eq("organization_id", orgId)` on selects for **new** queries; existing queries that rely solely on RLS keep working but get an explicit filter for defense-in-depth where it doesn't break legacy NULL-org rows.

Hooks confirmed already correct: `useIncome`, `usePersonalIncome`, `useInvestmentIncome`, `useTransactions`, `useStocks`, `useTaxPayments`, `useTaxSavings`, `useRetirementContributions`, `useMileage`, `useHomeOfficeDeductions`, `useHsaContributions`, `useYtdCatchup`, `useAttachments`, `useIncomeSources`, `useTransactionMatching`, `useProjectedIncome`.

Hooks to spot-check & patch if missing: `useTaxSettings`, `useTransactionLinks` (if exists), any direct `supabase.from(...)` calls inside page components.

### C. Tests

Add `src/test/dataIsolation.test.ts` (vitest, runs against the real backend with two seeded users via the existing `test-seed-users` edge function):

1. Seed User A and User B (each gets their own org via the signup trigger).
2. As User A: insert rows in `companies`, `income_entries`, `transactions`, `projected_income_streams`, `planner_conversions`, `tax_settings`.
3. As User B: insert a separate set of rows.
4. Re-auth as A → assert `select *` returns zero of B's rows in every table.
5. Re-auth as B → same in reverse.
6. Cross-user **direct attack**: as A, try `update`/`delete` by row id against B's rows → assert RLS blocks (zero rows affected, no error leaked).
7. Service-role edge function (`test-verify-user`) must scope queries by user_id; add an assertion that calling it with User A's id never returns User B rows.

### D. Admin debug report

New page `src/pages/admin/DataIsolationReport.tsx`, only visible when `has_role(auth.uid(), 'admin')` returns true (route guarded). It calls a new edge function `data-isolation-report` (service role) that returns, per table:

- Total row count.
- Row count grouped by `user_id` and `organization_id`.
- Rows with `user_id IS NULL` (should always be 0 going forward).
- Rows with `organization_id IS NULL` created **after** the deploy timestamp of this fix.
- Rows where `organization_id` does not appear in `organization_members` for the row's `user_id` (cross-org leak).

UI shows a table per audited entity with green check / red flag and a copy-to-clipboard JSON dump.

## Files

- `supabase/migrations/<timestamp>_data_isolation_hardening.sql` — fix `plaid_items` SELECT, normalize `transaction_attachments`, add `enforce_user_id_matches_auth()` trigger function and attach to all user-owned tables.
- `supabase/functions/data-isolation-report/index.ts` — new service-role read-only report.
- `src/pages/admin/DataIsolationReport.tsx` + route in `App.tsx`, guarded by admin role.
- `src/test/dataIsolation.test.ts` — cross-user vitest suite.
- Minor patches to any hook missing `organization_id` on insert (sweep pass).

## Out of scope

- Restructuring the existing fallback policies (they're correct).
- Touching `auth.*` schema.
- Building a UI that merges users' data (explicitly forbidden by the request).
