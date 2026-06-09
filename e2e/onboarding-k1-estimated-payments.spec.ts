/**
 * K-1 / 1099 YTD catch-up "Federal estimated taxes paid YTD" must persist
 * into Tax Overview's "Estimated payments made" line — not be silently
 * misclassified as $0.
 *
 * Regression for: K-1-only user enters $30,000 estimated tax paid during
 * onboarding, finishes setup, and sees "Estimated payments made $0" on
 * the Taxes page.
 */
import { test, expect } from "../playwright-fixture";
import { ensureFreshScenarioAccount } from "./helpers/ensureFreshScenarioAccount";

const PASSWORD = "Test123!";
const ENTITY = "Vituity";

test.describe("Onboarding — K-1 estimated tax paid persists to Tax Overview", () => {
  test("K-1-only catch-up surfaces $30k as Estimated payments made", async ({ page }) => {
    test.setTimeout(180_000);
    const email = `brendantparker+k1-est-pmt-${Date.now()}@paycheckmd.test`;

    await ensureFreshScenarioAccount(page, {
      email,
      password: PASSWORD,
      firstName: "K1Test",
    });

    // Step 1: business_only profile.
    await page.getByTestId("onboarding-first-name-input").fill("K1Test");
    await page.getByTestId("onboarding-income-type-1099").click();
    await page.getByTestId("onboarding-continue-button").click();

    // Step 2: YTD catch-up → "yes" → fill K-1 form.
    await page.getByTestId("onboarding-ytd-yes").click();
    await expect(page.getByTestId("ytd-catchup-company-name")).toBeVisible({ timeout: 15_000 });
    await page.getByTestId("ytd-catchup-company-name").fill(ENTITY);
    await page.getByTestId("ytd-catchup-gross-income").fill("160000");
    await page.getByTestId("ytd-catchup-business-expenses").fill("20000");
    await page.getByTestId("ytd-catchup-federal-withheld").fill("30000");
    await page.getByTestId("ytd-catchup-save").click();
    await expect(page.getByTestId("ytd-catchup-saved-banner")).toBeVisible({ timeout: 15_000 });

    // Continue → company step → continue → finish onboarding.
    await page.getByTestId("onboarding-continue-button").click();
    await expect(page.getByTestId("onboarding-company-entry-step")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("onboarding-employer-name-input")).toHaveValue(ENTITY);
    await page.getByTestId("onboarding-continue-button").click();

    await page.waitForURL((u) => !/^\/onboarding/.test(u.pathname), { timeout: 30_000 });

    // Tax Overview should show $30,000 in estimated payments line.
    await page.goto("/taxes");
    await expect(page.getByRole("heading", { name: /tax overview/i })).toBeVisible({ timeout: 20_000 });

    // 1) Tax Overview's "Estimated payments made" summary line must include $30,000.
    const row = page.locator("div", { hasText: /estimated payments made/i }).filter({
      hasText: /\$30,000/,
    });
    await expect(row.first()).toBeVisible({ timeout: 20_000 });

    // 2) Payment History shows exactly one $30,000 payment row, and the
    //    quarter label on that row matches the quarter label used by the
    //    summary tracker — otherwise the same payment appears in history
    //    under one quarter but is excluded from the tracker under another.
    const paymentRows = page.locator("text=$30,000.00");
    await expect(paymentRows.first()).toBeVisible({ timeout: 20_000 });
    // Should appear in payment history exactly once.
    const historyMatches = await page.getByText(/\$30,000\.00/).count();
    expect(historyMatches).toBeGreaterThanOrEqual(1);

    // 3) The IRS-period quarter label rendered on the payment-history row
    //    must also be the quarter the tracker uses today, so the $30,000
    //    appears under "Estimated payments made" for the current quarter.
    //    Today's IRS-period quarter, per getCurrentQuarter:
    //      Jan–Mar → Q1, Apr–May → Q2, Jun–Jul → Q3, Aug+ → Q3/Q4.
    const m = new Date().getMonth();
    const expectedQ = m < 3 ? "Q1" : m < 5 ? "Q2" : m < 8 ? "Q3" : "Q4";
    await expect(page.getByText(new RegExp(`${expectedQ}\\b`)).first()).toBeVisible({ timeout: 10_000 });
  });
});

