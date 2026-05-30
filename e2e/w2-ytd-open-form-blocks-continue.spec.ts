/**
 * W-2 YTD onboarding — open-but-unsaved YTD form MUST block Continue.
 *
 * Production diagnostic that motivated this spec:
 *   • Fresh signup → W-2 only → saved Main Hospital W2 YTD.
 *   • Clicked "+ Add another employer" — second YTD form opened.
 *   • Did NOT click Save catch-up for Side Clinic.
 *   • Clicked Continue, then finished onboarding.
 *   • Result: Dashboard showed only Main Hospital ($60k) — Side Clinic's
 *     YTD save handler was never invoked (no BEGIN_YTD_SAVE / END_YTD_SAVE
 *     breadcrumb in the console for "Side Clinic W2").
 *
 * Fix invariant this spec locks in:
 *   • While the YTD catch-up form is open at the YTD substep, clicking
 *     Continue must surface a visible error and NOT advance.
 *   • The user must either click Save catch-up (which emits BEGIN_YTD_SAVE
 *     / END_YTD_SAVE for that employer) or explicitly Cancel the open form.
 *   • Only after Side Clinic's save completes can onboarding continue.
 *   • Paychecks must then list both employers.
 */
import { test, expect, type ConsoleMessage } from "../playwright-fixture";
import { ensureFreshScenarioAccount } from "./helpers/ensureFreshScenarioAccount";

const EMAIL = process.env.E2E_W2_OPEN_FORM_EMAIL ?? "brendantparker+w2openform@gmail.com";
const PASSWORD = process.env.E2E_W2_OPEN_FORM_PASSWORD ?? "Test123!";
const FIRST_NAME = "OpenForm";

const EMP1 = { name: "Main Hospital W2", gross: "60000", fed: "9500" } as const;
const EMP2 = { name: "Side Clinic W2", gross: "12000", fed: "1500" } as const;

test.describe("W-2 onboarding — open YTD form blocks Continue", () => {
  test("Continue is blocked while the 2nd YTD form is open, save unblocks it", async ({ page }) => {
    test.setTimeout(180_000);

    // Capture BEGIN_YTD_SAVE / END_YTD_SAVE breadcrumbs so we can assert
    // the second employer's save handler actually fires.
    const ytdLogs: string[] = [];
    page.on("console", (msg: ConsoleMessage) => {
      const text = msg.text();
      if (text.includes("BEGIN_YTD_SAVE") || text.includes("END_YTD_SAVE")) {
        ytdLogs.push(text);
      }
    });

    await ensureFreshScenarioAccount(page, {
      email: EMAIL,
      password: PASSWORD,
      firstName: FIRST_NAME,
    });

    // Step 1 — income profile = W-2 only.
    await page.getByTestId("onboarding-first-name-input").fill(FIRST_NAME);
    await page.getByTestId("onboarding-income-type-w2").click();
    await page.getByTestId("onboarding-continue-button").click();

    // Step 2a — answer YTD = yes.
    await page.getByTestId("onboarding-ytd-yes").click();

    // Step 2b — save YTD #1 (Main Hospital W2).
    await expect(page.getByTestId("ytd-catchup-company-name")).toBeVisible({ timeout: 15_000 });
    await page.getByTestId("ytd-catchup-company-name").fill(EMP1.name);
    await page.getByTestId("ytd-catchup-gross-income").fill(EMP1.gross);
    await page.getByTestId("ytd-catchup-federal-withheld").fill(EMP1.fed);
    await page.getByTestId("ytd-catchup-save").click();
    await expect(page.getByTestId("ytd-catchup-saved-banner")).toBeVisible({ timeout: 15_000 });

    // Click "+ Add another employer" → form re-opens for Side Clinic, but
    // we intentionally DO NOT click Save.
    await page.getByRole("button", { name: /add another employer/i }).click();
    await expect(page.getByTestId("ytd-catchup-company-name")).toBeVisible();
    await page.getByTestId("ytd-catchup-company-name").fill(EMP2.name);
    await page.getByTestId("ytd-catchup-gross-income").fill(EMP2.gross);
    await page.getByTestId("ytd-catchup-federal-withheld").fill(EMP2.fed);

    // Try to Continue with the second form still open + unsaved.
    await page.getByTestId("onboarding-continue-button").click();

    // The guard must surface a visible toast/error AND keep us on the YTD
    // substep with the form still open. The toast text comes from
    // continueStep: "Save the current entry, or cancel it, before continuing."
    await expect(page.getByText(/save the current entry.*before continuing/i))
      .toBeVisible({ timeout: 8_000 });
    // The YTD save input is still present → we did NOT advance to the
    // company substep.
    await expect(page.getByTestId("ytd-catchup-company-name")).toBeVisible();
    await expect(page.getByTestId("onboarding-company-entry-step")).toHaveCount(0);

    // No END_YTD_SAVE for Side Clinic yet — confirm we did not silently
    // run the save handler behind the user's back.
    expect(ytdLogs.some((l) => l.includes("END_YTD_SAVE Side Clinic W2 ok"))).toBe(false);

    // Now actually save Side Clinic — this MUST emit BEGIN/END_YTD_SAVE.
    await page.getByTestId("ytd-catchup-save").click();
    await expect(page.getByTestId("ytd-catchup-saved-banner")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/2 entries saved/i)).toBeVisible();

    expect(ytdLogs.some((l) => l.includes("BEGIN_YTD_SAVE Side Clinic W2"))).toBe(true);
    expect(ytdLogs.some((l) => l.includes("END_YTD_SAVE Side Clinic W2 ok"))).toBe(true);

    // With both YTD entries saved, Continue should advance to company step.
    await page.getByTestId("onboarding-continue-button").click();
    await expect(page.getByTestId("onboarding-company-entry-step")).toBeVisible({ timeout: 15_000 });

    // Fill both employers in the company step (names match YTD entries so
    // the backfill links company_id → catch-up row).
    await page.getByTestId("onboarding-employer-name-input").fill(EMP1.name);
    await page.getByTestId("onboarding-add-employer-button").click();
    await page.getByTestId("onboarding-employer-name-input-1").fill(EMP2.name);

    // Walk through remaining onboarding screens until we leave /onboarding.
    for (let i = 0; i < 8; i++) {
      const path = new URL(page.url()).pathname;
      if (!/^\/onboarding/.test(path)) break;
      const cont = page.getByTestId("onboarding-continue-button");
      if (!(await cont.count())) break;
      await cont.click();
      await page.waitForTimeout(400);
    }
    await page.waitForURL((u) => !/^\/onboarding/.test(u.pathname), { timeout: 30_000 });

    // Both YTD ledger entries must appear in Personal Income (Paychecks).
    await page.goto("/personal-income");
    await expect(page.locator("body")).toContainText(EMP1.name, { timeout: 20_000 });
    await expect(page.locator("body")).toContainText(EMP2.name);
  });
});
