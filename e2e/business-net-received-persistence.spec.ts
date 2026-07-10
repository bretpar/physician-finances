/**
 * Business income — Net Received precedence E2E.
 *
 * Regression coverage for the bug where a manually saved Net Received on a
 * business income transaction was overwritten by the linked Plaid amount
 * (or lost entirely) after refresh. The precedence rules live in
 * `src/lib/netReceivedPrecedence.ts` and are unit-tested there; this spec
 * exercises them end-to-end through the UI:
 *
 *   1) Create a business income transaction (gross $8,130).
 *   2) Open Edit Income modal, set Net Received to $7,330 (differs from
 *      gross so it can't be mistaken for a planner placeholder), save.
 *   3) Reopen edit → assert Net Received input still shows 7330.
 *   4) Full page reload → open transaction detail → assert "$7,330" for
 *      Net Received.
 *   5) Reopen edit modal again → assert Net Received input still shows 7330.
 *
 * No tax math, save logic, or backend behavior is changed by this test —
 * it only verifies that the user's saved override survives round-trips.
 */
import { test, expect, type Page } from "../playwright-fixture";
import { provisionDisposableUser, type DisposableUser } from "./helpers/seed";

const GROSS = "8130";
const NET_RECEIVED = "7330";
const INCOME_NAME = "E2E Net Received Persistence";

async function loginAs(page: Page, user: DisposableUser) {
  await page.goto("/login");
  await page.getByLabel(/email/i).fill(user.email);
  await page.getByLabel(/password/i).fill(user.password);
  await page.getByRole("button", { name: /^(log ?in|sign ?in)$/i }).click();
  await page.waitForURL((u) => !/\/(login|onboarding)/.test(u.pathname), {
    timeout: 20_000,
  });
}

async function openAddIncomeAndFill(page: Page) {
  await page.getByTestId("ba-add-income").click();
  await page.getByTestId("ba-income-name").fill(INCOME_NAME);
  await page.getByTestId("ba-income-gross").fill(GROSS);

  // Select the seeded business company so the row is scoped to a real entity.
  // Radix Select trigger — combobox role. The seed helper always creates
  // "E2E Locums Group" as the only business company.
  const companyTrigger = page
    .getByRole("combobox")
    .filter({ hasText: /select company|unassigned|locums/i })
    .first();
  if (await companyTrigger.count()) {
    await companyTrigger.click();
    const option = page.getByRole("option", { name: /E2E Locums Group/i }).first();
    if (await option.count()) await option.click();
    else await page.keyboard.press("Escape");
  }
}

async function openAdvancedAndFillNet(page: Page, value: string) {
  const toggle = page.getByTestId("ba-income-advanced-toggle");
  await toggle.click();
  const netInput = page.getByTestId("ba-income-net-received");
  await expect(netInput).toBeVisible({ timeout: 5_000 });
  await netInput.fill(value);
}

async function openEditByVendor(page: Page, vendor: string) {
  // Row tap opens the transaction detail sheet; the sheet's Edit CTA routes
  // to the Edit Income modal.
  await page.getByText(vendor, { exact: false }).first().click({ timeout: 10_000 });
  await page.getByTestId("tx-detail-edit").click({ timeout: 10_000 });
  // Modal open → advanced section may have collapsed; ensure Net Received
  // is visible before assertions.
  const netInput = page.getByTestId("ba-income-net-received");
  if (!(await netInput.isVisible().catch(() => false))) {
    await page.getByTestId("ba-income-advanced-toggle").click();
  }
  await expect(netInput).toBeVisible({ timeout: 5_000 });
}

test.describe("Business income — saved Net Received survives refresh", () => {
  let user: DisposableUser;

  test.beforeAll(async () => {
    user = await provisionDisposableUser("net-received");
  });

  test("save Net Received in Edit Income → reload → precedence preserved", async ({ page }) => {
    await loginAs(page, user);
    await page.goto("/business-activity");
    await expect(page.getByRole("heading", { name: /business activity/i })).toBeVisible({
      timeout: 20_000,
    });

    // 1) Create the transaction (Add flow — Net Received starts empty).
    await openAddIncomeAndFill(page);
    await page.getByTestId("ba-income-save").click();
    await expect(page.getByTestId("ba-income-save")).toBeHidden({ timeout: 15_000 });
    await expect(page.getByText(INCOME_NAME, { exact: false }).first()).toBeVisible({
      timeout: 15_000,
    });

    // 2) Reopen edit → set Net Received to a distinct value → save.
    await openEditByVendor(page, INCOME_NAME);
    await openAdvancedAndFillNet(page, NET_RECEIVED);
    await page.getByTestId("ba-income-save").click();
    await expect(page.getByTestId("ba-income-save")).toBeHidden({ timeout: 15_000 });

    // 3) Immediately reopen edit → value must persist without a page reload.
    await openEditByVendor(page, INCOME_NAME);
    await expect(page.getByTestId("ba-income-net-received")).toHaveValue(NET_RECEIVED);
    // Close the modal so reload gives a clean state.
    await page.getByRole("button", { name: /^cancel$/i }).first().click();

    // 4) Full reload → detail sheet must reflect the saved Net Received,
    //    beating gross and any imputed value from downstream fallbacks.
    await page.reload();
    await expect(page.getByRole("heading", { name: /business activity/i })).toBeVisible({
      timeout: 20_000,
    });
    await page.getByText(INCOME_NAME, { exact: false }).first().click({ timeout: 10_000 });
    // Detail sheet shows "Net received  $7,330.00" — assert both the label
    // and the currency-formatted value are present in the open sheet.
    const detail = page.getByRole("dialog").or(page.locator("[role='dialog']"));
    await expect(detail.getByText(/net received/i).first()).toBeVisible({ timeout: 10_000 });
    await expect(detail.getByText(/\$7,330(?:\.00)?/).first()).toBeVisible();

    // 5) Reopen edit from the detail sheet → input still holds the saved
    //    value (guards against the edit-hydration precedence regression).
    await page.getByTestId("tx-detail-edit").click({ timeout: 10_000 });
    const netInput = page.getByTestId("ba-income-net-received");
    if (!(await netInput.isVisible().catch(() => false))) {
      await page.getByTestId("ba-income-advanced-toggle").click();
    }
    await expect(netInput).toHaveValue(NET_RECEIVED);
  });
});
