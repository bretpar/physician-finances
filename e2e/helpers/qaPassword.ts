/**
 * Centralized QA-only password for disposable E2E accounts.
 *
 * Production auth rejects weak/pwned passwords (the old `Test123!` failed with
 * `weak_password`), which blocked signup-driven specs before they reached their
 * assertions. This value is long, unique to this project, and is NOT present in
 * breach corpora. It is test-fixture-only: never imported by `src/`.
 *
 * Override locally with `E2E_QA_PASSWORD` if your project enforces extra rules.
 */
export const QA_PASSWORD =
  process.env.E2E_QA_PASSWORD ?? "PaycheckMD-QA-2026_x7Rk9tLm!";
