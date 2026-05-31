/**
 * W-2 multi-employer YTD regression — onboarding must persist a YTD
 * catch-up ledger entry for EACH employer the user adds, not just the
 * first one.
 *
 * Diagnostic that motivated this test:
 *   • W-2-only onboarding with Main Hospital W2 ($60k / $9.5k fed) and
 *     Side Clinic W2 ($12k / $1.5k fed) created both COMPANIES in
 *     Settings, but only Main Hospital's YTD entry landed in the
 *     Paychecks ledger. Tax Overview therefore under-counted W-2 income
 *     by the Side Clinic amount.
 *
 * This spec drives the real UI through onboarding, saves a YTD catch-up
 * for both employers (clicking "+ Add another employer" between them),
 * adds both companies in the company step, finishes onboarding, and then
 * asserts:
 *   • Both companies appear in Settings with their pay frequencies.
 *   • Both YTD entries appear in the Personal Income (Paychecks) ledger.
 *   • Combined W-2 income shows ~$72,000 with combined withholding.
 *
 * Account reset model: ensureFreshScenarioAccount → Delete Account in
 * Settings + signup again (no safe erase).
 */
import { test, expect, type Page } from "../playwright-fixture";
import { ensureFreshScenarioAccount } from "./helpers/ensureFreshScenarioAccount";

const EMAIL = process.env.E2E_W2_MULTI_EMAIL ?? "brendantparker+w2multi@gmail.com";
const PASSWORD = process.env.E2E_W2_MULTI_PASSWORD ?? "Test123!";
const FIRST_NAME = "Multi";

const EMP1 = {
  name: "Main Hospital W2",
  gross: "60000",
  fed: "9500",
  payFreq: "biweekly",
} as const;

const EMP2 = {
  name: "Side Clinic W2",
  gross: "12000",
  fed: "1500",
  payFreq: "monthly",
} as const;

const SPOUSE_EMP1 = {
  name: "Spouse Hospital W2",
  gross: "75000",
  fed: "10500",
} as const;

const SPOUSE_EMP2 = {
  name: "Spouse Clinic W2",
  gross: "10000",
  fed: "1500",
} as const;

async function saveYtdForEmployer(
  page: Page,
  emp: { name: string; gross: string; fed: string },
) {
  // MVP: spouse-specific W-2 attribution is deferred. All entries persist
  // as household W-2 income; no owner/person selector is expected.
  await page.getByTestId("ytd-catchup-company-name").fill(emp.name);
  await page.getByTestId("ytd-catchup-gross-income").fill(emp.gross);
  await page.getByTestId("ytd-catchup-federal-withheld").fill(emp.fed);
  await page.getByTestId("ytd-catchup-save").click();
  // Saved banner appears and the form collapses back to the "+ Add another" CTA.
  await expect(page.getByTestId("ytd-catchup-saved-banner")).toBeVisible({
    timeout: 15_000,
  });
}

test.describe("W-2 onboarding — multi-employer YTD persists per employer", () => {
  test("two W-2 employers each create their own YTD ledger entry", async ({ page }) => {
    test.setTimeout(180_000);

    await ensureFreshScenarioAccount(page, {
      email: EMAIL,
      password: PASSWORD,
      firstName: FIRST_NAME,
    });

    // Step 1 — income profile = W-2 only.
    await page.getByTestId("onboarding-first-name-input").fill(FIRST_NAME);
    await page.getByTestId("onboarding-income-type-w2").click();
    await expect(page.getByTestId("onboarding-filing-status-select")).toBeVisible();
    await page.getByTestId("onboarding-filing-status-select").click();
    await page.getByTestId("onboarding-filing-status-mfj").click();
    await page.getByTestId("onboarding-continue-button").click();

    // Step 2a — answer YTD = yes.
    await page.getByTestId("onboarding-ytd-yes").click();

    // Step 2b — save YTD #1 (Main Hospital W2).
    await expect(page.getByTestId("ytd-catchup-company-name")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId("ytd-catchup-owner-person-select")).toBeVisible();
    await saveYtdForEmployer(page, EMP1);

    // Click "+ Add another employer" and save YTD #2 (Side Clinic W2).
    await page.getByRole("button", { name: /add another employer/i }).click();
    await expect(page.getByTestId("ytd-catchup-company-name")).toBeVisible();
    await saveYtdForEmployer(page, EMP2);

    await page.getByRole("button", { name: /add another employer/i }).click();
    await expect(page.getByTestId("ytd-catchup-company-name")).toBeVisible();
    await saveYtdForEmployer(page, SPOUSE_EMP1, "spouse");

    await page.getByRole("button", { name: /add another employer/i }).click();
    await expect(page.getByTestId("ytd-catchup-company-name")).toBeVisible();
    await saveYtdForEmployer(page, SPOUSE_EMP2, "spouse");

    // Recap must show 2 saved entries before we advance.
    await expect(page.getByText(/4 entries saved/i)).toBeVisible();

    await page.getByTestId("onboarding-continue-button").click();

    // Step 2c — company entry. Both employers must be added with their
    // pay frequencies so Settings persists them.
    await expect(page.getByTestId("onboarding-company-entry-step")).toBeVisible({
      timeout: 15_000,
    });
    await page.getByTestId("onboarding-employer-name-input").fill(EMP1.name);
    const freq0 = page.getByTestId("onboarding-pay-frequency-0");
    if (await freq0.count()) {
      await freq0.click();
      await page.getByTestId(`onboarding-pay-frequency-0-option-${EMP1.payFreq}`).click();
    }

    await page.getByTestId("onboarding-add-employer-button").click();
    await page.getByTestId("onboarding-employer-name-input-1").fill(EMP2.name);
    const freq1 = page.getByTestId("onboarding-pay-frequency-1");
    if (await freq1.count()) {
      await freq1.click();
      await page.getByTestId(`onboarding-pay-frequency-1-option-${EMP2.payFreq}`).click();
    }

    // Continue through remaining onboarding steps until we leave /onboarding.
    for (let i = 0; i < 8; i++) {
      const path = new URL(page.url()).pathname;
      if (!/^\/onboarding/.test(path)) break;
      const cont = page.getByTestId("onboarding-continue-button");
      if (!(await cont.count())) break;
      await cont.click();
      await page.waitForTimeout(400);
    }
    await page.waitForURL((u) => !/^\/onboarding/.test(u.pathname), {
      timeout: 30_000,
    });

    // ── Verify: both companies persist in Settings ──────────────────────
    await page.goto("/settings");
    const body = page.locator("body");
    await expect(body).toContainText(EMP1.name, { timeout: 20_000 });
    await expect(body).toContainText(EMP2.name);

    // ── Verify: both YTD ledger entries appear in Personal Income ───────
    await page.goto("/personal-income");
    await expect(page.locator("body")).toContainText(EMP1.name, {
      timeout: 20_000,
    });
    await expect(page.locator("body")).toContainText(EMP2.name);
    await expect(page.locator("body")).toContainText(SPOUSE_EMP1.name);
    await expect(page.locator("body")).toContainText(SPOUSE_EMP2.name);
    // Combined W-2 income surfaces somewhere (formatted with commas).
    await expect(page.locator("body")).toContainText(/\$60,000/);
    await expect(page.locator("body")).toContainText(/\$12,000/);
    await expect(page.locator("body")).toContainText(/\$75,000/);
    await expect(page.locator("body")).toContainText(/\$10,000/);
    await expect(page.locator(`[data-testid="paycheck-row"][data-employer="${EMP1.name}"]`)).toHaveAttribute("data-ui-income-subtype", "w2_user");
    await expect(page.locator(`[data-testid="paycheck-row"][data-employer="${EMP2.name}"]`)).toHaveAttribute("data-ui-income-subtype", "w2_user");
    await expect(page.locator(`[data-testid="paycheck-row"][data-employer="${SPOUSE_EMP1.name}"]`)).toHaveAttribute("data-ui-income-subtype", "w2_partner");
    await expect(page.locator(`[data-testid="paycheck-row"][data-employer="${SPOUSE_EMP2.name}"]`)).toHaveAttribute("data-ui-income-subtype", "w2_partner");

    // ── Verify: Tax Overview reflects both ──────────────────────────────
    await page.goto("/taxes");
    const taxBody = (await page.locator("body").textContent()) ?? "";
    // Combined gross W-2 ~ $157k must appear somewhere on the Tax Overview.
    expect(taxBody).toMatch(/\$?157[,.]?000/);
  });
});
