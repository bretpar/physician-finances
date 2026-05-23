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
 */
import { test, expect, type Page } from "../playwright-fixture";

const EMAIL = process.env.E2E_TEST_EMAIL ?? "";
const PASSWORD = process.env.E2E_TEST_PASSWORD ?? "";
const BASE_URL =
  process.env.PLAYWRIGHT_BASE_URL ?? "https://app.paycheckmd.com";

function abs(path: string): string {
  return new URL(path, BASE_URL).toString();
}

async function tryFill(
  page: Page,
  labelPatterns: RegExp[],
  value: string,
): Promise<boolean> {
  for (const re of labelPatterns) {
    const byLabel = page.getByLabel(re).first();
    if (await byLabel.count().catch(() => 0)) {
      try {
        await byLabel.fill(value, { timeout: 2000 });
        return true;
      } catch {
        /* keep trying */
      }
    }
    const byPlaceholder = page.getByPlaceholder(re).first();
    if (await byPlaceholder.count().catch(() => 0)) {
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

async function tryClick(page: Page, patterns: RegExp[]): Promise<boolean> {
  for (const re of patterns) {
    const btn = page.getByRole("button", { name: re }).first();
    if (await btn.count().catch(() => 0)) {
      try {
        await btn.click({ timeout: 2000 });
        return true;
      } catch {
        /* keep trying */
      }
    }
    const link = page.getByRole("link", { name: re }).first();
    if (await link.count().catch(() => 0)) {
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

test.describe("Existing W-2-only user — live app", () => {
  test.skip(
    !EMAIL || !PASSWORD,
    "E2E_TEST_EMAIL and E2E_TEST_PASSWORD must be set",
  );

  test("login, optional onboarding, and core pages render", async ({ page }) => {
    await loginThroughUI(page);

    // App must render something — guard against blank page.
    const body = page.locator("body");
    await expect(body).not.toBeEmpty({ timeout: 20_000 });

    // ---- Onboarding (only if currently on /onboarding) ----
    let onboardingAvailable = /\/onboarding/.test(new URL(page.url()).pathname);

    if (onboardingAvailable) {
      console.log("Onboarding detected — running W-2-only flow.");

      // Select W-2 / employee income only if such a control exists.
      await tryClick(page, [
        /w-?2 only/i,
        /employee income only/i,
        /^w-?2$/i,
        /employee/i,
      ]);

      // Employer / company name.
      await tryFill(
        page,
        [/employer/i, /company name/i, /company/i],
        "Test Hospital W2",
      );

      // State — try as select / combobox first, then plain input.
      const stateCombo = page
        .getByRole("combobox", { name: /state/i })
        .first();
      if (await stateCombo.count().catch(() => 0)) {
        try {
          await stateCombo.click({ timeout: 2000 });
          await page
            .getByRole("option", { name: /washington/i })
            .first()
            .click({ timeout: 2000 });
        } catch {
          await tryFill(page, [/state/i], "Washington");
        }
      } else {
        await tryFill(page, [/state/i], "Washington");
      }

      // Filing status.
      const filingCombo = page
        .getByRole("combobox", { name: /filing status/i })
        .first();
      if (await filingCombo.count().catch(() => 0)) {
        try {
          await filingCombo.click({ timeout: 2000 });
          await page
            .getByRole("option", { name: /^single$/i })
            .first()
            .click({ timeout: 2000 });
        } catch {
          await tryFill(page, [/filing status/i], "Single");
        }
      }

      // Pay frequency.
      const freqCombo = page
        .getByRole("combobox", { name: /pay frequency|frequency/i })
        .first();
      if (await freqCombo.count().catch(() => 0)) {
        try {
          await freqCombo.click({ timeout: 2000 });
          await page
            .getByRole("option", { name: /biweekly|bi-weekly/i })
            .first()
            .click({ timeout: 2000 });
        } catch {
          /* ignore */
        }
      }

      // YTD W-2 fields.
      await tryFill(
        page,
        [/ytd gross|gross income|gross wages|gross pay/i],
        "80000",
      );
      await tryFill(
        page,
        [/federal (income )?(tax )?withheld|federal withholding/i],
        "14000",
      );
      await tryFill(
        page,
        [/social security (tax )?withheld|ss withheld/i],
        "4960",
      );
      await tryFill(page, [/medicare (tax )?withheld/i], "1160");
      await tryFill(page, [/state (tax )?withheld|state withholding/i], "0");
      await tryFill(page, [/401\(?k\)?/i], "8000");
      await tryFill(page, [/\bhsa\b/i], "2000");
      await tryFill(
        page,
        [/health insurance|health premiums?/i],
        "1500",
      );

      // Save YTD entry.
      await tryClick(page, [/save( ytd)?|add entry|add ytd/i]);

      // Immediately try Continue — should not get stuck.
      const continued = await tryClick(page, [
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
        const moved = await tryClick(page, [
          /^continue$/i,
          /next/i,
          /finish/i,
          /complete/i,
          /go to dashboard/i,
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
    await page.goto(abs("/"));
    await expect(page.locator("body")).not.toBeEmpty({ timeout: 20_000 });
    // URL should not have bounced back to /login.
    expect(new URL(page.url()).pathname).not.toMatch(/\/login/);

    // ---- Personal income / paycheck ledger ----
    await page.goto(abs("/personal-income"));
    await expect(page.locator("body")).not.toBeEmpty({ timeout: 20_000 });
    const personalText = (await page.locator("body").textContent()) ?? "";

    if (onboardingAvailable) {
      // If we seeded the YTD entry through onboarding, the employer or the
      // gross amount should appear somewhere on the personal income page.
      const employerVisible = /Test Hospital W2/i.test(personalText);
      const grossVisible = /\$?80[,]?000/.test(personalText);
      expect(
        employerVisible || grossVisible,
        "Expected seeded W-2 entry (employer or $80,000) on personal income page",
      ).toBeTruthy();
    }

    // ---- Business activity should be hidden/de-emphasized for W-2-only ----
    // We don't assert the route is blocked (some apps allow viewing), but we
    // do assert that no 1099/business income figures pollute the dashboard.
    await page.goto(abs("/"));
    const dashText = (await page.locator("body").textContent()) ?? "";
    expect(
      /self[- ]?employment/i.test(dashText)
        ? /\$0(?:\.00)?|no self/i.test(dashText)
        : true,
      "W-2-only user should not show non-zero self-employment figures on dashboard",
    ).toBeTruthy();

    // ---- Tax overview ----
    await page.goto(abs("/taxes"));
    await expect(page.locator("body")).not.toBeEmpty({ timeout: 20_000 });
    const taxText = (await page.locator("body").textContent()) ?? "";

    // Federal tax line should be present.
    expect(taxText).toMatch(/federal/i);

    // SE tax should be $0 (or absent) for a W-2-only user.
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

    // W-2 withheld should be reflected somewhere as paid/withheld (only
    // meaningful if we onboarded this run).
    if (onboardingAvailable) {
      expect(
        /\$?14[,]?000|withheld|withholding/i.test(taxText),
        "Tax overview should reflect W-2 federal withholding",
      ).toBeTruthy();
    }
  });
});
