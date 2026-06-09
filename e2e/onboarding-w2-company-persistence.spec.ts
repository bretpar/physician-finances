/**
 * Onboarding regression — W-2-only company setup must persist BOTH added
 * employers into the YTD catch-up step. Previously, after adding two
 * W-2 employers and continuing, the YTD step rendered "No companies yet"
 * because the in-memory companyDrafts state was lost across the
 * step transition. The fix persists companyDrafts to sessionStorage and
 * gates Continue until at least one named company exists.
 */
import { test, expect } from "../playwright-fixture";
import { ensureFreshScenarioAccount } from "./helpers/ensureFreshScenarioAccount";

const EMAIL =
  process.env.E2E_W2_COMPANY_PERSIST_EMAIL ??
  "brendantparker+w2companypersist@gmail.com";
const PASSWORD = process.env.E2E_W2_COMPANY_PERSIST_PASSWORD ?? "Test123!";

test.describe("Onboarding — W-2 company persistence into YTD step", () => {
  test("two W-2 employers persist as separate YTD cards", async ({ page }) => {
    test.setTimeout(120_000);

    await ensureFreshScenarioAccount(page, {
      email: EMAIL,
      password: PASSWORD,
      firstName: "Persist",
    });

    // Step 1 — W-2 only.
    await page.getByTestId("onboarding-first-name-input").fill("Persist");
    await page.getByTestId("onboarding-income-type-w2").click();
    await page.getByTestId("onboarding-continue-button").click();

    // Step 2 — company setup. Continue must be disabled until at least
    // one company name is entered.
    await expect(page.getByTestId("onboarding-company-entry-step")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId("onboarding-continue-button")).toBeDisabled();

    await page
      .getByTestId("onboarding-employer-name-input")
      .fill("Evergreen Hospital W2");
    await page.getByTestId("onboarding-add-employer-button").click();
    await page
      .getByTestId("onboarding-employer-name-input-1")
      .fill("Cascade Clinic W2");

    await expect(page.getByTestId("onboarding-continue-button")).toBeEnabled();
    await page.getByTestId("onboarding-continue-button").click();

    // Ask sub-step — pick YTD catch-up.
    await expect(page.getByTestId("onboarding-ytd-yes")).toBeVisible({
      timeout: 15_000,
    });
    await page.getByTestId("onboarding-ytd-yes").click();
    await page.getByTestId("onboarding-continue-button").click();

    // YTD form — both companies must render as separate cards.
    await expect(page.getByText(/No companies yet/i)).toHaveCount(0);
    await expect(page.locator("body")).toContainText("Evergreen Hospital W2");
    await expect(page.locator("body")).toContainText("Cascade Clinic W2");

    // Employer/company name must be read-only inside each YTD card —
    // there should be no editable Employer name input rendered.
    await expect(page.getByTestId("ytd-catchup-company-name")).toHaveCount(0);
    await expect(page.getByTestId("ytd-catchup-company-name-readonly")).toHaveCount(2);
  });

  test("going back to company setup preserves both employers, then they appear in YTD", async ({ page }) => {
    test.setTimeout(120_000);

    const email = "brendantparker+w2goback@gmail.com";
    const password = "Test123!";

    await ensureFreshScenarioAccount(page, {
      email,
      password,
      firstName: "GoBack",
    });

    // Step 1 — W-2 only.
    await page.getByTestId("onboarding-first-name-input").fill("GoBack");
    await page.getByTestId("onboarding-income-type-w2").click();
    await page.getByTestId("onboarding-continue-button").click();

    // Step 2 — company setup. Add two employers.
    await expect(page.getByTestId("onboarding-company-entry-step")).toBeVisible({
      timeout: 15_000,
    });

    await page
      .getByTestId("onboarding-employer-name-input")
      .fill("St. Mary's Hospital");
    await page.getByTestId("onboarding-add-employer-button").click();
    await page
      .getByTestId("onboarding-employer-name-input-1")
      .fill("Northwest Medical Group");

    await page.getByTestId("onboarding-continue-button").click();

    // Ask sub-step — go back to company setup.
    await expect(page.getByTestId("onboarding-ytd-yes")).toBeVisible({
      timeout: 15_000,
    });
    await page.getByTestId("onboarding-back-button").click();

    // Verify both employers are still present on company setup.
    await expect(page.getByTestId("onboarding-company-entry-step")).toBeVisible({
      timeout: 15_000,
    });
    await expect(
      page.getByTestId("onboarding-employer-name-input"),
    ).toHaveValue("St. Mary's Hospital");
    await expect(
      page.getByTestId("onboarding-employer-name-input-1"),
    ).toHaveValue("Northwest Medical Group");

    // Continue again through ask → YTD form.
    await page.getByTestId("onboarding-continue-button").click();
    await page.getByTestId("onboarding-ytd-yes").click();
    await page.getByTestId("onboarding-continue-button").click();

    // YTD form — both companies must render.
    await expect(page.getByText(/No companies yet/i)).toHaveCount(0);
    await expect(page.locator("body")).toContainText("St. Mary's Hospital");
    await expect(page.locator("body")).toContainText("Northwest Medical Group");
  });
});
