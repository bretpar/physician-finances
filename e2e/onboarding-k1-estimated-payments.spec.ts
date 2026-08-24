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
import { getCurrentQuarter } from "../src/lib/quarters";
import { QA_PASSWORD } from "./helpers/qaPassword";

const PASSWORD = QA_PASSWORD;
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

    // Deterministic synchronization guard: the quarterly tracker renders only
    // after its quarter window and totals are resolved, and it publishes those
    // values as data attributes. Waiting on this element (instead of racing
    // formatted text while queries stream in) removes all loading-timing and
    // count-up-animation dependence from the assertions below.
    const tracker = page.getByTestId("quarterly-tracker").first();
    await expect(tracker).toBeVisible({ timeout: 30_000 });
    await expect
      .poll(async () => Number(await tracker.getAttribute("data-quarter-payments")), {
        timeout: 30_000,
        intervals: [250, 500, 1_000],
      })
      .toBe(30_000);

    // 1) Tax Overview's "Estimated payments made" summary line must include $30,000.
    const row = page.locator("div", { hasText: /estimated payments made/i }).filter({
      hasText: /\$30,000/,
    });
    await expect(row.first()).toBeVisible({ timeout: 20_000 });

    // 2) Payment History shows at least one $30,000 payment row.
    await expect(page.getByText(/\$30,000\.00/).first()).toBeVisible({ timeout: 20_000 });
    const historyMatches = await page.getByText(/\$30,000\.00/).count();
    expect(historyMatches).toBeGreaterThanOrEqual(1);

    // 3) The quarter the tracker credits the payment to must be today's
    //    IRS-period quarter. Derived from the app's canonical helper rather
    //    than duplicated month math, and read from the tracker's own attribute
    //    so it cannot pass/fail on render order.
    const expectedQ = getCurrentQuarter(new Date()).label;
    await expect(tracker).toHaveAttribute("data-quarter", expectedQ);
  });
});

