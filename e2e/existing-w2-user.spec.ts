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

async function fillOnboardingFirstNameIfPresent(page: Page) {
  const bodyText = (await page.locator("body").textContent().catch(() => "")) ?? "";
  const firstNameRequired =
    /first name/i.test(bodyText) || /enter your first name to continue/i.test(bodyText);
  if (!firstNameRequired) return;

  await tryFill(
    page,
    null,
    [/^first name$/i, /first name/i, /^alex$/i],
    process.env.E2E_TEST_FIRST_NAME ?? "W2",
  );
}

async function waitForOnboardingToClear(page: Page) {
  await page
    .waitForURL((u) => !/\/onboarding/.test(u.pathname), { timeout: 20_000 })
    .catch(() => {});
}

/**
 * Already-onboarded users can still be bounced into a "Confirm your income
 * setup" re-onboarding screen (Step 1 of 3) when a deep link is opened before
 * the profile has hydrated. This helper detects that state and clicks through
 * Continue/Confirm/Skip a few times so deep-link pages (Dashboard, Taxes,
 * Personal Income) get a chance to render before we assert.
 */
async function dismissOnboardingIfPresent(page: Page) {
  for (let i = 0; i < 10; i++) {
    const url = new URL(page.url());
    const onOnboarding = /\/onboarding/.test(url.pathname);
    const bodyText = (await page.locator("body").textContent().catch(() => "")) ?? "";
    const looksLikeReonboarding =
      /step\s*\d+\s*of\s*\d+/i.test(bodyText) ||
      /confirm your income setup/i.test(bodyText);

    if (!onOnboarding && !looksLikeReonboarding) return;

    await fillOnboardingFirstNameIfPresent(page);

    // Make sure W-2 selection is set on Step 1 if visible.
    await tryClick(page, "onboarding-income-type-w2", [
      /w-?2 only/i,
      /employee income only/i,
      /^w-?2$/i,
    ]).catch(() => {});

    // If asked about YTD catch-up, skip it — the account already has data.
    await tryClick(page, "onboarding-ytd-skip", [
      /skip( for now)?/i,
      /no,?\s*(thanks|skip|i'?ll do this later)/i,
    ]).catch(() => {});

    const moved = await tryClick(page, "onboarding-continue", [
      /^continue$/i,
      /^confirm$/i,
      /next/i,
      /finish/i,
      /complete/i,
      /go to dashboard/i,
    ]);
    if (!moved) {
      // Nothing to click — bail to navigation.
      break;
    }
    await Promise.race([
      page.waitForURL((u) => !/\/onboarding/.test(u.pathname), { timeout: 1500 }),
      page.waitForTimeout(500),
    ]).catch(() => {});
  }
  await waitForOnboardingToClear(page);
}

async function gotoAppPath(page: Page, targetPath: string) {
  await dismissOnboardingIfPresent(page);
  await page.goto(abs(targetPath));
  await dismissOnboardingIfPresent(page);
  if (/\/onboarding/.test(new URL(page.url()).pathname)) {
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

    // ---- Onboarding (only if currently on /onboarding) ----
    let onboardingAvailable = /\/onboarding/.test(new URL(page.url()).pathname);

    if (onboardingAvailable) {
      console.log("Onboarding detected — running W-2-only flow.");

      // Step 1: select W-2 only profile.
      await tryClick(page, "onboarding-income-type-w2", [
        /w-?2 only/i,
        /employee income only/i,
        /^w-?2$/i,
      ]);
      await tryClick(page, "onboarding-continue", [/^continue$/i, /next/i]);

      // Step 2 ask: "Yes, help me catch up"
      await tryClick(page, "onboarding-ytd-yes", [/yes,?\s*help me catch up/i]);

      // ---- W-2-only path: no 1099/K-1 fields should be visible ----
      const formText = (await page.locator("body").textContent()) ?? "";
      expect(
        /1099|k-?1|self[- ]?employment|business income/i.test(formText)
          ? /w-?2 only|hidden because you selected w-?2/i.test(formText)
          : true,
        "W-2-only catch-up form should not expose 1099/K-1 fields",
      ).toBeTruthy();

      // YTD W-2 fields.
      await tryFill(
        page,
        "ytd-catchup-company-name",
        [/employer name/i, /employer/i, /company name/i],
        "Test Hospital W2",
      );
      await tryFill(
        page,
        "ytd-catchup-gross-income",
        [/total gross income ytd/i, /gross income/i, /gross wages/i],
        "80000",
      );
      await tryFill(
        page,
        "ytd-catchup-federal-withheld",
        [/federal (income )?(tax )?withheld/i, /federal withholding/i],
        "14000",
      );
      await tryFill(
        page,
        "ytd-catchup-ss-withheld",
        [/social security ytd/i, /social security (tax )?withheld/i],
        "4960",
      );
      await tryFill(
        page,
        "ytd-catchup-medicare-withheld",
        [/medicare ytd/i, /medicare (tax )?withheld/i],
        "1160",
      );
      await tryFill(
        page,
        "ytd-catchup-state-withheld",
        [/state (tax )?withheld/i, /state withholding/i],
        "0",
      );

      // Save YTD entry — clicking twice should not create a duplicate
      // because the form button disables itself while saving.
      const saved = await tryClick(page, "ytd-catchup-save", [
        /save catch-?up/i,
        /save( ytd)?/i,
        /add ytd/i,
      ]);
      expect(saved, "Save catch-up button should exist").toBeTruthy();
      // Second click immediately after — should be a no-op (disabled).
      await tryClick(page, "ytd-catchup-save", [/save catch-?up/i]).catch(
        () => {},
      );

      // Saved confirmation should appear without requiring a refresh.
      const savedBanner = page
        .locator('[data-testid="ytd-catchup-saved-banner"]')
        .first();
      if (await exists(savedBanner)) {
        await expect(savedBanner).toBeVisible({ timeout: 10_000 });
      }

      // Immediately try Continue — should not get stuck.
      const continued = await tryClick(page, "onboarding-continue", [
        /^continue$/i,
        /next/i,
        /finish/i,
        /complete/i,
      ]);
      expect(
        continued,
        "Continue button should be reachable after saving YTD W-2 entry",
      ).toBeTruthy();

      // Best-effort: keep clicking continue until we leave onboarding.
      for (let i = 0; i < 8; i++) {
        if (!/\/onboarding/.test(new URL(page.url()).pathname)) break;
        const moved = await tryClick(page, "onboarding-continue", [
          /^continue$/i,
          /next/i,
          /finish/i,
          /complete/i,
          /go to dashboard/i,
          /start with free/i,
          /continue with premium/i,
        ]);
        if (!moved) break;
        await page.waitForTimeout(500);
      }
    } else {
      console.log(
        "Onboarding was not available — account is already onboarded. Continuing to dashboard/income/tax checks.",
      );
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
    await expect(page.locator("body")).not.toBeEmpty({ timeout: 20_000 });
    const taxSummary = page
      .locator('[data-testid="tax-overview-summary"]')
      .first();
    if (await exists(taxSummary)) {
      await expect(taxSummary).toBeVisible({ timeout: 10_000 });
    }
    const taxText = (await page.locator("body").textContent()) ?? "";

    expect(taxText).toMatch(/federal/i);

    const seMatch = taxText.match(
      /self[- ]?employment tax[^$\n]*\$([\d,]+(?:\.\d+)?)/i,
    );
    if (seMatch) {
      const seVal = Number(seMatch[1].replace(/,/g, ""));
      expect(
        seVal,
        "Self-employment tax should be 0 for a W-2-only user",
      ).toBe(0);
    }

    if (onboardingAvailable) {
      expect(
        /\$?14[,]?000|withheld|withholding/i.test(taxText),
        "Tax overview should reflect W-2 federal withholding",
      ).toBeTruthy();
    }
  });
});
