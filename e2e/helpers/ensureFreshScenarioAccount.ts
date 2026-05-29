/**
 * ensureFreshScenarioAccount — reusable scenario-account state machine for E2E tests.
 *
 * The app no longer supports "safe erase". To reset a reusable scenario user,
 * we fully delete the auth account through Settings → Delete Account, then
 * sign up again with the same email/password. This guarantees a clean start.
 *
 * State machine (return values):
 *   { state: "already_onboarding" } — login succeeded and user is still in /onboarding.
 *                                     Caller should continue onboarding from current step.
 *   { state: "recreated" }          — login succeeded into a completed account with old
 *                                     data; we deleted the account and signed up again.
 *                                     Caller should complete onboarding fresh.
 *   { state: "created" }            — login failed (no such user); we signed up.
 *                                     Caller should complete onboarding fresh.
 *
 * Required scenario:
 *   { email, password, firstName? }
 *
 * Required selectors (must exist in current app):
 *   - login-email, login-password, login-submit
 *   - settings-delete-account-button
 *   - settings-delete-account-confirm-input
 *   - settings-delete-account-confirm-button
 *   - signup-email, signup-password, signup-first-name, signup-submit
 */
import { expect, type Page } from "../../playwright-fixture";

export interface ScenarioAccount {
  email: string;
  password: string;
  firstName?: string;
}

export type EnsureResult =
  | { state: "already_onboarding" }
  | { state: "recreated" }
  | { state: "created" };

function abs(baseUrl: string, p: string): string {
  return new URL(p, baseUrl).toString();
}

async function tryLogin(
  page: Page,
  baseUrl: string,
  scenario: ScenarioAccount,
): Promise<"onboarding" | "completed" | "failed"> {
  await page.goto(abs(baseUrl, "/login"));
  await page.getByTestId("login-email").fill(scenario.email);
  await page.getByTestId("login-password").fill(scenario.password);
  await page.getByTestId("login-submit").click();

  // Wait for either: navigation off /login (success), or a visible error.
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const path = new URL(page.url()).pathname;
    if (!/^\/login(\/|$)/.test(path)) {
      // Successful navigation. Onboarding or completed-app?
      if (/^\/onboarding(\/|$)/.test(path)) return "onboarding";
      // Wait a moment for any post-login redirect to onboarding to settle.
      await page.waitForTimeout(500);
      const settled = new URL(page.url()).pathname;
      return /^\/onboarding(\/|$)/.test(settled) ? "onboarding" : "completed";
    }
    // Look for invalid-creds error toast/text.
    const err = page.getByText(
      /invalid (login )?credentials|user not found|email.+password.+incorrect/i,
    );
    if (await err.count().catch(() => 0)) return "failed";
    await page.waitForTimeout(250);
  }
  return "failed";
}

async function deleteAccountFromSettings(page: Page, baseUrl: string): Promise<void> {
  await page.goto(abs(baseUrl, "/settings"));
  const deleteBtn = page.getByTestId("settings-delete-account-button");
  await expect(deleteBtn, "Delete Account button missing in Settings").toBeVisible({
    timeout: 15_000,
  });
  await deleteBtn.click();

  const confirmInput = page.getByTestId("settings-delete-account-confirm-input");
  await expect(confirmInput).toBeVisible({ timeout: 10_000 });
  await confirmInput.fill("DELETE");

  await page.getByTestId("settings-delete-account-confirm-button").click();

  // Expect sign-out → redirect to /login (or auth-gated route).
  await page.waitForURL(
    (u) => /^\/(login|auth|signup)(\/|$)/.test(u.pathname),
    { timeout: 30_000 },
  );
}

async function signUp(
  page: Page,
  baseUrl: string,
  scenario: ScenarioAccount,
): Promise<void> {
  await page.goto(abs(baseUrl, "/signup"));
  if (scenario.firstName) {
    const fn = page.getByTestId("signup-first-name");
    if (await fn.count()) await fn.fill(scenario.firstName);
  }
  await page.getByTestId("signup-email").fill(scenario.email);
  await page.getByTestId("signup-password").fill(scenario.password);
  await page.getByTestId("signup-submit").click();

  // Brand-new signups land in /onboarding.
  await page.waitForURL((u) => /^\/onboarding(\/|$)/.test(u.pathname), {
    timeout: 30_000,
  });
}

export async function ensureFreshScenarioAccount(
  page: Page,
  scenario: ScenarioAccount,
  opts: { baseUrl?: string } = {},
): Promise<EnsureResult> {
  const baseUrl =
    opts.baseUrl ??
    process.env.PLAYWRIGHT_BASE_URL ??
    process.env.BASE_URL ??
    "https://app.paycheckmd.com";

  const loginOutcome = await tryLogin(page, baseUrl, scenario);

  if (loginOutcome === "onboarding") {
    return { state: "already_onboarding" };
  }

  if (loginOutcome === "completed") {
    await deleteAccountFromSettings(page, baseUrl);
    await signUp(page, baseUrl, scenario);
    return { state: "recreated" };
  }

  // loginOutcome === "failed" — account does not exist (or creds wrong).
  await signUp(page, baseUrl, scenario);
  return { state: "created" };
}
