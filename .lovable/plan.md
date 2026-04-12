

## Fix: Make Edit Transaction Dialog Scrollable

**Problem**: The edit dialog (especially for income transactions) contains too many fields and overflows the viewport, making it impossible to scroll or reach the Save button.

**Solution**: Add a scrollable container inside the dialog so all fields are accessible regardless of screen size.

### Changes

**File: `src/pages/Transactions.tsx`** (line 398)
- Add `max-h-[85vh]` and `overflow-y-auto` to the DialogContent so the entire dialog becomes scrollable within the viewport
- This keeps the dialog compact and allows users to scroll to reach all fields and the Save/Cancel buttons

**File: `src/components/ui/dialog.tsx`** (no changes needed — the fix is applied via className on the specific dialog instance)

This is a single-line className change that immediately fixes the scrolling issue.

