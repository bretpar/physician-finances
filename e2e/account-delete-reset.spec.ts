/**
 * Account deletion reset regression.
 *
 * Verifies the supported reusable-account reset model:
 * completed account → Settings → Delete Account → signed out to /login →
 * signup with the same email → fresh onboarding.
 */
import { test, expect, type Page } from "../playwright-fixture";

const EMAIL = process.env.E2E_ACCOUNT_DELETE_EMAIL ?? "brendantparker+w2delete@gmail.com";
const PASSWORD = process.env.E2E_ACCOUNT_DELETE_PASSWORD ?? "Test123!";
const FIRST_NAME = "DeleteReset";
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? "https://app.paycheckmd.com";

function abs(path: string) {
  return new URL(path, BASE_URL).toString();
}

async function signUp(page: Page) {
  await page.goto(abs("/signup"));
  await page.getByTestId("signup-first-name").fill(FIRST_NAME);
  await page.getByTestId("signup-email").fill(EMAIL);
  await page.getByTestId("signup-password").fill(PASSWORD);
  await page.getByTestId("signup-submit").click();
  await page.waitForURL((u) => /\/onboarding(\/|$)/.test(u.pathname), { timeout: 30_000 });
}

async function loginIfPossible(page: Page): Promise<boolean> {
  await page.goto(abs("/login"));
  await page.getByTestId("login-email").fill(EMAIL);
  await page.getByTestId("login-password").fill(PASSWORD);
  await page.getByTestId("login-submit").click();
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (!/\/login(\/|$)/.test(new URL(page.url()).pathname)) return true;
    if (await page.getByText(/invalid|not found|incorrect/i).count().catch(() => 0)) return false;
    await page.waitForTimeout(250);
  }
  return false;
}

async function completeMinimalW2Onboarding(page: Page) {
  await expect(page.getByTestId("onboarding-root")).toBeVisible({ timeout: 30_000 });
  if (await page.getByTestId("onboarding-step-1").count()) {
    await page.getByTestId("onboarding-first-name-input").fill(FIRST_NAME);
    await page.getByTestId("onboarding-income-type-w2").click();
    await page.getByTestId("onboarding-continue-button").click();
  }
  if (await page.getByTestId("onboarding-ytd-no").count()) {
    await page.getByTestId("onboarding-ytd-no").click();
  }
  await expect(page.getByTestId("onboarding-company-entry-step")).toBeVisible({ timeout: 20_000 });
  await page.getByTestId("onboarding-employer-name-input").fill("Delete Reset Hospital W2");
  await page.getByTestId("onboarding-continue-button").click();
  await page.getByTestId("onboarding-continue-button").click();
  await page.waitForURL((u) => !/\/onboarding(\/|$)/.test(u.pathname), { timeout: 30_000 });
}

async function ensureCompletedAccount(page: Page) {
  if (!(await loginIfPossible(page))) await signUp(page);
  if (/\/onboarding(\/|$)/.test(new URL(page.url()).pathname)) {
    await completeMinimalW2Onboarding(page);
  }
  await page.goto(abs("/settings"));
  await expect(page.getByTestId("settings-delete-account-button")).toBeVisible({ timeout: 20_000 });
}

test("completed account can be deleted, then same email signs up into fresh onboarding", async ({ page }) => {
  test.setTimeout(120_000);

  await ensureCompletedAccount(page);
  await page.getByTestId("settings-delete-account-button").click();
  await page.getByTestId("settings-delete-account-confirm-input").fill("DELETE");
  await expect(page.getByTestId("settings-delete-account-confirm-button")).toBeEnabled();
  await page.getByTestId("settings-delete-account-confirm-button").click();

  const error = page.getByTestId("delete-error");
  await Promise.race([
    page.waitForURL((u) => /\/login(\/|$)/.test(u.pathname), { timeout: 35_000 }),
    error.waitFor({ state: "visible", timeout: 35_000 }).then(async () => {
      throw new Error(`Account deletion failed visibly: ${await error.textContent()}`);
    }),
  ]);

  await signUp(page);
  await expect(page.getByTestId("onboarding-root")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("onboarding-step-1")).toBeVisible();
});