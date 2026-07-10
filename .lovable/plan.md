## Goal

Today the matcher only proposes 1-to-1 pairs and dedupes so each Plaid deposit appears in at most one suggestion. Split deposits (one Plaid credit that actually covers multiple paychecks/income entries, or several small Plaid credits that together cover one gross entry) get missed or, worse, force the user to pick a single "wrong" partner. This adds first-class detection and suggestion of split-deposit combinations, reusing the existing many-to-many match group plumbing (`useCreateMatchGroup`) so no backend changes are needed.

## Scope (UI + client logic only)

No database migrations. No changes to tax math, save flow, or Plaid sync. Suggestion generation, conflict detection, and the suggested-match card are the only surfaces that change.

## Detection logic (`useSuggestedMatches`)

Extend the current 1-to-1 pass with a second "combination" pass:

1. Group unmatched manual income entries by `entity`/company and by date bucket (±7 days from each Plaid deposit, same rule already used).
2. For every unmatched Plaid income deposit `P`, look at the manual candidates in that window.
   - Compute the target: prefer the sum of each manual entry's `deposited_amount` (net) when known, otherwise fall back to calculated net, otherwise gross — mirroring the existing 1-to-1 amount scoring.
   - Enumerate subsets of size 2 and 3 (cap 3 to keep it O(n³) in a small window). Skip any subset whose best 1-to-1 pair for `P` is already a Strong match.
   - Accept a combo when the summed target is within 2% (Strong) / 5% (Possible) of `|P.amount|`.
3. Emit a new suggestion shape: `{ kind: "split", plaidTx, manualTxs: DbTransaction[], sumTarget, confidence, confidenceLabel, reasons }`. Existing 1-to-1 shape becomes `{ kind: "single", manualTx, plaidTx, ... }`.
4. Dedup rules updated: a Plaid tx may appear in at most one suggestion (single OR split, whichever scored higher); a manual tx may appear in at most one suggestion. Split combos beat weaker singles on the same Plaid tx.

## Conflict detection

- Reuse `computeLinkConflictsForPair` per manual↔plaid pair inside a split combo; surface any pair-level field conflicts (vendor/date/category/notes) aggregated into one Resolve Differences pass before creating the group.
- New "sum mismatch" soft warning shown on the card when `|sum − plaid| / plaid` is between 0.5% and 5% (analogous to today's `showDiscrepancy`).
- Refuse a split combo if any manual tx in it is already `match_status = "linked"` (already enforced by `useCreateMatchGroup`).

## UI (`SuggestedMatches.tsx`)

- New card variant for `kind === "split"`:
  - Left column lists the multiple manual entries stacked (vendor, gross, date, entity) with a small "×N split" badge.
  - Right column shows the single Plaid deposit.
  - Footer shows `sum $X vs deposit $Y (Δ $Z)` and reason chips ("Sum matches deposit", "Same company", "Within 3d").
  - Confirm button calls a new `useConfirmSplitMatch` wrapper that:
    1. Runs `computeLinkConflictsForPair` for each manual↔plaid pair, opens ResolveDifferencesModal once if any conflicts (aggregated), then
    2. Calls `useCreateMatchGroup({ transactionIds: [...manualIds, plaidId] })` — existing hook already handles many-to-many, canonical-row selection, and soft-merging the Plaid side.
  - Dismiss button ignores every pair in the combo via `useIgnoreMatch` in a batch.

## Tests

- Unit tests in `src/test/splitDepositMatching.test.ts`:
  - Two manuals whose deposited sums equal a single Plaid deposit → one split suggestion, no singles.
  - Three-manual combo, ±5 day window, same entity → Possible match.
  - Combo whose sum is >5% off deposit → not suggested.
  - Split combo takes precedence over a mediocre single suggestion competing for the same Plaid tx.
  - Ignored-pair set suppresses combos that include any ignored pair.

## Files changed

- `src/hooks/useTransactionMatching.ts` — extend `SuggestedMatch` type (discriminated union), add combo pass, add `useConfirmSplitMatch` helper.
- `src/components/SuggestedMatches.tsx` — render split variant, wire confirm/dismiss.
- `src/test/splitDepositMatching.test.ts` — new tests.

## Out of scope

- Many-Plaid-to-one-manual (multiple small deposits for one gross entry). Same combinatorial logic applies but I'll defer unless you want it in this pass — say the word and I'll add the symmetric pass.
- Backend-side split allocation (per-manual portion of the deposit). The existing group model treats them as linked without splitting the Plaid amount across manuals; deposited_amount stays per-entry as the user already set it.
