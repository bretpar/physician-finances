/**
 * Regression: a brand-new user (onboarding_complete !== true) must never see
 * the Dashboard route before being redirected to /onboarding.
 *
 * Previously, a stale React Query cache keyed globally as ["tax_settings"]
 * could briefly satisfy the ProtectedRoutes guard with the prior user's
 * `onboardingComplete: true`, rendering Dashboard for a frame before the
 * redirect. The fix scopes the query to the current user id; this test
 * guards against regressions.
 */
import { test, expect, type Page } from "../playwright-fixture";
import { createDisposableUser } from "./helpers/seed";

/**
 * Dashboard-only DOM markers that must NEVER appear for a user whose
 * onboarding is not complete. `dashboard-summary` is rendered by
 * src/pages/Dashboard.tsx, and the "Paycheck MD" sidebar h1 is rendered by
 * AppLayout — both are gated behind the onboarding check in App.tsx.
 */
const DASHBOARD_FLASH_SELECTORS = [
  '[data-testid="dashboard-summary"]',
  'aside h1:has-text("Paycheck MD")',
  'h1:has-text("Welcome back")',
];

async function assertNoDashboardUntilOnboarding(page: Page, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    // If any dashboard-only marker is in the DOM before we reach /onboarding,
    // that's the flash regression.
    for (const sel of DASHBOARD_FLASH_SELECTORS) {
      const count = await page.locator(sel).count().catch(() => 0);
      if (count > 0) {
        const url = page.url();
        throw new Error(
          `Dashboard flash detected: selector "${sel}" appeared at ${url} ` +
            `before /onboarding for a brand-new user.`,
        );
      }
    }
    if (/\/onboarding(\b|\/|\?|#|$)/.test(page.url())) return;
    // Tight poll — we want to catch a single rendered frame.
    await page.waitForTimeout(25);
  }
  throw new Error(
    `Timed out waiting for /onboarding redirect; last URL was ${page.url()}`,
  );
}

test.describe("New user — no Dashboard flash before /onboarding", () => {
  test("fresh signup is routed to /onboarding without rendering Dashboard", async ({
    page,
  }) => {
    // Provision a brand-new user WITHOUT completing onboarding.
    const { email, password } = await createDisposableUser("noflash");

    // Drive the real login flow so AuthContext + useTaxSettings hydrate the
    // same way they do in production.
    await page.goto("/login");
    await page.getByLabel(/email/i).fill(email);
    await page.getByLabel(/password/i).fill(password);

    // Start watching for dashboard flash before we click — the navigation
    // races against the auth/settings hydration.
    const guard = assertNoDashboardUntilOnboarding(page, 20_000);
    await page.getByRole("button", { name: /^(log ?in|sign ?in)$/i }).click();
    await guard;

    // Sanity: we did land on onboarding.
    expect(page.url()).toMatch(/\/onboarding\b/);
  });

  test("navigating directly to / while signed-in-but-not-onboarded never shows Dashboard", async ({
    page,
  }) => {
    const { email, password } = await createDisposableUser("noflashroot");

    await page.goto("/login");
    await page.getByLabel(/email/i).fill(email);
    await page.getByLabel(/password/i).fill(password);
    await page.getByRole("button", { name: /^(log ?in|sign ?in)$/i }).click();
    await page.waitForURL(/\/onboarding\b/, { timeout: 20_000 });

    // Now explicitly try to hit the dashboard route.
    const guard = assertNoDashboardUntilOnboarding(page, 15_000);
    await page.goto("/");
    await guard;

    expect(page.url()).toMatch(/\/onboarding\b/);
  });
});
