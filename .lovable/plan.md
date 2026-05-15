# Simplify Signup Password Acceptance

## Problem

The final onboarding signup step still rejects passwords that the authentication system considers weak, common, or previously leaked. Users see messages like “Password is known to be weak and easy to guess,” even though the app’s visible requirement has already been simplified.

## Goal

Let users create an account without password complexity rules or weak/common-password rejection. Keep the signup flow unchanged.

## Plan

1. **Disable weak/common-password blocking in Lovable Cloud auth settings**
   - Turn off the leaked/common password protection setting so passwords are not rejected for being simple or common.

2. **Remove app-side password length rejection from account creation**
   - In the final “Save your plan” step, stop blocking signup with “Password must be at least 8 characters.”
   - Keep the password field and show/hide toggle.
   - Remove the “Use at least 8 characters.” helper text because there should be no visible requirement.

3. **Make reset-password behavior consistent**
   - Remove the app-side minimum-length check on the reset-password page too.
   - Keep only the confirm-password match check.

4. **Keep the rest of the flow untouched**
   - No changes to income steps, estimate logic, routing, onboarding order, or account persistence.

## Files/settings affected

- Lovable Cloud authentication setting: disable weak/common-password protection.
- `src/pages/Estimate.tsx`
- `src/pages/ResetPassword.tsx`
