/**
 * W-2 YTD catch-up onboarding must finish from Step 3.
 *
 * Locks the production regression where a saved W-2 catch-up user reached
 * “Choose your plan”, clicked “Continue with Premium”, and stayed on Step 3
 * with onboarding_complete still false.
 */
import { test, expect, type Page } from "../playwright-fixture";
import { ensureFreshScenarioAccount } from "./helpers/ensureFreshScenarioAccount";

const PASSWORD = "Test123!";
const EMPLOYER = "Evergreen Medical Center";

async function completeW2CatchupToPremium(page: Page, email: string, incomeTypeTestId: string) {
  await ensureFreshScenarioAccount(page, {
    email,
    password: PASSWORD,
    firstName: "Catchup",
  });

  await page.getByTestId("onboarding-first-name-input").fill("Catchup");
  await page.getByTestId(incomeTypeTestId).click();
  await page.getByTestId("onboarding-continue-button").click();

  await page.getByTestId("onboarding-ytd-yes").click();
  await expect(page.getByTestId("ytd-catchup-company-name")).toBeVisible({ timeout: 15_000 });
  await page.getByTestId("ytd-catchup-company-name").fill(EMPLOYER);
  await page.getByTestId("ytd-catchup-gross-income").fill("200000");
  await page.getByTestId("ytd-catchup-federal-withheld").fill("38000");
  await page.getByTestId("ytd-catchup-save").click();
  await expect(page.getByTestId("ytd-catchup-saved-banner")).toBeVisible({ timeout: 15_000 });

  await page.getByTestId("onboarding-continue-button").click();
  await expect(page.getByTestId("onboarding-company-entry-step")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("onboarding-employer-name-input")).toHaveValue(EMPLOYER);
  await page.getByTestId("onboarding-continue-button").click();

  await expect(page.getByRole("heading", { name: /choose your plan/i })).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: /continue with premium/i }).click();
  await page.waitForURL((u) => !/^\/onboarding/.test(u.pathname), { timeout: 30_000 });
  await expect(page.locator("body")).toContainText(/dashboard|income/i, { timeout: 20_000 });

  await page.reload();
  await page.waitForURL((u) => !/^\/onboarding/.test(u.pathname), { timeout: 30_000 });

  await page.goto("/personal-income");
  await expect(page.locator("body")).toContainText(EMPLOYER, { timeout: 20_000 });
  await expect(page.locator("body")).toContainText(/\$200,000/);

  await page.goto("/settings");
  await expect(page.locator("body")).toContainText(EMPLOYER, { timeout: 20_000 });
}

test.describe("Onboarding — W-2 catch-up Step 3 completion", () => {
  test("W-2-only catch-up continues with Premium and stays completed", async ({ page }) => {
    test.setTimeout(180_000);
    await completeW2CatchupToPremium(
      page,
      `brendantparker+w2-catchup-premium-${Date.now()}@paycheckmd.test`,
      "onboarding-income-type-w2",
    );
  });

  test("W-2 plus investments-style setup does not enable 1099/K-1 by default", async ({ page }) => {
    test.setTimeout(180_000);
    await completeW2CatchupToPremium(
      page,
      `brendantparker+w2-invest-catchup-premium-${Date.now()}@paycheckmd.test`,
      "onboarding-income-type-w2-1099",
    );

    await page.goto("/");
    await expect(page.getByRole("link", { name: /business activity/i })).toHaveCount(0);
  });
});