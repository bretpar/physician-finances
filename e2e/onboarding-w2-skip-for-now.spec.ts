/**
 * Onboarding regression — a fresh W-2 user must be able to bypass step 2
 * with "Skip for now" without being redirected back to onboarding, and the
 * onboarding-complete state must persist across a full page refresh.
 *
 * Guards two production blockers reported historically:
 *   1. Skip for now silently no-ops and the user is trapped on
 *      "Add your employer".
 *   2. Skip appears to work but the route guard reads a different stale
 *      completion flag on reload and bounces the user back.
 */
import { test, expect } from "../playwright-fixture";
import { ensureFreshScenarioAccount } from "./helpers/ensureFreshScenarioAccount";

const EMAIL =
  process.env.E2E_W2_SKIP_EMAIL ?? "brendantparker+w2skipforward@gmail.com";
const PASSWORD = process.env.E2E_W2_SKIP_PASSWORD ?? "Test123!";

test.describe("Onboarding — W-2 Skip for now completes and persists", () => {
  test("skip advances to dashboard and survives a reload", async ({ page }) => {
    test.setTimeout(120_000);

    await ensureFreshScenarioAccount(page, {
      email: EMAIL,
      password: PASSWORD,
      firstName: "Skipper",
    });

    // Step 1 — W-2 only, continue.
    await page.getByTestId("onboarding-first-name-input").fill("Skipper");
    await page.getByTestId("onboarding-income-type-w2").click();
    await page.getByTestId("onboarding-continue-button").click();

    // Step 2 — company setup visible, no employer added, press Skip for now.
    await expect(
      page.getByTestId("onboarding-company-entry-step"),
    ).toBeVisible({ timeout: 15_000 });
    await page.getByRole("button", { name: /skip for now/i }).click();

    // Route guard should let us into the app.
    await expect(page).toHaveURL(/\/$|\/(?!onboarding)/, { timeout: 20_000 });
    await expect(page).not.toHaveURL(/\/onboarding/);

    // Reload — canonical onboarding_complete flag must be true server-side
    // so the guard does not bounce us back to /onboarding.
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page).not.toHaveURL(/\/onboarding/, { timeout: 15_000 });
  });
});
