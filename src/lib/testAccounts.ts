/**
 * Display-only heuristics for spotting throwaway/QA accounts in the admin UI.
 *
 * This is NOT an authorization signal and NOT a role. It only powers a label
 * and an optional filter so a developer can find test accounts faster; every
 * destructive action still requires manual selection + confirmation.
 */

/** Substrings that reliably indicate a seeded/QA account in this project. */
const TEST_EMAIL_PATTERNS = [
  "+codex",
  "+test",
  "+qa",
  "+lovable",
  "+e2e",
  "e2e+",
  "@paycheckmd-e2e.test",
  "@example.com",
  "@example.test",
] as const;

export function isLikelyTestAccount(email: string | null | undefined): boolean {
  if (!email) return false;
  const value = email.trim().toLowerCase();
  if (!value) return false;
  return TEST_EMAIL_PATTERNS.some((pattern) => value.includes(pattern));
}

export const TEST_ACCOUNT_PATTERNS = TEST_EMAIL_PATTERNS;
