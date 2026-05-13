## Problem

On mobile, the Add/Edit Investment Income dialog fills the entire screen and the user can't scroll up or down. The footer buttons (Save/Cancel/Delete) are hidden behind the device's home indicator and inputs at the bottom can't be reached.

## Fix

Update the dialog in `src/pages/InvestmentIncome.tsx` (around line 292) to:

1. **Constrain dialog height and make body scrollable**
   - Change `DialogContent` to `max-w-lg max-h-[90vh] p-0 flex flex-col` so the dialog never exceeds 90% of viewport height.
   - Wrap the header in a non-shrinking container (`px-6 pt-6 pb-2 shrink-0`).
   - Wrap the form fields in a scrollable middle region: `flex-1 overflow-y-auto px-6 py-2`.
   - Move the action buttons row into a sticky footer: `shrink-0 border-t bg-background px-6 py-3` so Save/Cancel/Delete are always visible.

2. **Condense vertical spacing for mobile**
   - Reduce field stack spacing from `space-y-4` to `space-y-3`.
   - Reduce label bottom margin from `mb-1.5` to `mb-1`.
   - Reduce the recommendation card padding (`p-3` → `p-2.5`) and tighten its inner spacing (`space-y-3` → `space-y-2`).
   - Tighten the qualified-dividend row similarly.

3. **No logic changes** — only Tailwind classes / layout structure in the dialog. Form state, validation, save handler, and recommendation calculations are unchanged.

## Result

- The dialog opens at a comfortable height with internal scrolling for the form.
- Header stays pinned at top, action buttons stay pinned at bottom.
- On a 393×697 mobile viewport, all fields are reachable and the Save button is always tappable.
