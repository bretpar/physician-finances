# Diagnostic Report — W-2 Multi-Employer Playwright Failure

Investigation only. No code changes.

## Most likely root cause

**Production deployment mismatch.** Lovable preview reflects the latest source; `app.paycheckmd.com` only updates when the user clicks **Publish → Update**. The recent fixes to the Add Company modal, `settings-company-*` testids, `AddCompanyDialog` form wrapper, the post-erase `paycheckmd-start-setup` bypass, and the `account-cleanup` `verify_jwt = false` change are all frontend/edge changes that may not be live on production yet. A test that worked in preview will fail in prod if either the testids it queries or the post-erase guard behavior aren't deployed.

Secondary suspect: the test is waiting on **visible text** for "Step 1" rather than the stable `data-testid="onboarding-step-1"`, so any copy drift or pre-hydration render shows the wrong content for a moment.

## Answers to your 7 questions

1. **Prod vs preview parity** — Not guaranteed. Frontend changes require a manual Publish. Edge functions (`account-cleanup`) deploy automatically, but the `supabase/config.toml` `verify_jwt=false` for that function only takes effect after a Cloud deploy. Verify by hitting `/onboarding` in prod and checking for `data-testid="onboarding-step-1"` and the new `settings-company-modal` IDs in DOM.

2. **Safe erase behavior** (`src/components/settings/DangerZoneSection.tsx` + `supabase/functions/account-cleanup/index.ts`):
   - Deletes all rows in USER_TABLES (incl. `companies`, `transactions`, `plaid_*`, `tax_payments`, `ytd_catchup_*`, etc.) ✅
   - Deletes & re-inserts `tax_settings` with `onboarding_complete=false`, `onboarding_step=1` ✅
   - Keeps auth account (no `auth.admin.deleteUser`) ✅
   - Hard-navigates to `/onboarding?reset=1` after 250ms and sets `sessionStorage["paycheckmd-start-setup"]="1"` + `localStorage[ERASE_COMPLETE_MARKER]` ✅
   - Refresh persistence: `sessionStorage` survives reload within the same tab, **and** `tax_settings.onboarding_complete=false` is now persisted server-side, so the guard at `Onboarding.tsx:126` won't bounce to `/`. ✅ — but only if the latest code is live.

3. **Is first name required?** No. `Onboarding.tsx:325` falls back to `user_metadata.first_name → email local-part → "Friend"`. UI label says "(optional)" and that matches code. A test that waits for a validation error on empty first name will hang.

4. **Test selector/wait suspicion** — High. Step 1 exposes `data-testid="onboarding-step-1"` and `data-testid="onboarding-first-name-input"`. If the test waits for literal "Step 1" text or the H1 copy, it will miss it because the heading is dynamic ("Welcome, {firstName}" etc.). The reliable wait is `page.locator('[data-testid="onboarding-step-1"]')`.

5. **Hidden/duplicate buttons in erase modal** — Yes, the Danger Zone renders **two** flows in the same panel: safe erase ("Yes, erase my data") and permanent delete ("Delete account permanently"). Both buttons live in `DangerZoneSection.tsx`. A `getByRole('button', {name: /erase|delete/i})` selector can match the wrong one or be ambiguous. Use the specific copy `"Yes, erase my data"` or add/use a testid.

6. **Partial-auth limbo?** Possible but unlikely with current code. The Onboarding guard only redirects away when `taxSettings.onboardingComplete === true`. If `tax_settings` row is missing (e.g., `handle_new_user` race), `onboardingComplete` is `null/undefined` and the user stays on onboarding. The risk window: between `account-cleanup` deleting `tax_settings` and re-inserting it, the React Query cache from before the erase may still report `onboardingComplete=true` — this is exactly what `paycheckmd-start-setup` was added to mask. If that flag isn't deployed to prod, you'll see a flicker-redirect to `/` and the test will fail.

7. **Correct expected flow** — Yes: finish onboarding with the first W-2 employer in Step 2 (company sub-step), then add additional employers from **Settings → Companies → Add Company** (modal with `settings-company-modal` / `settings-company-name-input`).

## Files/functions involved

- `src/pages/Onboarding.tsx` — step state, hydration, guard at L126, testids `onboarding-step-1`, `onboarding-first-name-input`.
- `src/components/settings/DangerZoneSection.tsx` — `reset()` flow, two-button danger panel, post-erase markers.
- `supabase/functions/account-cleanup/index.ts` — server-side reset; resets `tax_settings` row.
- `supabase/config.toml` — `[functions.account-cleanup] verify_jwt = false`.
- `src/components/settings/AddCompanyDialog.tsx` — modal with `settings-company-*` testids.
- `src/contexts/CompanyContext.tsx` — companies list used by paycheck source dropdown.

## Verdict

Most likely **production deployment mismatch + test selector fragility**, not an app bug.
- ~60%: Frontend on `app.paycheckmd.com` is older than preview (Publish not pressed since the recent fixes).
- ~25%: Test waits on text/role selectors instead of `data-testid="onboarding-step-1"` and ambiguously clicks one of the two danger-zone buttons.
- ~10%: Post-erase React Query cache race causing momentary redirect to `/` on a prod build that lacks the `paycheckmd-start-setup` bypass.
- ~5%: Genuine app bug (e.g., `account-cleanup` failing for a specific table → toast error → test stuck).

## Recommended next steps (no code yet)

1. **Re-publish frontend** to `app.paycheckmd.com` and re-run the test before changing anything else. Confirm the page source contains `data-testid="onboarding-step-1"` and `data-testid="settings-company-modal"`.
2. **Verify edge function** is live: `curl -X POST https://fiqnxprhvsadcqicczkg.supabase.co/functions/v1/account-cleanup` with a real user JWT and `{action:"erase"}`; expect 200 and a re-inserted `tax_settings` row.
3. **Switch the test to testids only**:
   - Step 1 wait → `[data-testid="onboarding-step-1"]`
   - First-name input → `[data-testid="onboarding-first-name-input"]` (and don't require a value)
   - Erase button → exact text `"Yes, erase my data"` (or add `data-testid="settings-erase-confirm"` later)
   - Settings Add Company → `[data-testid="settings-companies-add-button"]` then `[data-testid="settings-company-name-input"]`
4. **After clicking erase**, wait for `localStorage["paycheckmd-erase-complete"]` to appear before asserting navigation, then wait for URL `**/onboarding**` and the `onboarding-step-1` testid.
5. **Do not assert** that first name is required — it's optional by design.
6. If prod is up-to-date and the test still fails, capture the network call to `/functions/v1/account-cleanup` (status + body) and a screenshot at the failure point; that will distinguish app bug vs test bug.

No fixes will be applied until you approve a follow-up build task.
