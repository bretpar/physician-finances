# Consistent Transaction Detail Card

Add a single read-only "detail card" step that opens whenever a user clicks any transaction across the app, before any edit form is shown. Edit/Delete inside the card route into the existing form/confirmation flows — no rewrite of save logic.

## New shared component

`src/components/TransactionDetailSheet.tsx` — controlled `Sheet` (mobile-friendly, drops to bottom on small screens, side panel on desktop).

Props:
```ts
type DetailField = { label: string; value: ReactNode; mono?: boolean };
type DetailSection = { title: string; fields: DetailField[] };

type TransactionDetailSheetProps = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  header: {
    title: string;          // source / name
    date: string;           // formatted
    amount: number;
    amountTone?: "income" | "expense" | "neutral";
    badges?: { label: string; tone?: "default"|"success"|"warning"|"muted" }[];
  };
  sections: DetailSection[];          // Basic, Tax, Payment/Savings, Notes...
  linked?: {                          // optional Linked Transactions section
    items: { id: string; label: string; amount?: number; date?: string }[];
    onUnlink?: (id: string) => void;
    onLink?: () => void;              // opens existing link picker
  };
  primaryActions?: ReactNode;         // type-specific (Convert to ledger, etc.)
  onEdit?: () => void;
  onDelete?: () => void;
};
```

Layout:
- Header: date · type badges · large amount · source/name
- Sections rendered as `<dl>` with label/value rows
- Linked Transactions section (if provided) with per-item Unlink + a "Link transactions" button
- Footer: secondary special actions (left), Edit + Delete (right). Delete uses `variant="destructive"`.

## Page wiring

For each list page, intercept the row/card click to open the detail sheet first. The existing "open edit form" handler becomes the sheet's `onEdit`. Existing delete-confirm becomes `onDelete`.

| Page | Existing edit fn | Detail sections / extras |
|---|---|---|
| `src/pages/PersonalIncome.tsx` | `openEdit(entry)` | Basic (title, date, source, category), Tax (taxable, withheld), Payment, Linked transactions (existing transaction-link picker) |
| `src/pages/BusinessActivity.tsx` | `openEditIncome` / `openEditExpense` | Basic (date, vendor/source, company, category, amount), Tax (deductible, business_use_pct), Linked (existing link multi-select), Imported source/plaid badge |
| `src/pages/ProjectedIncome.tsx` | row click currently navigates / opens convert | Header shows planned date + amount + status (Active/Converted/Matched/Skipped). Primary action: "Convert to ledger" (uses `openConvert`) when not converted; otherwise "Open ledger row". Secondary: Override, Skip/Restore. Edit → `openOverrideEdit`. |
| `src/pages/InvestmentIncome.tsx` | `openEdit(entry)` | Basic (date, asset, type), Tax (proceeds, cost basis, taxable amount, recommended set-aside, actual saved) |
| `src/components/RecentTransactions.tsx` (dashboard) | navigates | Opens same detail sheet using ledger row data |
| Plaid/imported rows (inside BusinessActivity / PersonalIncome list) | — | Same sheet; show "Imported from Plaid" badge + raw merchant; Link action when unlinked |

Row-level inline icon buttons (edit/delete) and dropdown menus are preserved as power-user shortcuts and bypass the detail sheet.

## Linked-transactions reuse

Reuse the existing link picker (the multi-select transaction link UI already used on Business/Personal pages). Detail card just exposes: list current links, "Unlink" per item, "Link transactions" opens that picker.

## Out of scope

- No DB changes
- No changes to forms, validation, save handlers, delete handlers, or calculation logic
- No removal of existing edit forms or confirmations
- No new keyboard shortcuts or routing

## Files

Created:
- `src/components/TransactionDetailSheet.tsx`

Edited (small wiring deltas only):
- `src/pages/PersonalIncome.tsx`
- `src/pages/BusinessActivity.tsx`
- `src/pages/ProjectedIncome.tsx`
- `src/pages/InvestmentIncome.tsx`
- `src/components/RecentTransactions.tsx`
