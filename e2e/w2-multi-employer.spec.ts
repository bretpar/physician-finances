/**
 * W-2 multi-employer flow against the live app.
 *
 * This test intentionally uses stable data-testid selectors and avoids
 * fragile visible-text waits (e.g. "Step 1 of 3") or broad role/name
 * matchers that could click the destructive "Permanently delete account"
 * button.
 *
 * Flow:
 *   1. Log in with the existing test account.
 *   2. Safe-erase via Settings → Danger Zone → "Yes, erase my data".
 *      (Never touches the permanent-delete flow.)
 *   3. Wait for onboarding Step 1 via [data-testid="onboarding-step-1"].
 *   4. Complete W-2-only onboarding with the first employer.
 *   5. Go to Settings → Companies, add a second W-2 employer via the modal.
 *   6. Assert both employers show in the companies list and (if present) in
 *      the paycheck employer dropdown on /personal-income.
 *
 * Credentials: E2E_TEST_EMAIL / E2E_TEST_PASSWORD.
 * Base URL: PLAYWRIGHT_BASE_URL, defaults to https://app.paycheckmd.com.
 */
import { test, expect, type Page } from "../playwright-fixture";

const EMAIL = process.env.E2E_TEST_EMAIL ?? "";
const PASSWORD = process.env.E2E_TEST_PASSWORD ?? "";
const BASE_URL =
  process.env.PLAYWRIGHT_BASE_URL ?? "https://app.paycheckmd.com";

const EMPLOYER_ONE =
  process.env.E2E_W2_EMPLOYER_ONE ?? "Multi Test Employer One";
const EMPLOYER_TWO =
  process.env.E2E_W2_EMPLOYER_TWO ?? "Multi Test Employer Two";

function abs(path: string): string {
  return new URL(path, BASE_URL).toString();
}

async function logFailureContext(page: Page, label: string): Promise<void> {
  try {
    const url = page.url();
    const heading = await page
      .locator("h1, h2, h3")
      .first()
      .textContent()
      .catch(() => null);
    const step1Present =
      (await page
        .locator('[data-testid="onboarding-step-1"]')
        .count()
        .catch(() => 0)) > 0;
    const companyModalPresent =
      (await page
        .locator('[data-testid="settings-company-modal"]')
        .count()
        .catch(() => 0)) > 0;
    console.log(
      `[${label}] url=${url} heading=${JSON.stringify(heading)} ` +
        `onboarding-step-1=${step1Present} settings-company-modal=${companyModalPresent}`,
    );
  } catch (err) {
    console.log(`[${label}] failed to capture diagnostics:`, err);
  }
}

async function loginThroughUI(page: Page): Promise<void> {
  await page.goto(abs("/login"), { waitUntil: "domcontentloaded" });
  await page.getByLabel(/email/i).fill(EMAIL);
  await page.getByLabel(/password/i).fill(PASSWORD);
  await page
    .getByRole("button", { name: /^(log ?in|sign ?in)$/i })
    .click();
  await page.waitForURL((u) => !/\/login(\b|\/)/.test(u.pathname), {
    timeout: 30_000,
  });
}

/**
 * Safe-erase via Settings → Danger Zone. Clicks ONLY the safe path.
 * Never matches "Permanently delete account" or "Delete account" copy.
 */
async function safeEraseViaSettings(page: Page): Promise<void> {
  await page.goto(abs("/settings"), { waitUntil: "domcontentloaded" });

  // Expand the Danger Zone section if collapsed.
  const sectionHeading = page
    .getByRole("heading", { name: /delete\/erase account/i })
    .first();
  await sectionHeading.waitFor({ state: "visible", timeout: 15_000 });
  await sectionHeading.scrollIntoViewIfNeeded().catch(() => {});

  const sectionHeader = sectionHeading.locator(
    'xpath=ancestor::*[@role="button" and @aria-expanded][1]',
  );
  if ((await sectionHeader.count()) > 0) {
    const expanded = await sectionHeader.first().getAttribute("aria-expanded");
    if (expanded !== "true") {
      await sectionHeader.first().click({ timeout: 5_000 }).catch(() => {});
    }
  }

  // Open the Danger Zone modal via its stable testid.
  const triggerBtn = page.locator(
    '[data-testid="settings-delete-erase-account-button"]',
  );
  await triggerBtn.waitFor({ state: "visible", timeout: 10_000 });
  await triggerBtn.scrollIntoViewIfNeeded().catch(() => {});
  await triggerBtn.click({ timeout: 5_000 });

  const dialog = page.getByRole("dialog").first();
  await dialog.waitFor({ state: "visible", timeout: 5_000 });

  // Pick the safe-erase option if the choose-step is shown.
  const safeOption = page.locator('[data-testid="settings-safe-erase-option"]');
  if (await safeOption.isVisible({ timeout: 2_000 }).catch(() => false)) {
    await safeOption.click({ timeout: 5_000 });
  }

  // Confirm via the specific safe-erase confirm button. Never use a regex
  // that could match "Permanently delete account" or similar.
  const safeConfirm = page.locator(
    '[data-testid="settings-safe-erase-confirm-button"]',
  );
  await safeConfirm.waitFor({ state: "visible", timeout: 10_000 });

  // Guardrail: refuse if the only visible button is the permanent-delete one.
  const safeText = (await safeConfirm.textContent().catch(() => "")) ?? "";
  if (/permanent|delete account permanently/i.test(safeText)) {
    throw new Error(
      `Refusing to click — safe-erase button text looks destructive: "${safeText}"`,
    );
  }

  await safeConfirm.click({ timeout: 5_000 });

  // Wait for the erase-complete marker in localStorage (best-effort), then URL,
  // then the step-1 testid.
  await page
    .waitForFunction(
      () => !!window.localStorage.getItem("paycheckmd:erase-complete"),
      undefined,
      { timeout: 30_000 },
    )
    .catch(() => {
      // Fallback: success panel may appear before localStorage settles.
      return page
        .locator('[data-testid="settings-safe-erase-success"]')
        .waitFor({ state: "visible", timeout: 5_000 })
        .catch(() => {});
    });

  await page.waitForURL(/\/onboarding/, { timeout: 30_000 });
}

async function waitForOnboardingStep1(page: Page): Promise<void> {
  await page
    .locator('[data-testid="onboarding-step-1"]')
    .waitFor({ state: "visible", timeout: 30_000 });
}

async function completeW2OnboardingWithEmployer(
  page: Page,
  employerName: string,
): Promise<void> {
  await waitForOnboardingStep1(page);

  // Step 1: optional first name (fill for determinism, but never asserted).
  const firstNameInput = page.locator(
    '[data-testid="onboarding-first-name-input"]',
  );
  if (await firstNameInput.isVisible({ timeout: 2_000 }).catch(() => false)) {
    await firstNameInput.fill("MultiTest").catch(() => {});
  }

  // Select W-2 only.
  await page.locator('[data-testid="onboarding-income-type-w2"]').click();
  await page.locator('[data-testid="onboarding-continue-button"]').click();

  // Step 2: YTD ask → choose "skip" to go straight to company sub-step.
  const ytdSkip = page.locator('[data-testid="onboarding-ytd-skip"]');
  if (await ytdSkip.isVisible({ timeout: 10_000 }).catch(() => false)) {
    await ytdSkip.click();
  } else {
    const ytdNo = page.locator('[data-testid="onboarding-ytd-no"]');
    if (await ytdNo.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await ytdNo.click();
    }
  }

  // Step 2 company sub-step: fill first employer name.
  const companyInput = page.locator('[data-testid="company-name-0"]');
  await companyInput.waitFor({ state: "visible", timeout: 15_000 });
  await companyInput.fill(employerName);
  await page.locator('[data-testid="onboarding-continue-button"]').click();

  // Step 3: final continue (Free/Premium button).
  await page
    .locator('[data-testid="onboarding-continue-button"]')
    .waitFor({ state: "visible", timeout: 15_000 });
  await page.locator('[data-testid="onboarding-continue-button"]').click();

  // Wait until we leave /onboarding.
  await page.waitForURL((u) => !/\/onboarding/.test(u.pathname), {
    timeout: 30_000,
  });
}

async function addCompanyFromSettings(
  page: Page,
  employerName: string,
): Promise<void> {
  await page.goto(abs("/settings"), { waitUntil: "domcontentloaded" });

  // Expand Companies section if needed.
  const companiesSection = page.locator(
    '[data-testid="settings-companies-section"]',
  );
  await companiesSection.waitFor({ state: "visible", timeout: 15_000 });
  await companiesSection.scrollIntoViewIfNeeded().catch(() => {});

  // Open the Add Company modal. Prefer the always-visible header button;
  // fall back to the empty-state button if the section was empty.
  const addBtn = page.locator('[data-testid="settings-companies-add-button"]');
  const addBtnEmpty = page.locator(
    '[data-testid="settings-companies-add-button-empty"]',
  );
  if (await addBtn.isVisible({ timeout: 2_000 }).catch(() => false)) {
    await addBtn.click();
  } else if (
    await addBtnEmpty.isVisible({ timeout: 2_000 }).catch(() => false)
  ) {
    await addBtnEmpty.click();
  } else {
    // Header collapsed — try expanding the section card.
    const sectionHeading = page
      .getByRole("heading", { name: /^companies$/i })
      .first();
    if (await sectionHeading.isVisible({ timeout: 2_000 }).catch(() => false)) {
      const header = sectionHeading.locator(
        'xpath=ancestor::*[@role="button" and @aria-expanded][1]',
      );
      if ((await header.count()) > 0) {
        await header.first().click().catch(() => {});
      }
    }
    await addBtn.waitFor({ state: "visible", timeout: 5_000 });
    await addBtn.click();
  }

  // Modal: fill name and save.
  const modal = page.locator('[data-testid="settings-company-modal"]');
  await modal.waitFor({ state: "visible", timeout: 10_000 });

  const nameInput = page.locator('[data-testid="settings-company-name-input"]');
  await nameInput.waitFor({ state: "visible", timeout: 5_000 });
  await nameInput.fill(employerName);

  await page.locator('[data-testid="settings-company-save-button"]').click();

  // Modal closes on success.
  await modal
    .waitFor({ state: "hidden", timeout: 15_000 })
    .catch(() => {});
}

test.describe("W-2 multi-employer flow — live app", () => {
  test.skip(
    !EMAIL || !PASSWORD,
    "E2E_TEST_EMAIL and E2E_TEST_PASSWORD must be set",
  );

  test.describe.configure({ mode: "serial" });

  test("safe-erase, onboard with employer #1, add employer #2 from Settings", async ({
    page,
  }, testInfo) => {
    test.setTimeout(180_000);

    try {
      await loginThroughUI(page);

      await safeEraseViaSettings(page);
      await waitForOnboardingStep1(page);

      // Refresh and confirm we are still on onboarding step 1 (the
      // post-erase guard must persist across reload until onboarding is
      // completed).
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.waitForURL(/\/onboarding/, { timeout: 15_000 });
      await waitForOnboardingStep1(page);

      await completeW2OnboardingWithEmployer(page, EMPLOYER_ONE);

      // Add second employer via Settings → Companies modal.
      await addCompanyFromSettings(page, EMPLOYER_TWO);

      // Both employer names should be visible somewhere on /settings.
      await page.goto(abs("/settings"), { waitUntil: "domcontentloaded" });
      const settingsBody = page.locator("body");
      await expect(settingsBody).toContainText(EMPLOYER_ONE, {
        timeout: 15_000,
      });
      await expect(settingsBody).toContainText(EMPLOYER_TWO, {
        timeout: 15_000,
      });

      // Best-effort: both employers should be selectable as a paycheck
      // source. Skip silently if the personal-income paycheck UI is not
      // exposed in this build.
      await page.goto(abs("/personal-income"), {
        waitUntil: "domcontentloaded",
      });
      const addPaycheck = page.locator('[data-testid="add-paycheck-button"]');
      if (await addPaycheck.isVisible({ timeout: 5_000 }).catch(() => false)) {
        await addPaycheck.click();
        const trigger = page.locator(
          '[data-testid="paycheck-employer-trigger"]',
        );
        if (await trigger.isVisible({ timeout: 5_000 }).catch(() => false)) {
          await trigger.click();
          const dropdownBody = page
            .locator('[role="listbox"], [role="dialog"]')
            .filter({ hasText: EMPLOYER_ONE })
            .first();
          await expect(dropdownBody).toContainText(EMPLOYER_ONE, {
            timeout: 5_000,
          });
          await expect(dropdownBody).toContainText(EMPLOYER_TWO, {
            timeout: 5_000,
          });
        } else {
          console.log(
            "paycheck-employer-trigger not visible — skipping dropdown assertion",
          );
        }
      } else {
        console.log(
          "add-paycheck-button not visible — skipping paycheck source check",
        );
      }
    } catch (err) {
      await logFailureContext(page, "multi-employer-failure");
      const shot = await page
        .screenshot({ fullPage: true })
        .catch(() => null);
      if (shot) {
        await testInfo.attach("failure-screenshot.png", {
          body: shot,
          contentType: "image/png",
        });
      }
      throw err;
    }
  });
});
