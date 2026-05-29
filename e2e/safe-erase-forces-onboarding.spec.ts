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

async function safeErase(page: Page) {
  await page.goto(abs("/settings"), { waitUntil: "domcontentloaded" });
  await page.locator('[data-testid="settings-delete-erase-account-button"]').click({ timeout: 20_000 });
  const safeOption = page.locator('[data-testid="settings-safe-erase-option"]');
  if (await safeOption.isVisible({ timeout: 3_000 }).catch(() => false)) await safeOption.click();
  const confirm = page.locator('[data-testid="settings-safe-erase-confirm-button"]');
  await confirm.waitFor({ state: "visible", timeout: 10_000 });
  await confirm.click();
  await page.waitForURL(/\/onboarding/, { timeout: 30_000 });
}

async function expectOnboarding(page: Page) {
  await expect(page.locator('[data-testid="onboarding-root"]')).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('[data-testid="onboarding-step-1"]')).toBeVisible({ timeout: 20_000 });
  expect(new URL(page.url()).pathname).toBe("/onboarding");
}

test("safe erase forces onboarding across refresh and direct dashboard navigation", async ({ page }) => {
  test.setTimeout(90_000);
  await login(page);
  await safeErase(page);
  await expectOnboarding(page);
  await page.reload({ waitUntil: "domcontentloaded" });
  await expectOnboarding(page);
  await page.goto(abs("/"), { waitUntil: "domcontentloaded" });
  await page.waitForURL(/\/onboarding/, { timeout: 20_000 });
  await expectOnboarding(page);
});