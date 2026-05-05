## Goal

Reduce visual clutter on the Settings page by merging two pairs of related sections into single combined cards, while keeping each input area visually distinct so users still understand they are editing two different things.

## Changes

### 1. Combine "Profile" + "Tax Profile" → single card "Profile & Tax Profile"

- Render one outer `SectionCard` titled **"Profile & Tax Profile"** (icon: User, description: "Your personal info and tax filing details").
- Inside, render two clearly delimited sub-sections separated by a horizontal `Separator` and labeled headers:
  - **Personal Profile** — first/last name, email (current `ProfileSection` body).
  - **Tax Profile** — filing status, state, manual rates, withholding target, etc. (current `TaxProfileSection` body).
- Each sub-section keeps its own draft state, dirty tracking, and Save/Cancel action bar (independent saves so editing one doesn't force saving the other).

### 2. Combine "Tax Withholding Method" + "Quarterly Tax Tracker Method" → single card "Tax Methods"

- Render one outer `SectionCard` titled **"Tax Withholding & Quarterly Tracker"** (icon: Calculator, description: "Choose how withholding recommendations and quarterly targets are calculated.").
- Inside, two clearly delimited sub-sections:
  - **Withholding Method** — radio group from `TaxWithholdingSection`.
  - **Quarterly Tracker Method** — radio group from `QuarterlyTrackerMethodSection`.
- Separated by a `Separator` with bold sub-headers + short helper text so the user can tell they are two distinct settings.
- Each retains independent draft + Save/Cancel.

### 3. Settings page layout

Update the render order in `Settings.tsx` to use the two new combined wrappers in place of the four current sections; the rest of the page (Onboarding Preferences, Household Income Streams, HSA, Forecasting, Companies, Connected Accounts, Team, Data Maintenance) is unchanged.

## Technical notes

- New file: `src/components/settings/CombinedSectionCard.tsx` — a lightweight wrapper that renders an outer card shell (similar styling to `SectionCard` but without its own save bar) and accepts `children`. Alternatively, reuse `SectionCard` with `hideActionBar` and place the two existing section components inside; the inner sections already render their own save bars so this works with no refactor of their internals.
- Preferred approach: refactor each of the four affected section components to expose a "body-only" variant (no outer card chrome) — e.g. `ProfileSectionBody`, `TaxProfileSectionBody`, `TaxWithholdingBody`, `QuarterlyTrackerBody` — and render them inside one shared `SectionCard`. Each body keeps its own `useSectionDraft` + a small inline action bar (`Save`/`Cancel`) shown only when that body is dirty.
- Sub-section visual treatment: `<div>` with `space-y-3`, `<h4 className="text-sm font-semibold">` header, optional 1-line muted description, then the form controls. A `<Separator className="my-6" />` between the two bodies.
- No changes to data hooks, mutations, or schema.

## Acceptance

- Settings shows one card "Profile & Tax Profile" instead of two separate cards.
- Settings shows one card "Tax Withholding & Quarterly Tracker" instead of two separate cards.
- Each combined card visually separates the two areas with a header + divider.
- Saving one sub-section does not affect the other.
- Collapsing the combined card with unsaved edits in either sub-section still triggers the discard confirmation.
- Mobile layout remains clean (no horizontal overflow).
