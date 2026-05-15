# Improve YTD catch-up onboarding step

When a user picks "Yes, help me catch up" in onboarding step 3, they land on the YTD catch-up form (which captures an employer/company plus paystub totals). Today, after saving an entry, the only path to add another is the form's own re-entry, and existing entries can only be deleted from the recap — not edited. This makes the multi-employer flow clumsy and fragile to typos.

## Changes

1. **"Add another employer" affordance after save**
   - After `YtdCatchupForm` saves, collapse the form into a saved-state row and surface a primary "Add another employer" button right below the recap, instead of relying on the user to scroll back into a fresh form.
   - The button resets the form to a blank entry (preserving period defaults) so the user can immediately add the next paystub without leaving the screen or hitting Continue.
   - Keep the bottom "Continue" button as the way to advance to the next onboarding step once they're done.

2. **Edit existing entries inline**
   - In `YtdCatchupRecap`, add an Edit (pencil) action next to each entry alongside the existing Delete.
   - Clicking Edit loads that entry into `YtdCatchupForm` in edit mode (it already supports `initial`), scrolls the form into view, and changes the save button to "Save changes". Cancel returns to the add-new state.
   - Show entries grouped by employer with their gross / federal / state totals so mistakes are easy to spot.

3. **Copy + state polish**
   - Update the catch-up screen heading to make the multi-employer intent obvious ("Add each paystub or 1099 source you've earned from this year").
   - After a successful save, show a subtle confirmation ("Saved – Providence YTD added") and clear the form fields.
   - Disable "Add another employer" while a save is in flight.

## Technical notes

- Files touched:
  - `src/pages/Onboarding.tsx` — wire `onSaved` to switch the form into a "saved, add another?" state; render the new add-another button between recap and form.
  - `src/components/YtdCatchupForm.tsx` — accept `key`/reset trigger, expose an `onSaved` callback already present, make sure Cancel works in edit mode.
  - `src/components/YtdCatchupRecap.tsx` — add `onEdit(entry)` prop and an Edit icon button per row.
- No schema changes; `useYtdCatchup` already supports upsert by `id`.
- Continue/Back behavior on this step is unchanged.
