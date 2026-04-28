Plan to update the onboarding and login flow:

1. Make onboarding resumable after account creation
   - When a new user enters first name, email, and password on onboarding step 1, create the account immediately and save their first name with `onboardingComplete: false`.
   - After that, each Continue action will save the current onboarding choices to the existing `tax_settings` row before advancing.
   - If the user signs out, loses the session, or gets redirected later, signing back in will route them back to `/onboarding` because their onboarding is incomplete.
   - If the user never successfully creates the account on step 1, there is no saved onboarding state, so they start fresh as requested.

2. Resume at the step they stopped on
   - Add one small additive database column to `tax_settings`, e.g. `onboarding_step integer`, to persist the furthest/current onboarding step server-side.
   - This is needed because the current step is only stored in `sessionStorage`, which is lost across devices, browsers, and many “kicked out” scenarios.
   - Onboarding will initialize from the saved step for signed-in users, falling back to step 1 for users who have not created an account yet.
   - Back and Continue will update the saved step so the user returns to the same place they left off.

3. Add/strengthen Back button behavior
   - Keep the existing Back button on steps 2–6, but make it persist the new step for signed-in users.
   - Add a safe Back option on the initial onboarding screen to return to login/sign-in instead of trapping the user on signup.

4. Detect already-created emails before allowing Continue
   - Add a backend function for the signup attempt that can safely check whether an email is already registered without exposing user data to the browser.
   - On step 1, if the email already exists, stop the flow and show a clear message such as: “An account already exists for this email. Please log in or reset your password.”
   - If the email is new, proceed with account creation as normal.

5. Add forgot-password from the initial screen
   - Add a “Forgot password?” option on the initial login screen.
   - The user can enter their email and request a reset link.
   - Use the existing authentication email system to send the reset link.

6. Add the required reset-password page
   - Add a public `/reset-password` route.
   - The reset page will read the recovery session from the link, show a new-password form, and call the auth update flow to set the new password.
   - After success, send the user to login or into the app depending on session state.

Technical details

- Files likely to change:
  - `src/pages/Onboarding.tsx`
  - `src/pages/Login.tsx`
  - `src/App.tsx`
  - `src/hooks/useTaxSettings.ts`
  - new page: `src/pages/ResetPassword.tsx`
  - new backend function for safe signup/email-exists handling
  - additive migration for `tax_settings.onboarding_step`

- Backend changes will be additive only:
  - Add `onboarding_step` to `tax_settings`; no existing table rewrites or destructive migrations.
  - Add a backend function to handle signup duplicate-email checks safely.

- Route behavior after implementation:
```text
/signup or /onboarding
  step 1: create account from email/password
  step 2-6: save progress and current step

/login
  successful login
    if onboarding incomplete -> /onboarding at saved step
    if onboarding complete -> dashboard

/reset-password
  user opens email link -> sets new password -> continues safely
```

I’ll implement this after approval.