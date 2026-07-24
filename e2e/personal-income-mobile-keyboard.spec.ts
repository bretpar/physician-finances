/**
 * Mobile-viewport regression for the Personal Income "Add / Edit Income Entry"
 * modal.
 *
 * Guards two behaviors of the full-screen mobile modal:
 *
 *   1) Focusing any input scrolls it into view — the focused element's
 *      bounding rect must sit fully inside the visible body area (above the
 *      sticky footer) so a mobile keyboard would not cover it.
 *   2) The sticky Save / Cancel footer stays pinned to the bottom of the
 *      viewport regardless of scroll position or which input is focused.
 *
 * The test does not exercise a real virtual keyboard (Chromium in Playwright
 * does not raise one). It validates the layout contract the mobile fix
 * depends on: sticky footer + scrollable body + input reachable via
 * scrollIntoView. If the footer stops being sticky or an input renders
 * behind it, this spec fails.
 *
 * Only reads layout; no tax or business logic is exercised.
 */
import { test, expect, type Page, type Locator } from "../playwright-fixture";
import { provisionDisposableUser, type DisposableUser } from "./helpers/seed";

// iPhone-ish mobile viewport (matches the smallest supported width called out
// in the modal refactor: 375 / 390 / 430).
test.use({ viewport: { width: 390, height: 780 } });

async function loginAs(page: Page, user: DisposableUser) {
  await page.goto("/login");
  await page.getByLabel(/email/i).fill(user.email);
  await page.getByLabel(/password/i).fill(user.password);
  await page.getByRole("button", { name: /^(log ?in|sign ?in)$/i }).click();
  await page.waitForURL((u) => !/\/(login|onboarding)/.test(u.pathname), {
    timeout: 20_000,
  });
}

async function boundingBox(locator: Locator) {
  const box = await locator.boundingBox();
  if (!box) throw new Error("Element has no bounding box");
  return box;
}

/**
 * Assert an input, once focused, is fully visible inside the modal body —
 * i.e. its rect fits between the top of the viewport and the top of the
 * sticky footer. This is what "scrolls into view above the keyboard" means
 * for the layout: the input is never rendered behind the footer strip that,
 * on real devices, sits just above the software keyboard.
 */
async function assertFocusScrollsIntoView(
  page: Page,
  input: Locator,
  footer: Locator,
  label: string,
) {
  await input.scrollIntoViewIfNeeded();
  await input.focus();
  // Give the modal's scroll container a frame to settle.
  await page.waitForTimeout(120);

  const viewport = page.viewportSize();
  if (!viewport) throw new Error("Viewport not set");

  const inputBox = await boundingBox(input);
  const footerBox = await boundingBox(footer);

  // Footer must remain pinned to the bottom of the viewport.
  expect(
    Math.abs(footerBox.y + footerBox.height - viewport.height),
    `[${label}] sticky footer bottom should align with viewport bottom`,
  ).toBeLessThanOrEqual(2);

  // Input must sit above the footer (not covered by it) and inside the
  // visible area.
  expect(
    inputBox.y,
    `[${label}] focused input top should be >= 0 (in viewport)`,
  ).toBeGreaterThanOrEqual(0);
  expect(
    inputBox.y + inputBox.height,
    `[${label}] focused input bottom should be above the sticky footer top`,
  ).toBeLessThanOrEqual(footerBox.y + 1);
}

test.describe("Personal Income modal — mobile keyboard behavior", () => {
  let user: DisposableUser;

  test.beforeAll(async () => {
    user = await provisionDisposableUser("pi-mobile-kb");
  });

  test("focused inputs scroll into view and sticky footer stays visible", async ({
    page,
  }) => {
    await loginAs(page, user);
    await page.goto("/personal-income", { waitUntil: "domcontentloaded" });

    const addBtn = page.getByTestId("add-paycheck-button").first();
    await expect(addBtn).toBeVisible({ timeout: 15_000 });
    await addBtn.click();

    const modal = page.getByTestId("paycheck-form-modal");
    await expect(modal).toBeVisible({ timeout: 10_000 });

    // The sticky footer holds Cancel + Save. We anchor on the Save button
    // because it's the primary action users must always be able to reach.
    const saveBtn = page.getByTestId("paycheck-save-button");
    const cancelBtn = page.getByTestId("paycheck-cancel-button");
    await expect(saveBtn).toBeVisible();
    await expect(cancelBtn).toBeVisible();

    const viewport = page.viewportSize()!;

    // 1) Sticky footer is anchored to the viewport bottom on open.
    const initialFooter = await boundingBox(saveBtn);
    expect(
      initialFooter.y + initialFooter.height,
      "Save button should sit near the bottom of the mobile viewport",
    ).toBeGreaterThan(viewport.height - initialFooter.height - 40);
    expect(initialFooter.y + initialFooter.height).toBeLessThanOrEqual(
      viewport.height + 1,
    );

    // The sticky footer element wraps both buttons — use the Save button's
    // parent row as the footer strip for scroll-into-view geometry.
    const footerStrip = saveBtn.locator("..");

    // 2) Focus each interactive input the user is likely to tap and assert
    //    it ends up above the footer (i.e. "above the keyboard").
    const inputsToCheck: Array<{ locator: Locator; label: string }> = [
      { locator: page.getByTestId("paycheck-title-input"), label: "title" },
      { locator: page.getByTestId("paycheck-gross-input"), label: "gross" },
      { locator: page.getByTestId("paycheck-net-input"), label: "net" },
    ];

    for (const { locator, label } of inputsToCheck) {
      if (await locator.count()) {
        await assertFocusScrollsIntoView(page, locator, footerStrip, label);
      }
    }

    // 3) After scrolling the modal body to the bottom, footer must still be
    //    pinned (regression guard: a non-sticky footer would scroll away).
    await modal.evaluate((el) => {
      const scrollable = el.querySelector<HTMLElement>(".overflow-y-auto");
      if (scrollable) scrollable.scrollTop = scrollable.scrollHeight;
    });
    await page.waitForTimeout(150);
    const footerAfterScroll = await boundingBox(saveBtn);
    expect(
      Math.abs(
        footerAfterScroll.y + footerAfterScroll.height - viewport.height,
      ),
      "Save button should stay pinned to the viewport bottom after body scroll",
    ).toBeLessThanOrEqual(2);
    await expect(saveBtn).toBeVisible();
    await expect(cancelBtn).toBeVisible();

    // 4) Focusing a field near the bottom of the form after that scroll
    //    should still bring it above the sticky footer.
    const lateField = page.getByTestId("paycheck-state-withholding-input");
    if (await lateField.count()) {
      await assertFocusScrollsIntoView(
        page,
        lateField,
        footerStrip,
        "state-withholding (post-scroll)",
      );
    }
  });
});
