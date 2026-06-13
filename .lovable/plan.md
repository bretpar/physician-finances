# Plaid Sync Improvements

Targeted change focused only on sync triggering, scheduling, metadata, and upsert safety. No refactor of unrelated Plaid, ledger, or tax code.

## 1. Schema (one migration)

Add to `public.plaid_items`:
- `last_sync_attempt_at timestamptz`
- `last_successful_sync_at timestamptz`
- `last_sync_error text`
- `sync_status text` — one of `idle | syncing | error` (default `idle`)
- `webhook_url text` (for visibility; actual URL lives in env)

Keep existing `last_synced_at` and `cursor` as-is for backward compat. The function will populate both `last_synced_at` and the new `last_successful_sync_at` on success so existing UI keeps working.

## 2. `plaid-sync-transactions` edge function changes (minimal)

- At start of each item sync: set `sync_status='syncing'`, `last_sync_attempt_at=now()`.
- On success: set `sync_status='idle'`, `last_successful_sync_at=now()`, clear `last_sync_error`.
- On failure: set `sync_status='error'`, set `last_sync_error=<message>`.
- **Removed handling fix**: when Plaid reports a transaction as removed, do not hard-delete the app `transactions` row if `user_edited = true`. Instead, mark it (set `excluded_from_reports=false` left alone; set a `match_status='plaid_removed'` and detach the `plaid_transaction_ref`). Always still delete the raw `plaid_transactions` mirror + write tombstone.
- Modified handling already preserves user-edits via `user_edited` flag — leave unchanged.
- Accept a new entry shape from the webhook handler: `{ item_id: "<uuid>" }` invoked with service role / cron secret will sync just that one item.

## 3. New webhook handler: `supabase/functions/plaid-webhook/index.ts`

- `verify_jwt = false` (Plaid calls anonymously).
- Validates `webhook_type` and acts on:
  - `TRANSACTIONS` / `SYNC_UPDATES_AVAILABLE` → look up `plaid_items` row by `plaid_item_id`, invoke `plaid-sync-transactions` with `{ item_id }` using the service role + cron secret.
  - `ITEM` / `ERROR` or `PENDING_EXPIRATION` / `USER_PERMISSION_REVOKED` → update `plaid_items.status` to `needs_reauth` and `last_sync_error`.
  - Other types: 200 OK no-op.
- Returns 200 quickly; sync runs as background invoke.

`plaid-exchange-token`: pass `webhook: <PLAID_WEBHOOK_URL>` when calling `/item/public_token/exchange`-flow link token + on item creation. Store `webhook_url` on the row.

Required env: `PLAID_WEBHOOK_URL` (e.g. `https://<project>.supabase.co/functions/v1/plaid-webhook`). I'll request this via the secrets flow.

## 4. Daily cron at 2:00 AM Pacific

Update `install_plaid_sync_cron_job` to schedule `'0 10 * * *'` UTC (= 2:00 AM PST / 3:00 AM PDT — acceptable per spec; pure 2 AM wall clock requires DST-aware scheduling pg_cron does not support). Existing fan-out body and `x-cron-secret` flow unchanged. The cron job runs regardless of login.

The cron function already skips non-active items; we'll additionally skip items with `status in ('needs_reauth','disconnected','error')`.

## 5. Frontend: stale gate, cooldown, login trigger

**`src/pages/Accounts.tsx`**
- Bump stale threshold from 5 min → 24 h. (TODO comment for premium 12 h tier.)
- "Refresh All" button: 30-minute cooldown per user stored in `localStorage` key `plaid:lastManualSync:<userId>`. Cooldown bypassed if last attempt errored. Show remaining time in disabled tooltip.
- Per-item rows: show "Syncing…", "Sync failed: <msg>", or "Reconnect required" using new metadata; otherwise "Last synced X ago".

**Dashboard login trigger** (`src/pages/Dashboard.tsx`)
- On mount, if any active item's `last_successful_sync_at` is >24 h old (or null), fire a single background `syncMutation.mutate(undefined)` — no UI block, no toast on success, error toast only.
- Guard with a session-scoped flag (`sessionStorage`) so it doesn't refire on remounts within the same session.

No noisy toasts on routine syncs; only actionable errors.

## 6. Tests

Only nearby tests touched:
- `supabase/functions/plaid-exchange-token/rls_test.ts` / `sandbox_test.ts` — leave alone unless webhook field breaks them.
- No existing client tests for Accounts sync; skip per spec.

## Files

New:
- `supabase/functions/plaid-webhook/index.ts`
- one migration adding the 4 columns + updating `install_plaid_sync_cron_job` + re-installing the cron with the new schedule (insert tool, since it uses the secret).

Edited:
- `supabase/functions/plaid-sync-transactions/index.ts` (metadata writes, removed-transaction guard, accept `item_id` from webhook)
- `supabase/functions/plaid-exchange-token/index.ts` (set `webhook` + `webhook_url`)
- `src/hooks/usePlaid.ts` (expose new metadata fields)
- `src/pages/Accounts.tsx` (24 h stale gate, 30 min cooldown, status UI)
- `src/pages/Dashboard.tsx` (stale-only background sync once per session)

## Secret needed

`PLAID_WEBHOOK_URL` — I'll request it after you approve the plan; you'll paste `https://fiqnxprhvsadcqicczkg.supabase.co/functions/v1/plaid-webhook`.

Approve and I'll ship it.