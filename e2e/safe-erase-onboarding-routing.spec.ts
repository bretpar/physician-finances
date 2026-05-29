/**
 * Regression: safe erase must keep the auth account, reset onboarding, and
 * prevent Dashboard access until onboarding is completed again.
 */
import { test, expect, type Page } from "../playwright-fixture";

const EMAIL = process.env.E2E_TEST_EMAIL ?? "brendantparker+codexw2@gmail.com";
const PASSWORD = process.env.E2E_TEST_PASSWORD ?? "Test123!";
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? "https://app.paycheckmd.com";

const abs = (path: string) => new URL(path, BASE_URL).toString();

async function loginThroughUI(page: Page): Promise<void> {
  await page.goto(abs("/login"), { waitUntil: "domcontentloaded" });
  await page.getByLabel(/email/i).fill(EMAIL);
  await page.getByLabel(/password/i).fill(PASSWORD);
  await page.getByRole("button", { name: /^(log ?in|sign ?in)$/i }).click();
  await page.waitForURL((u) => !/\/login(\b|\/)/.test(u.pathname), { timeout: 30_000 });
}

async function safeEraseViaSettings(page: Page): Promise<void> {
  await page.goto(abs("/settings"), { waitUntil: "domcontentloaded" });

  const trigger = page.locator('[data-testid="settings-delete-erase-account-button"]');
  await trigger.waitFor({ state: "visible", timeout: 20_000 });
  await trigger.scrollIntoViewIfNeeded().catch(() => {});
  await trigger.click();

  const safeOption = page.locator('[data-testid="settings-safe-erase-option"]');
  if (await safeOption.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await safeOption.click();
  }

  const safeConfirm = page.locator('[data-testid="settings-safe-erase-confirm-button"]');
  await safeConfirm.waitFor({ state: "visible", timeout: 10_000 });
  const label = (await safeConfirm.textContent().catch(() => "")) ?? "";
  if (/permanent|delete account permanently/i.test(label)) {
    throw new Error(`Refusing to click destructive button: ${label}`);
  }
  await safeConfirm.click();
  await page.waitForURL(/\/onboarding/, { timeout: 30_000 });
}

async function expectOnboarding(page: Page): Promise<void> {
  await expect(page.locator('[data-testid="onboarding-root"]')).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('[data-testid="onboarding-step-1"]')).toBeVisible({ timeout: 20_000 });
  expect(new URL(page.url()).pathname).toBe("/onboarding");
}

test.describe("safe erase onboarding routing", () => {
  test("safe erase resets onboarding and blocks dashboard until setup is completed", async ({ page }) => {
    test.setTimeout(90_000);

    await loginThroughUI(page);
    await safeEraseViaSettings(page);
    await expectOnboarding(page);

    await page.reload({ waitUntil: "domcontentloaded" });
    await expectOnboarding(page);

    await page.goto(abs("/"), { waitUntil: "domcontentloaded" });
    await page.waitForURL(/\/onboarding/, { timeout: 20_000 });
    await expectOnboarding(page);
  });
});
