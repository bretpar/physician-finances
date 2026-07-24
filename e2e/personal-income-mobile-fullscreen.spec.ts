/**
 * Mobile viewport regression for the Personal Income "Edit Income Entry" modal.
 *
 * Guards three layout contracts introduced by the mobile modal refactor:
 *
 *   1) At widths 320px, 375px, 390px, and 430px, the modal renders full-screen
 *      — its DialogContent fills the viewport width and height (no gutter,
 *      no card offset, no rounded corners).
 *   2) The document never overflows horizontally while the modal is open.
 *   3) When Edit is opened from the read-only detail drawer, the drawer is
 *      dismissed first so it is not visible alongside the modal (no nested
 *      panels).
 *
 * The test only inspects layout — it does not exercise tax math, save, or
 * business logic.
 */
import { test, expect, type Page, type Locator } from "../playwright-fixture";
import { provisionDisposableUser, type DisposableUser } from "./helpers/seed";

const WIDTHS = [320, 375, 390, 430] as const;
const HEIGHT = 780;

async function loginAs(page: Page, user: DisposableUser) {
  await page.goto("/login");
  await page.getByLabel(/email/i).fill(user.email);
  await page.getByLabel(/password/i).fill(user.password);
  await page.getByRole("button", { name: /^(log ?in|sign ?in)$/i }).click();
  await page.waitForURL((u) => !/\/(login|onboarding)/.test(u.pathname), {
    timeout: 20_000,
  });
}

async function box(locator: Locator) {
  const b = await locator.boundingBox();
  if (!b) throw new Error("Element has no bounding box");
  return b;
}

async function seedOnePaycheck(page: Page) {
  await page.goto("/personal-income", { waitUntil: "domcontentloaded" });
  const addBtn = page.getByTestId("add-paycheck-button").first();
  await expect(addBtn).toBeVisible({ timeout: 15_000 });
  await addBtn.click();

  const modal = page.getByTestId("paycheck-form-modal");
  await expect(modal).toBeVisible({ timeout: 10_000 });
  await modal
    .getByTestId("paycheck-title-input")
    .fill(`Mobile Modal Test ${Date.now()}`);
  await modal.getByTestId("paycheck-gross-input").fill("5000");
  await modal.getByTestId("paycheck-save-button").click();
  await expect(modal).toBeHidden({ timeout: 15_000 });
  await expect(page.getByTestId("paycheck-row").first()).toBeVisible({
    timeout: 15_000,
  });
}

test.describe("Personal Income modal — mobile full-screen layout", () => {
  let user: DisposableUser;

  test.beforeAll(async () => {
    user = await provisionDisposableUser("pi-mobile-fullscreen");
  });

  test("Add modal is full-screen with no horizontal overflow at 320–430px", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: HEIGHT });
    await loginAs(page, user);

    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: HEIGHT });
      await page.goto("/personal-income", { waitUntil: "domcontentloaded" });

      const addBtn = page.getByTestId("add-paycheck-button").first();
      await expect(addBtn).toBeVisible({ timeout: 15_000 });
      await addBtn.click();

      const modal = page.getByTestId("paycheck-form-modal");
      await expect(modal).toBeVisible({ timeout: 10_000 });
      // Let dialog enter animation settle so bounding boxes are stable.
      await page.waitForTimeout(200);

      const b = await box(modal);
      expect(b.x, `[${width}px] modal should be flush left`).toBeLessThanOrEqual(1);
      expect(b.width, `[${width}px] modal should span viewport width`).toBe(
        width,
      );
      // 100dvh — allow 1px rounding tolerance.
      expect(
        b.height,
        `[${width}px] modal should span (near) full viewport height`,
      ).toBeGreaterThanOrEqual(HEIGHT - 1);

      // Radius must be 0 on mobile (rounded-none) so it visually is full-screen.
      const radius = await modal.evaluate(
        (el) => getComputedStyle(el as HTMLElement).borderTopLeftRadius,
      );
      expect(
        radius,
        `[${width}px] modal should have no rounded corners on mobile`,
      ).toBe("0px");

      // No horizontal overflow on the document or modal body.
      const overflow = await page.evaluate(() => {
        const doc = document.documentElement;
        const body = document.body;
        return {
          docScroll: doc.scrollWidth,
          docClient: doc.clientWidth,
          bodyScroll: body.scrollWidth,
          bodyClient: body.clientWidth,
        };
      });
      expect(
        overflow.docScroll,
        `[${width}px] documentElement should not overflow horizontally`,
      ).toBeLessThanOrEqual(overflow.docClient + 1);
      expect(
        overflow.bodyScroll,
        `[${width}px] body should not overflow horizontally`,
      ).toBeLessThanOrEqual(overflow.bodyClient + 1);

      // Modal's scrollable body must not overflow horizontally either.
      const bodyOverflowsX = await modal.evaluate((el) => {
        const scroll = el.querySelector<HTMLElement>(".overflow-y-auto");
        if (!scroll) return false;
        return scroll.scrollWidth > scroll.clientWidth + 1;
      });
      expect(
        bodyOverflowsX,
        `[${width}px] modal scroll body should not overflow horizontally`,
      ).toBe(false);

      // Close via Cancel so the next iteration starts clean.
      await page.getByTestId("paycheck-cancel-button").click();
      await expect(modal).toBeHidden({ timeout: 5_000 });
    }
  });

  test("Opening Edit from the detail drawer dismisses the drawer (no nested panels)", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: HEIGHT });
    await loginAs(page, user);
    await seedOnePaycheck(page);

    // Open the read-only detail drawer.
    await page.getByTestId("paycheck-row").first().click();
    const detailEdit = page.getByTestId("tx-detail-edit");
    await expect(detailEdit).toBeVisible({ timeout: 10_000 });

    // Click Edit — the detail drawer must close before / as the modal opens.
    await detailEdit.click();
    const modal = page.getByTestId("paycheck-form-modal");
    await expect(modal).toBeVisible({ timeout: 10_000 });

    // Detail-drawer Edit button should no longer be in the DOM/visible; the
    // drawer's underlying Radix Dialog is unmounted or hidden.
    await expect(detailEdit).toBeHidden({ timeout: 5_000 });

    // No other role=dialog panels should sit alongside the modal.
    const openDialogs = page.locator('[role="dialog"]:visible');
    await expect(openDialogs).toHaveCount(1);

    // And the modal itself is full-screen at this width.
    const b = await box(modal);
    expect(b.width).toBe(390);
    expect(b.x).toBeLessThanOrEqual(1);
    expect(b.height).toBeGreaterThanOrEqual(HEIGHT - 1);
  });
});
