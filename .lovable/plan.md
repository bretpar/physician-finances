# Conflict-Resolving Transaction Linking

## Scope

Only the transaction-linking UX + a small merge engine. No tax math, withholding, ledger, or matching-eligibility logic is touched. Automatic-match tolerance and suggested-match scoring stay as-is.

## Current architecture (short review)

- `useTransactionMatching.ts` (971 LOC) handles suggest/link/unlink. Linking is silent: it writes `transaction_links`, flips `status` on the non-canonical side, and lets the canonical row's fields win by default.
- `IncomeLinkModal` picks the imported sibling and confirms; there is no field diff surfaced.
- Downstream reads (fixed in the last turn) already respect explicit user-saved values (`deposited_amount`) over Plaid, so we don't need to alter reads.

## Design decision

A field-level merge engine is the right upgrade over the "hierarchy silently wins" model:

1. **Merge engine** — one pure module compares field-by-field between the manual income entry / manual transaction and the Plaid transaction, returns a `FieldConflict[]` list with `{ field, label, currentValue, importedValue, defaultChoice, kind }`.
2. **User-lock preservation** — decisions are persisted per link on `transaction_links` as a JSONB `field_locks` column (`{ deposited_amount: "current", transaction_date: "imported", vendor: {custom: "..."} }`). Any future Plaid resync respects these locks and never rewrites a locked field.
3. **Field authority defaults** — Plaid amount is authoritative for `deposit_amount` only; user-entered gross / withholding / retirement / HSA / notes default to "current". Date defaults to imported (bank posts truth).
4. **Both values preserved** — we never delete the Plaid sibling row; it stays marked `status='merged'` as today, so the raw bank amount remains queryable and continues to render on the linked-transaction card.
5. **Large-diff banner** — reuse existing `matchTolerance` from `useTransactionMatching`; if delta > max(tolerance, 10%), show the informational banner.

## Deliverables

### New files
- `src/lib/linkMergeEngine.ts` — pure diff + default-choice logic + apply function; unit-tested.
- `src/components/ResolveDifferencesModal.tsx` — table UI with per-row dropdown (Keep Current / Use Imported / Custom), large-diff banner, "Link Transactions" CTA.
- `src/test/linkMergeEngine.test.ts` — covers: identical fields skipped, amount conflict, multi-field conflict, default-choice per field, custom override, large-diff flag, applying locks.

### Edited files
- `src/hooks/useTransactionMatching.ts` — `linkManualToPlaid` (or equivalent) becomes a two-phase mutation: (a) compute conflicts via engine; if empty, link as today; (b) if conflicts, resolve caller supplies decisions before persisting. Adds writes of `field_locks` + applied field values.
- `src/components/IncomeLinkModal.tsx` and `src/components/SuggestedMatches.tsx` — when the user confirms a link, if the engine returns conflicts, open `ResolveDifferencesModal` instead of firing the link mutation directly.
- `supabase/functions/plaid-sync-transactions/index.ts` — before overwriting a linked canonical row's fields, read `field_locks` and skip any locked field. No change to import of new rows.

### Migration (single file)
- Add `field_locks jsonb not null default '{}'::jsonb` to `public.transaction_links`. No policy changes needed (existing RLS covers it).

## Technical details

**Conflict shape**

```ts
type FieldConflict = {
  key: "gross_amount" | "deposited_amount" | "transaction_date" | "vendor"
     | "category" | "notes" | "federal_withholding" | "state_withholding"
     | "ss_withholding" | "medicare_withholding" | "retirement_401k"
     | "hsa_contribution" | "pre_tax_deductions";
  label: string;
  kind: "money" | "date" | "text";
  currentValue: string | number | null;
  importedValue: string | number | null;
  defaultChoice: "current" | "imported";
  allowCustom: boolean;
};
```

**Equality rules**
- money: `Math.abs(a-b) < 0.005`
- date: same ISO day
- text: case-insensitive trim
- null / undefined / 0 on one side and a real value on the other → NOT a conflict; the real value is auto-used.

**Large-diff banner** fires when both sides have a positive amount and `|current - imported| / max(current, imported) > 0.10`.

**Resync guard** in `plaid-sync-transactions`: when updating a linked canonical row, load `field_locks` from `transaction_links` and drop those keys from the update payload.

## Out of scope

- Tax engine, withholding recommendation, savings rate, ledger routing, planner conversion.
- Auto-match tolerance / scoring logic in `useTransactionMatching`.
- Unlink UX and orphan cleanup.

## Verification

- `bunx vitest run src/test/linkMergeEngine.test.ts` — new unit tests.
- Existing suites: `linkEligibility.test.ts`, `transactionLinkingDedupe.test.ts` must still pass unchanged.
- Manual: link a manual $7,330 income to a $1,410 Plaid deposit → modal appears with amount + description rows, banner shown; picking "Keep Current" for amount and "Use Imported" for description completes the link and survives a simulated resync.
