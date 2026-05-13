## Goal
Refine the expanded transaction UX in `src/pages/BusinessActivity.tsx`. Pure presentation change — no data/logic changes.

## Changes (mobile + desktop expanded view)

1. **Remove the "Linked · N" badge** on the collapsed row.
   - Delete the `badges.push({ label: \`Linked · ${linkedSiblings.length + 1}\`, tone: "info" })` line (~1520).

2. **Move the linked-transactions block to the bottom** of `expandableContent`, after the action buttons row (currently above Category at line 1533).

3. **Make it a collapsible chevron section** with header text `Linked transactions (X)` where X = `linkedSiblings.length` (siblings only, matches current count semantics).
   - Default state: collapsed.
   - Tap header (with chevron icon, `ChevronDown` when open / `ChevronRight` when closed) toggles a local `useState` per row, or use Radix `Collapsible`.
   - Expanded shows the per-sibling list with individual "Unlink" buttons (existing behavior preserved — unlinking restores that transaction to the ledger via `useUnlinkMatchGroupItem`).
   - Footer row inside the expanded panel with two buttons: **"Link More"** (calls `enterMobileSelectionWith(tx.id)`, replacing the standalone "Select for linking" button when linked) and **"Unlink All"** (calls `useUnlinkMatchGroup`).

4. **Conditional bottom action**:
   - If `linkedSiblings.length === 0`: show the existing "Select for linking" button (current behavior).
   - If `linkedSiblings.length > 0`: hide standalone "Select for linking" button; the collapsible "Linked transactions (X)" section replaces it, with "Link More" inside.

## Layout (expanded view, top → bottom)
```text
Category .........................
Company ..........................
Schedule C (if any) ..............
Source ...........................
Account (if any) .................
Attachments (if any) .............
Deposited (if any) ...............
Notes (if any) ...................
[View Receipt] [Select for linking]    ← only if not linked
─────────────────────────────────
▸ Linked transactions (3)              ← only if linked; collapsible
  (expanded:)
  ACH … May 7 · $300 · Income   [Unlink]
  ACH … May 7 · $3,180 · Income [Unlink]
  ACH … May 7 · $3,360 · Income [Unlink]
  [Link More]  [Unlink All]
```

## Technical notes
- All state lives inside the row's render closure or via a `Map<txId, boolean>` in component state for expansion. Simplest: extract a small `LinkedTransactionsPanel` subcomponent with its own `useState(false)` for open/closed.
- Keep existing Tailwind tokens (`bg-blue-50/60 dark:bg-blue-950/20`, `border-blue-200/50`, etc.).
- No changes to `useTransactionMatching`, schema, or other ledger logic.
- "Select for linking" button stays in the action button row when no links exist; "Link More" inside the collapsible reuses the same `enterMobileSelectionWith(tx.id)` handler.

## Out of scope
Tax engine, hooks, schema, suggestions, desktop selection flow.
