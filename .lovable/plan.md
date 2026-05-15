# Fix Onboarding/Signup Flow Order

## Problem

Today there are two parallel flows that contradict each other:

- **`/signup`** (renders `Onboarding.tsx`) starts at **Step 1 = name + email + password**, then asks income setup on Step 2, catch-up/companies on Step 3, plan on Step 4. Account creation happens at the start.
- **`/estimate`** (renders `Estimate.tsx`) already does it correctly: income type → details → preview → account creation last.

So users hitting "Sign up" get the reversed flow, while landing-page CTA users get the right one. That's the "messed up logic."

## Goal

Both entry points — the in-app **Sign up** button and the **landing page CTA** — should land in the same flow that:

1. Asks income type first
2. Collects basic estimate details
3. Shows the tax preview
4. Creates the account (first name, email, password) on the **last** step

After account creation, the user lands in the existing post-signup setup (catch-up + companies + plan), then the dashboard.

## Approach

Use the existing `Estimate.tsx` flow as the canonical pre-account flow, and shrink `Onboarding.tsx` to only the post-account steps.

### 1. Route changes (`src/App.tsx`)

- `/signup` → render `Estimate` instead of `Onboarding` (keep `/estimate` as alias for landing CTA).
- `/onboarding` stays for authenticated users completing setup.

### 2. `Estimate.tsx`

- Already correct order. No structural change.
- After successful signup, it already navigates to `/onboarding` — keep that.
- Confirm `persistEstimateToSettings` writes `onboarding_step = 2` (skip the now-removed name/email step) so post-signup onboarding opens at income-source confirmation/catch-up.

### 3. `Onboarding.tsx`

- Remove Step 1 (name/email/password block) entirely. The page now assumes `user` is present.
- Renumber: Step 1 = income setup confirm, Step 2 = catch-up + companies, Step 3 = plan choice. Update progress label "Step X of 3".
- If an unauthenticated user somehow lands on `/onboarding`, redirect to `/signup`.
- Drop the signup-related helpers (`waitForUserSetupRows`, duplicate-email handling, `signupState`, `signupDebugError`, honeypot field, password state) since signup no longer happens here.
- Keep first-name editing inline on the income-setup step (pre-filled from estimate draft) so the user can correct it.

### 4. `Signup.tsx`

- Now just `export { default } from "@/pages/Estimate"` (or re-export `Estimate`).

### 5. Landing CTA

- No change needed — landing page already points at `/estimate`. Both routes now render the same component.

## Technical notes

- `persistEstimateToSettings` already maps the estimate inputs (filing status, state, income kinds, HSA/401k flags) into `tax_settings`, so the post-account onboarding starts pre-filled.
- Email verification path: when `data.session` is null after signup, Estimate already routes to `/login` with a verify-email toast — keep that.
- Session draft key `paycheckmd-estimate-draft` is cleared after successful signup; nothing else depends on it.
- No tax-engine, RLS, or DB schema changes.

## Files touched

- `src/App.tsx` — point `/signup` at `Estimate`.
- `src/pages/Signup.tsx` — re-export `Estimate`.
- `src/pages/Onboarding.tsx` — drop step 1 signup block, renumber steps, remove signup helpers.
- `src/pages/Estimate.tsx` — minor: ensure `onboarding_step` set to skip removed step.
