/**
 * Regression: safe erase must clear the W-2/tax ledger sources, preserve login,
 * and force onboarding on refresh/direct navigation.
 */
import { test, expect, type Page } from "../playwright-fixture";

const EMAIL = process.env.E2E_TEST_EMAIL ?? "brendantparker+codexw2@gmail.com";
const PASSWORD = process.env.E2E_TEST_PASSWORD ?? "Test123!";
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? "https://app.paycheckmd.com";

const abs = (path: string) => new URL(path, BASE_URL).toString();

async function login(page: Page) {
  await page.goto(abs("/login"), { waitUntil: "domcontentloaded" });
  await page.getByLabel(/email/i).fill(EMAIL);
  await page.getByLabel(/password/i).fill(PASSWORD);
  await page.getByRole("button", { name: /^(log ?in|sign ?in)$/i }).click();
  await page.waitForURL((url) => !/\/login/.test(url.pathname), { timeout: 30_000 });
}

async function runSafeErase(page: Page) {
  await page.goto(abs("/settings"), { waitUntil: "domcontentloaded" });
  const trigger = page.locator('[data-testid="settings-delete-erase-account-button"]');
  await trigger.waitFor({ state: "visible", timeout: 20_000 });
  await trigger.click();

  const safeOption = page.locator('[data-testid="settings-safe-erase-option"]');
  if (await safeOption.isVisible({ timeout: 3_000 }).catch(() => false)) await safeOption.click();

  const confirm = page.locator('[data-testid="settings-safe-erase-confirm-button"]');
  await confirm.waitFor({ state: "visible", timeout: 10_000 });
  const label = (await confirm.textContent().catch(() => "")) ?? "";
  if (/delete account permanently|permanent delete/i.test(label)) {
    throw new Error(`Refusing to click destructive account-delete button: ${label}`);
  }
  await confirm.click();
  await page.waitForURL(/\/onboarding/, { timeout: 30_000 });
}

async function expectOnboarding(page: Page) {
  await expect(page.locator('[data-testid="onboarding-root"]')).toBeVisible({ timeout: 20_000 });
  expect(new URL(page.url()).pathname).toBe("/onboarding");
}

async function expectOldTotalsGone(page: Page) {
  await expect(page.locator("body")).not.toContainText("$132,000");
  await expect(page.locator("body")).not.toContainText("132,000");
  await expect(page.locator("body")).not.toContainText("$20,500");
  await expect(page.locator("body")).not.toContainText("20,500");
  await expect(page.locator("body")).not.toContainText("Main Hospital W2");
  await expect(page.locator("body")).not.toContainText("Side Clinic W2");
}

test("safe erase clears financial data and forces onboarding", async ({ page }) => {
  test.setTimeout(120_000);

  await login(page);
  await page.goto(abs("/"), { waitUntil: "domcontentloaded" });
  const initialBody = (await page.locator("body").textContent().catch(() => "")) ?? "";
  test.info().annotations.push({
    type: "initial-dashboard-state",
    description: /W-2 TOTAL|WITHHOLDING PROGRESS|Total Annual Income/i.test(initialBody)
      ? "Dashboard showed financial data before erase."
      : "No pre-existing dashboard totals were visible before erase.",
  });

  await runSafeErase(page);
  await expectOnboarding(page);
  await expectOldTotalsGone(page);

  await page.reload({ waitUntil: "domcontentloaded" });
  await expectOnboarding(page);
  await expectOldTotalsGone(page);

  for (const path of ["/", "/taxes", "/personal-income", "/settings"]) {
    await page.goto(abs(path), { waitUntil: "domcontentloaded" });
    await page.waitForURL(/\/onboarding/, { timeout: 20_000 });
    await expectOnboarding(page);
    await expectOldTotalsGone(page);
  }

  // The auth account must still exist: clear the browser session and log in again.
  await page.evaluate(() => localStorage.clear());
  await login(page);
  await expectOnboarding(page);
});