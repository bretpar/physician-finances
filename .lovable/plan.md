# Highlight uncategorized transactions

Match the existing amber "Review" treatment for any ledger row whose category resolves to "Uncategorized", so users immediately see it needs attention.

## Change

In `src/pages/BusinessActivity.tsx` (the desktop ledger row, around line 1457–1459 where the category cell renders `mapLegacyCategory(tx.category)`):

- Compute `const categoryLabel = mapLegacyCategory(tx.category) || "Uncategorized";` and `const isUncategorized = !isIncomeTx && !isTransferTx && (categoryLabel === "Uncategorized" || !tx.category);`
- When `isUncategorized`, render the label inside an amber outlined `Badge` (same palette as the "Review" badge: `border-amber-400 text-amber-600 dark:text-amber-400`, rounded pill, small text).
- Otherwise keep the current plain muted text.

Apply the same treatment in the mobile/expanded card view at line ~1524 (`categoryLabel = ... || "Uncategorized"`) — wrap the value next to the "Category" label with the same amber pill when uncategorized.

No data, hook, or schema changes. Visual-only tweak using existing Tailwind tokens already in use for the Review badge.
