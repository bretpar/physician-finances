# Many-to-many transaction matching

Today the app uses a strict 1:1 link between one manual `transactions` row and one Plaid `transactions` row, stored in `transaction_links` and reflected via `linked_group_id` + `source_type='merged'` on the duplicate. We need to generalize this to N:M matched groups while keeping all existing tax/ledger/dashboard math correct.

## Data model

New tables:

- `transaction_match_groups`
  - `id`, `user_id`, `organization_id`, `status` ('active' | 'unlinked'),
    `manual_total`, `imported_total`, `difference`, `note`,
    `created_at`, `updated_at`
- `transaction_match_group_items`
  - `id`, `match_group_id` (FK), `transaction_id`,
    `transaction_source` ('manual' | 'imported'),
    `created_at`
  - Unique partial index: a transaction can be in only ONE active group
    (`UNIQUE (transaction_id) WHERE match_group_id IN active groups`) — enforced
    via a trigger that checks the parent group's status.

RLS: org-scoped + owner-fallback policies, mirroring `transaction_links`.

Backfill migration:
- For each `transaction_links` row with `status='linked'`, create one
  `transaction_match_groups` row + two `transaction_match_group_items`
  rows (1 manual, 1 imported). Reuse the existing `linked_group_id` as
  `match_group_id` so existing `transactions.linked_group_id` keeps pointing
  at the same UUID.

Keep `transaction_links` table in place (read-compatible) but stop writing
to it from new code paths.

## Transactions table behavior (unchanged invariants)

For each active group:
- Manual rows stay `status='active'`, `match_status='linked'`, `linked_group_id=<group>`.
- Imported rows are flipped to `status='merged'`, `match_status='linked'`, `linked_group_id=<group>` so they vanish from ledger/tax/dashboard queries (which already filter `status='active'`).
- If a group has ONLY imported items (no manual), the imported items stay `status='active'` — they count normally. The "prefer manual as source of truth" rule is implemented by hiding imported rows only when at least one manual row exists in the group.

This preserves the existing tax engine, ledgers, reports, and dashboard math without changes to those modules.

## Hooks (`src/hooks/useTransactionMatching.ts`)

Add:
- `useMatchGroups()` — list active groups + items.
- `useCreateMatchGroup({ manualIds, importedIds })` — validates none are already in an active group; inserts group + items in one RPC; updates `transactions` rows (manual→active+linked, imported→merged+linked when manual present, else imported stays active+linked).
- `useUnlinkMatchGroup(groupId)` — sets group `status='unlinked'`, restores all member transactions to `status='active'`, `match_status='unmatched'`, `linked_group_id=null`.
- `useUnlinkMatchGroupItem(itemId)` — removes one item; if the remaining group has <2 items total, auto-unlinks the whole group; otherwise recomputes totals/difference and re-evaluates whether imported rows should be hidden.

Keep `useLinkTransactions` as a thin wrapper that calls `useCreateMatchGroup` with one manual + one imported, so existing call sites keep working.

## UI

`src/components/SuggestedMatches.tsx` (and the matching modal it opens):
- Add multi-select checkboxes on both manual and imported lists.
- "Matched Group" summary card above the action button:
  - Manual count + total
  - Imported count + total
  - Difference (formatted with sign)
  - Status pill: green "Totals match" when |difference| < $0.01, amber warning otherwise with the requested copy.
- Primary CTA: "Create matched group" (disabled until at least 1 manual and 1 imported, OR ≥2 imported with 0 manual is also allowed per spec — we'll require ≥2 items total with at least one of either side).
- Mobile: stack lists vertically, compact rows (date • vendor • amount), sticky summary at bottom.

`src/components/LedgerRow.tsx` (and any ledger that shows linked badges):
- When a row's `linked_group_id` is set, show compact badge "Matched group · N items" (or "Matched to N imported transactions" for the manual-anchored case).
- Click opens a `MatchGroupDetailDialog` listing all manual + imported items with per-item "Unlink" buttons and a group-level "Unlink entire group" button.

New file: `src/components/MatchGroupDetailDialog.tsx`.

## Tax / dashboard safety

No changes needed to tax or dashboard code: they already read `transactions` filtered by `status='active'`. The grouping logic enforces that imported duplicates are flipped to `status='merged'` whenever a manual sibling exists, so no double-counting occurs. Groups with only imported items leave those rows active, matching the spec.

We'll add a unit test in `src/test/` that constructs a synthetic group (1 manual $10k + 3 imported $4k/$3.5k/$2.5k) and asserts only the manual contributes to active-row totals.

## Out of scope

- Changing the suggestion scoring algorithm (still pairwise; multi-select is user-driven, suggestions stay 1:1 hints).
- Renaming `transaction_links` (kept for backward read compatibility; new code writes only to the new tables).

## Implementation order

1. Migration: new tables + RLS + backfill + uniqueness trigger.
2. Hooks: add group CRUD; refactor existing link/unlink to delegate.
3. UI: multi-select in matching modal + summary card.
4. Ledger badge + detail dialog with per-item unlink.
5. Test for no-double-count invariant.
