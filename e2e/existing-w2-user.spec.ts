/**
 * Existing-user W-2-only E2E spec.
 *
 * Tests the live app against a pre-existing manually-created test user.
 * Does NOT seed data, does NOT call Supabase auth.signUp, does NOT import
 * any helpers from e2e/helpers/seed.ts.
 *
 * Credentials are read from:
 *   - E2E_TEST_EMAIL
 *   - E2E_TEST_PASSWORD
 *
 * Base URL from PLAYWRIGHT_BASE_URL, defaults to https://app.paycheckmd.com.
 *
 * Selector strategy: prefer data-testid selectors added in the W-2-only
 * onboarding hardening pass. Fall back to label / role-based heuristics so
 * the spec still works against older deploys.
 */
import { test, expect, type Page, type Locator } from "../playwright-fixture";

const EMAIL = process.env.E2E_TEST_EMAIL ?? "";
const PASSWORD = process.env.E2E_TEST_PASSWORD ?? "";
const BASE_URL =
  process.env.PLAYWRIGHT_BASE_URL ?? "https://app.paycheckmd.com";
const FORCE_RESET_FROM_SETTINGS = /^(1|true|yes)$/i.test(
  process.env.FORCE_RESET_FROM_SETTINGS ?? "",
);

function abs(path: string): string {
  return new URL(path, BASE_URL).toString();
}

async function exists(loc: Locator): Promise<boolean> {
  return (await loc.count().catch(() => 0)) > 0;
}

async function tryFill(
  page: Page,
  testid: string | null,
  labelPatterns: RegExp[],
  value: string,
): Promise<boolean> {
  if (testid) {
    const byTestId = page.locator(`[data-testid="${testid}"]`).first();
    if (await exists(byTestId)) {
      try {
        await byTestId.fill(value, { timeout: 2000 });
        return true;
      } catch {
        /* keep trying */
      }
    }
  }
  for (const re of labelPatterns) {
    const byLabel = page.getByLabel(re).first();
    if (await exists(byLabel)) {
      try {
        await byLabel.fill(value, { timeout: 2000 });
        return true;
      } catch {
        /* keep trying */
      }
    }
    const byPlaceholder = page.getByPlaceholder(re).first();
    if (await exists(byPlaceholder)) {
      try {
        await byPlaceholder.fill(value, { timeout: 2000 });
        return true;
      } catch {
        /* keep trying */
      }
    }
  }
  return false;
}

async function tryClick(
  page: Page,
  testid: string | null,
  patterns: RegExp[],
): Promise<boolean> {
  if (testid) {
    const byTestId = page.locator(`[data-testid="${testid}"]`).first();
    if (await exists(byTestId)) {
      try {
        await byTestId.click({ timeout: 2000 });
        return true;
      } catch {
        /* keep trying */
      }
    }
  }
  for (const re of patterns) {
    const btn = page.getByRole("button", { name: re }).first();
    if (await exists(btn)) {
      try {
        await btn.click({ timeout: 2000 });
        return true;
      } catch {
        /* keep trying */
      }
    }
    const link = page.getByRole("link", { name: re }).first();
    if (await exists(link)) {
      try {
        await link.click({ timeout: 2000 });
        return true;
      } catch {
        /* keep trying */
      }
    }
  }
  return false;
}

async function loginThroughUI(page: Page) {
  await page.goto(abs("/login"));
  await page.getByLabel(/email/i).fill(EMAIL);
  // Never log the password — fill directly from env.
  await page.getByLabel(/password/i).fill(PASSWORD);
  await page
    .getByRole("button", { name: /^(log ?in|sign ?in)$/i })
    .click();
  await page.waitForURL((u) => !/\/login(\b|\/)/.test(u.pathname), {
    timeout: 30_000,
  });
}

const SAFE_TEST_FIRST_NAME = process.env.E2E_TEST_FIRST_NAME ?? "Test";

async function bodyText(page: Page): Promise<string> {
  return (await page.locator("body").textContent().catch(() => "")) ?? "";
}

async function isOnboardingStep1(page: Page): Promise<boolean> {
  const text = await bodyText(page);
  return /step\s*1\s*of\s*3/i.test(text) || /confirm your income setup/i.test(text);
}

async function hasOnboardingUi(page: Page): Promise<boolean> {
  const path = new URL(page.url()).pathname;
  const text = await bodyText(page);
  return (
    /\/onboarding/.test(path) ||
    /step\s*\d+\s*of\s*\d+/i.test(text) ||
    /confirm your income setup|have you already earned income|choose your plan|add each .*received this year/i.test(text)
  );
}

async function fillOnboardingFirstNameIfPresent(page: Page): Promise<boolean> {
  const text = await bodyText(page);
  if (!(await isOnboardingStep1(page)) && !/first name|enter your first name to continue/i.test(text)) {
    return false;
  }

  const candidates = [
    page.getByLabel(/^first name$/i).first(),
    page.getByPlaceholder(/^alex$/i).first(),
    page.locator('xpath=//*[normalize-space()="First name"]/following::input[1]').first(),
    page.locator("input").first(),
  ];

  for (const input of candidates) {
    if (!(await exists(input)) || !(await input.isVisible().catch(() => false))) continue;
    const current = await input.inputValue().catch(() => "");
    if (!current.trim()) {
      await input.fill(SAFE_TEST_FIRST_NAME, { timeout: 3000 });
      console.log("Filled missing first name");
    }
    return true;
  }

  return false;
}

async function ensureW2OnlySelected(page: Page): Promise<boolean> {
  if (!(await isOnboardingStep1(page))) return false;
  return tryClick(page, "onboarding-income-type-w2", [
    /w-?2 only/i,
    /employee income only/i,
    /^w-?2$/i,
  ]);
}

async function waitForPostOnboarding(page: Page, timeout = 30_000): Promise<boolean> {
  return page
    .waitForFunction(
      () => {
        const path = window.location.pathname;
        const text = document.body?.innerText ?? "";
        const hasStepUi = /step\s*\d+\s*of\s*\d+/i.test(text);
        const hasOnboardingCopy = /confirm your income setup|have you already earned income|choose your plan|add each .*received this year/i.test(text);
        const appPath = /^\/(?:$|personal-income|taxes|settings|business-activity|reports|deductions|investments|projected-income)/.test(path);
        return appPath && !/\/onboarding/.test(path) && !hasStepUi && !hasOnboardingCopy;
      },
      undefined,
      { timeout },
    )
    .then(() => true)
    .catch(() => false);
}

async function waitForOnboardingTransition(page: Page, previousText: string) {
  await Promise.race([
    waitForPostOnboarding(page, 5000),
    page.waitForFunction((oldText) => (document.body?.innerText ?? "") !== oldText, previousText, {
      timeout: 5000,
    }),
    page.waitForTimeout(1000),
  ]).catch(() => {});
}

async function recoverPartialOnboardingStep1(page: Page): Promise<boolean> {
  if (!(await isOnboardingStep1(page))) return false;

  console.log("Detected partial onboarding Step 1");
  const before = await bodyText(page);
  await fillOnboardingFirstNameIfPresent(page);
  await ensureW2OnlySelected(page);
  const continued = await tryClick(page, "onboarding-continue", [/^continue$/i, /next/i]);
  if (continued) await waitForOnboardingTransition(page, before);
  return continued;
}

async function saveStandardYtdCatchupEntry(page: Page) {
  await tryFill(page, "ytd-catchup-company-name", [/employer name/i, /employer/i, /company name/i], "Test Hospital W2");
  await tryFill(page, "ytd-catchup-gross-income", [/total gross income ytd/i, /gross income/i, /gross wages/i], "80000");
  await tryFill(page, "ytd-catchup-federal-withheld", [/federal (income )?(tax )?withheld/i, /federal withholding/i], "14000");
  await tryFill(page, "ytd-catchup-ss-withheld", [/social security ytd/i, /social security (tax )?withheld/i], "4960");
  await tryFill(page, "ytd-catchup-medicare-withheld", [/medicare ytd/i, /medicare (tax )?withheld/i], "1160");
  await tryFill(page, "ytd-catchup-state-withheld", [/state (tax )?withheld/i, /state withholding/i], "0");

  const saved = await tryClick(page, "ytd-catchup-save", [/save catch-?up/i, /save( ytd)?/i, /add ytd/i]);
  expect(saved, "Save catch-up button should exist").toBeTruthy();
  await tryClick(page, "ytd-catchup-save", [/save catch-?up/i]).catch(() => {});

  const savedBanner = page.locator('[data-testid="ytd-catchup-saved-banner"]').first();
  if (await exists(savedBanner)) await expect(savedBanner).toBeVisible({ timeout: 10_000 });
}

async function completeW2OnboardingCleanly(page: Page) {
  for (let i = 0; i < 14; i++) {
    if (!(await hasOnboardingUi(page))) break;
    const text = await bodyText(page);

    if (await recoverPartialOnboardingStep1(page)) continue;

    if (/have you already earned income/i.test(text)) {
      await tryClick(page, "onboarding-ytd-yes", [/yes,?\s*help me catch up/i]);
      await waitForOnboardingTransition(page, text);
      continue;
    }

    if (/add each .*received this year/i.test(text)) {
      await saveStandardYtdCatchupEntry(page);
      const continued = await tryClick(page, "onboarding-continue", [/^continue$/i, /next/i]);
      if (continued) await waitForOnboardingTransition(page, text);
      continue;
    }

    if (/add .*employer|add more later in settings/i.test(text)) {
      const skipped = await tryClick(page, null, [/skip for now/i]);
      if (skipped) {
        await waitForOnboardingTransition(page, text);
        continue;
      }
    }

    const moved = await tryClick(page, "onboarding-continue", [
      /^continue$/i,
      /^confirm$/i,
      /next/i,
      /finish/i,
      /complete/i,
      /go to dashboard/i,
      /start with free/i,
      /continue with premium/i,
    ]);
    if (!moved) break;
    await waitForOnboardingTransition(page, text);
  }

  const finished = await waitForPostOnboarding(page, 30_000);
  if (finished) console.log("Completed onboarding recovery");
  return finished;
}

/**
 * Already-onboarded users can still be bounced into a "Confirm your income
 * setup" re-onboarding screen (Step 1 of 3) when a deep link is opened before
 * the profile has hydrated. This helper completes or skips through that state
 * and does not return until onboarding navigation has settled.
 */
async function dismissOnboardingIfPresent(page: Page): Promise<boolean> {
  if (!(await hasOnboardingUi(page))) return true;

  for (let i = 0; i < 10; i++) {
    if (!(await hasOnboardingUi(page))) break;
    const text = await bodyText(page);

    if (await recoverPartialOnboardingStep1(page)) continue;

    const skippedYtd = await tryClick(page, "onboarding-ytd-skip", [
      /skip( for now)?/i,
      /no,?\s*(thanks|skip|i'?ll do this later)/i,
    ]).catch(() => false);
    if (skippedYtd) {
      await waitForOnboardingTransition(page, text);
      continue;
    }

    const skippedCompany = await tryClick(page, null, [/skip for now/i]).catch(() => false);
    if (skippedCompany) {
      await waitForOnboardingTransition(page, text);
      continue;
    }

    const moved = await tryClick(page, "onboarding-continue", [
      /^continue$/i,
      /^confirm$/i,
      /next/i,
      /finish/i,
      /complete/i,
      /go to dashboard/i,
      /start with free/i,
      /continue with premium/i,
    ]);
    if (!moved) break;
    await waitForOnboardingTransition(page, text);
  }

  const cleared = await waitForPostOnboarding(page, 15_000);
  if (cleared) console.log("Completed onboarding recovery");
  return cleared;
}

/**
 * Click through Settings → Danger Zone → "Erase account data" (NOT delete).
 * Preserves login credentials; wipes app/financial data and resets onboarding.
 * Returns true if the erase flow ran and the app navigated to /onboarding.
 */
async function eraseAccountDataViaSettings(page: Page): Promise<boolean> {
  await page.goto(abs("/settings"), { waitUntil: "domcontentloaded" });
  const openReset = page.getByRole("button", { name: /delete\/erase account/i }).first();
  if (!(await exists(openReset)) || !(await openReset.isVisible().catch(() => false))) {
    console.log("Settings erase: Danger Zone trigger not found");
    return false;
  }
  await openReset.scrollIntoViewIfNeeded().catch(() => {});
  await openReset.click({ timeout: 5000 });
  // Choose "Erase account data" (NOT "Delete account").
  await page.getByRole("button", { name: /^erase account data$/i }).click({ timeout: 5000 });
  await page.getByRole("button", { name: /^yes, erase my data$/i }).click({ timeout: 5000 });
  await page.waitForURL((u) => /\/onboarding/.test(u.pathname), { timeout: 30_000 });
  console.log("Settings erase: account data erased, app redirected to onboarding");
  return true;
}

async function resetUserDataViaSettingsFallback(page: Page): Promise<boolean> {
  await waitForPostOnboarding(page, 10_000);
  const erased = await eraseAccountDataViaSettings(page).catch(() => false);
  if (!erased) return false;
  console.log("Reset user data via Settings fallback");
  await completeW2OnboardingCleanly(page);
  return true;
}

/**
 * Deterministic force-reset path used when FORCE_RESET_FROM_SETTINGS=true.
 * Assumes the user is already logged in. Erases data via Settings (does NOT
 * delete the account), verifies the user is still signed in, then completes
 * W-2-only onboarding from a clean state.
 */
async function forceResetFromSettingsAndOnboard(page: Page): Promise<void> {
  console.log("FORCE_RESET_FROM_SETTINGS=true — running deterministic reset path");

  // 1. Make sure we're in the app (not on /login/onboarding) before opening Settings.
  await page.goto(abs("/"), { waitUntil: "domcontentloaded" });
  // Tolerate landing on onboarding — Settings is reachable from there too via direct nav.
  const erased = await eraseAccountDataViaSettings(page);
  if (!erased) {
    throw new Error(
      "FORCE_RESET_FROM_SETTINGS: could not trigger Settings → Erase account data flow",
    );
  }

  // 2. Verify the account still exists / user is still logged in. If the erase
  //    flow signed us out, log back in with the same credentials.
  if (/\/login/.test(new URL(page.url()).pathname)) {
    console.log("Force reset: session lost after erase, re-logging in");
    await loginThroughUI(page);
  }

  // 3. Confirm we're now on the onboarding/first-setup screen.
  const onboardingNow = /\/onboarding/.test(new URL(page.url()).pathname) || (await hasOnboardingUi(page));
  expect(onboardingNow, "After force reset, app should redirect to onboarding").toBeTruthy();
  console.log("Force reset: confirmed onboarding entry point");

  // 4. Complete W-2-only onboarding in the same run.
  const completed = await completeW2OnboardingCleanly(page);
  expect(completed, "Force-reset W-2 onboarding should complete cleanly").toBeTruthy();
  console.log("Force reset: W-2 onboarding completed");
}


async function gotoAppPath(page: Page, targetPath: string) {
  const recovered = await dismissOnboardingIfPresent(page);
  if (!recovered && !(await resetUserDataViaSettingsFallback(page))) {
    throw new Error(`Could not recover onboarding before navigating to ${targetPath}`);
  }
  await waitForPostOnboarding(page, 10_000);
  await page.goto(abs(targetPath), { waitUntil: "domcontentloaded" });
  const recoveredAfterGoto = await dismissOnboardingIfPresent(page);
  if (!recoveredAfterGoto && !(await resetUserDataViaSettingsFallback(page))) {
    throw new Error(`Still on onboarding before asserting ${targetPath}`);
  }
}

test.describe("Existing W-2-only user — live app", () => {
  test.skip(
    !EMAIL || !PASSWORD,
    "E2E_TEST_EMAIL and E2E_TEST_PASSWORD must be set",
  );

  test("login, optional W-2 onboarding, and core pages render", async ({
    page,
  }) => {
    await loginThroughUI(page);

    // App must render something — guard against blank page.
    const body = page.locator("body");
    await expect(body).not.toBeEmpty({ timeout: 20_000 });

    // ---- Optional deterministic force-reset path ----
    // When FORCE_RESET_FROM_SETTINGS=true, erase account data via Settings
    // (preserving credentials) and complete W-2 onboarding from a clean state.
    let onboardingAvailable = false;
    if (FORCE_RESET_FROM_SETTINGS) {
      await forceResetFromSettingsAndOnboard(page);
      onboardingAvailable = true;
    } else {
      onboardingAvailable = /\/onboarding/.test(new URL(page.url()).pathname);
      if (onboardingAvailable) {
        console.log("Onboarding detected — running W-2-only flow.");
        const completed = await completeW2OnboardingCleanly(page);
        expect(completed, "W-2 onboarding should complete before page assertions").toBeTruthy();
      } else {
        console.log(
          "Onboarding was not available — account is already onboarded. Continuing to dashboard/income/tax checks.",
        );
      }
    }


    // ---- Dashboard ----
    await gotoAppPath(page, "/");
    await expect(page.locator("body")).not.toBeEmpty({ timeout: 20_000 });
    expect(new URL(page.url()).pathname).not.toMatch(/\/login/);
    const dashSummary = page
      .locator('[data-testid="dashboard-summary"]')
      .first();
    if (await exists(dashSummary)) {
      await expect(dashSummary).toBeVisible({ timeout: 10_000 });
    }

    // ---- Personal income / paycheck ledger ----
    await gotoAppPath(page, "/personal-income");
    await expect(page.locator("body")).not.toBeEmpty({ timeout: 20_000 });
    const ledger = page.locator('[data-testid="paychecks-ledger"]').first();
    if (await exists(ledger)) {
      await expect(ledger).toBeVisible({ timeout: 10_000 });
    }
    const personalText = (await page.locator("body").textContent()) ?? "";

    if (onboardingAvailable) {
      const employerVisible = /Test Hospital W2/i.test(personalText);
      const grossVisible = /\$?80[,]?000/.test(personalText);
      expect(
        employerVisible || grossVisible,
        "Expected seeded W-2 entry (employer or $80,000) on personal income page",
      ).toBeTruthy();
    }

    // ---- Dashboard: W-2-only should not surface non-zero SE figures ----
    await gotoAppPath(page, "/");
    const dashText = (await page.locator("body").textContent()) ?? "";
    expect(
      /self[- ]?employment/i.test(dashText)
        ? /\$0(?:\.00)?|no self/i.test(dashText)
        : true,
      "W-2-only user should not show non-zero self-employment figures on dashboard",
    ).toBeTruthy();

    // ---- Tax overview ----
    await gotoAppPath(page, "/taxes");

    // Wait deterministically for Tax Overview to finish loading.
    const taxSummary = page.locator('[data-testid="tax-overview-summary"]').first();
    const overviewTab = page.getByRole("tab", { name: /tax overview/i });
    const breakdownTab = page.getByRole("tab", { name: /tax breakdown/i });
    const plannedToggle = page.getByRole("button", { name: /planned income/i });

    const readinessTimeout = 30_000;
    let taxReady = false;
    let readinessBranch: string | null = null;

    try {
      // Race the four readiness signals so we can log which branch won.
      readinessBranch = await Promise.race([
        taxSummary
          .waitFor({ state: "visible", timeout: readinessTimeout })
          .then(() => "summary"),
        overviewTab
          .waitFor({ state: "visible", timeout: readinessTimeout })
          .then(() => "overview-tab"),
        breakdownTab
          .waitFor({ state: "visible", timeout: readinessTimeout })
          .then(() => "breakdown-tab"),
        plannedToggle
          .waitFor({ state: "visible", timeout: readinessTimeout })
          .then(() => "planned-toggle"),
      ]);
      console.log(`Tax readiness resolved: branch=${readinessBranch}`);

      // Ensure the "Loading…" placeholder is gone.
      await expect
        .poll(
          async () => {
            const t = (await page.locator("body").textContent()) ?? "";
            return /tax overview\s*loading|^\s*loading…?\s*$/i.test(t.trim());
          },
          { timeout: readinessTimeout, intervals: [250, 500, 1000] },
        )
        .toBeFalsy();
      taxReady = true;
      console.log(`Tax Overview ready (branch=${readinessBranch}, loading cleared)`);
    } catch (err) {
      const url = page.url();
      const headings = await page.locator("h1, h2, h3").allTextContents();
      const buttons = await page.locator("button, [role=tab]").allTextContents();
      const bodyExcerpt = ((await page.locator("body").textContent()) ?? "").slice(0, 1500);
      console.log("Tax Overview never became ready", {
        url,
        headings: headings.slice(0, 20),
        buttons: buttons.slice(0, 30),
        bodyExcerpt,
      });
      await page
        .screenshot({ path: `test-results/tax-overview-not-ready-${Date.now()}.png`, fullPage: true })
        .catch(() => undefined);
      throw err;
    }

    // Assert tax content. Prefer the Tax Breakdown tab where "Federal" is reliably rendered.
    let federalFound = false;
    if (await exists(breakdownTab)) {
      console.log("Tax assertion: clicking breakdown tab (preferred)");
      await breakdownTab.click().catch(() => undefined);
      try {
        await expect(page.getByText(/federal/i).first()).toBeVisible({ timeout: 15_000 });
        federalFound = true;
        console.log("Tax assertion: federal text found on breakdown tab");
      } catch {
        console.log("Tax assertion: federal text NOT found on breakdown tab, falling back to overview");
      }
    } else {
      console.log("Tax assertion: breakdown tab not present, will use overview fallback");
    }
    if (!federalFound) {
      // Fallback: check overview content for federal/withholding terminology.
      if (await exists(overviewTab)) {
        await overviewTab.click().catch(() => undefined);
      }
      await expect(page.getByText(/federal|withhold/i).first()).toBeVisible({ timeout: 15_000 });
      console.log("Tax assertion: federal text found via overview fallback");
    }

    // Switch back to overview for the remaining assertions.
    if (await exists(overviewTab)) {
      await overviewTab.click().catch(() => undefined);
      await taxSummary.waitFor({ state: "visible", timeout: 10_000 }).catch(() => undefined);
    }
    const taxText = (await page.locator("body").textContent()) ?? "";
    console.log(`Tax text collected (length=${taxText.length})`);

    const seMatch = taxText.match(
      /self[- ]?employment tax[^$\n]*\$([\d,]+(?:\.\d+)?)/i,
    );
    if (seMatch) {
      const seVal = Number(seMatch[1].replace(/,/g, ""));
      console.log(`Self-employment tax parsed: ${seVal}`);
      expect(
        seVal,
        "Self-employment tax should be 0 for a W-2-only user",
      ).toBe(0);
    } else {
      console.log("Self-employment tax line not found in tax text (OK if UI omits zero-value rows)");
    }

    if (onboardingAvailable && taxReady) {
      const withholdingFound = /\$?14[,]?000|withheld|withholding/i.test(taxText);
      console.log(`W-2 withholding assertion: found=${withholdingFound}`);
      expect(
        withholdingFound,
        "Tax overview should reflect W-2 federal withholding",
      ).toBeTruthy();
    } else {
      console.log(`W-2 withholding assertion skipped: onboardingAvailable=${onboardingAvailable}, taxReady=${taxReady}`);
    }
  });
});
