/**
 * Production regression — Income Planner → "Add Planned Income" date picker.
 *
 * Reported blocker: selecting a day updated the trigger to "Sep 15, 2026" but
 * the calendar popover stayed mounted over the form, intercepting the Income
 * Source select so the form could not be completed.
 *
 * This runs against the REAL modal in a real browser (Radix portal + focus
 * behavior included) — a jsdom unit test cannot reproduce it.
 */
import { test, expect } from "../playwright-fixture";

const EMAIL = process.env.E2E_EMAIL ?? "brendantparker@gmail.com";
const PASSWORD = process.env.E2E_PASSWORD ?? "Test123!";

async function signIn(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page.locator('input[type="email"]').fill(EMAIL);
  await page.locator('input[type="password"]').fill(PASSWORD);
  await page.getByRole("button", { name: /sign in/i }).first().click();
  await page.waitForTimeout(3000);
}

test.describe("Income Planner date picker", () => {
  test("selecting a day closes the calendar and unblocks the form", async ({ page }) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width: 1280, height: 720 });
    await signIn(page);

    await page.goto("/projected-income");
    await page.getByRole("button", { name: /add planned income/i }).first().click();

    const dateTrigger = page.locator("button:has(svg.lucide-calendar)").first();
    await expect(dateTrigger).toBeVisible();
    await dateTrigger.click();

    const popover = page.getByTestId("date-field-popover");
    await expect(popover).toBeVisible();

    // Walk to September 2026 and pick the 15th.
    for (let i = 0; i < 36; i++) {
      const caption = (await popover.locator('[role="presentation"][aria-live="polite"]').first().innerText()).trim();
      if (caption.startsWith("September 2026")) break;
      await popover.locator('button[name="next-month"]').click();
      await page.waitForTimeout(80);
    }
    await popover.locator('button[name="day"]:not(.day-outside)', { hasText: /^15$/ }).first().click();

    // 4 — the selected date is shown, 5 — the calendar is gone.
    await expect(dateTrigger).toHaveText(/Sep 15, 2026/);
    await expect(page.getByTestId("date-field-popover")).toHaveCount(0);
    await expect(page.locator('[role="grid"]')).toHaveCount(0);

    // 6/7 — Income Source opens immediately, options are reachable.
    const incomeSource = page.getByRole("combobox").first();
    await incomeSource.click({ timeout: 5000 });
    await expect(page.locator('[role="option"]').first()).toBeVisible();
    await page.keyboard.press("Escape");

    // Re-selecting the same day preserves the value and closes again.
    await dateTrigger.click();
    await expect(page.getByTestId("date-field-popover")).toBeVisible();
    await page.getByTestId("date-field-popover")
      .locator('button[name="day"]:not(.day-outside)', { hasText: /^15$/ })
      .first()
      .click();
    await expect(dateTrigger).toHaveText(/Sep 15, 2026/);
    await expect(page.getByTestId("date-field-popover")).toHaveCount(0);

    // 8/9 — complete a one-time planned income and confirm exactly one stream.
    const uniqueName = `E2E DatePicker ${Date.now()}`;

    // Income Source → 1099 / contract style entry (company optional).
    await incomeSource.click();
    const source1099 = page.locator('[role="option"]').filter({ hasText: /1099|contract|business/i }).first();
    await (await source1099.count() ? source1099 : page.locator('[role="option"]').first()).click();

    // Company / income source name — free-text "other" mode.
    await page.getByTestId("paycheck-employer-trigger").click();
    await page.getByTestId("paycheck-employer-other-button").click();
    await page.getByTestId("paycheck-employer-input").fill(uniqueName);

    await page.locator('input[type="number"]').first().fill("1000");

    // Frequency → One-time.
    const freqTrigger = page.getByRole("combobox").last();
    await freqTrigger.click();
    await page.getByRole("option", { name: /one-?time/i }).click();

    await page.getByRole("button", { name: /save planned income/i }).click();

    await expect(page.getByText(uniqueName).first()).toBeVisible({ timeout: 20_000 });
    expect(await page.getByText(uniqueName).count()).toBe(1);
  });
});
