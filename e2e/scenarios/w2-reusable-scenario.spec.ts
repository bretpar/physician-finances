/**
 * Reusable W-2 onboarding scenario harness.
 *
 * One repeatable test that:
 *   1. Logs in as a stable test user (never creates a new auth user).
 *   2. Safe-erases financial data via Settings → Danger Zone
 *      (NEVER touches the permanent-delete flow).
 *   3. Confirms routing back to onboarding (and that refresh stays there).
 *   4. Completes onboarding using the editable `scenario` object below.
 *   5. Adds remaining W-2 companies via Settings → Companies.
 *   6. Verifies the dashboard loads, all companies exist, and no
 *      1099 / K-1 / business income surfaces for a W-2-only scenario.
 *
 * ─────────────────────────────────────────────────────────────────────
 * HOW TO CREATE NEW VARIATIONS
 * ─────────────────────────────────────────────────────────────────────
 * Only edit the `scenario` object below. Do NOT duplicate this file
 * for each variation — change values in place and re-run.
 *
 * • High-income W-2 user:
 *     gross/ytdGrossIncome → 600_000 / 250_000, raise withholdings.
 * • Low-income W-2 user:
 *     gross/ytdGrossIncome → 45_000 / 18_000, lower withholdings.
 * • Two W-2 companies:
 *     trim scenario.companies to length 2.
 * • Four W-2 companies:
 *     append a 4th entry to scenario.companies.
 * • Married filing jointly:
 *     set scenario.filingStatus = "Married Filing Jointly".
 * • Different pay frequencies:
 *     mix payFrequency values across companies (Biweekly / Monthly /
 *     Semi-monthly / Weekly).
 * • Different YTD withholding patterns:
 *     vary ytdFederalWithholding / ytdSocialSecurityWithholding /
 *     ytdMedicareWithholding / ytdStateWithholding per company.
 *
 * Run from Codex / shell:
 *   E2E_TEST_EMAIL="brendantparker+codexw2@gmail.com" \
 *   E2E_TEST_PASSWORD="Test123!" \
 *   PLAYWRIGHT_BASE_URL="https://app.paycheckmd.com" \
 *   pnpm exec playwright test e2e/scenarios/w2-reusable-scenario.spec.ts
 */
import { test, expect, type Page, type Locator } from "../../playwright-fixture";

// ─────────────────────────────────────────────────────────────────────
// EDITABLE SCENARIO — change this object for new test variations.
// ─────────────────────────────────────────────────────────────────────
type PayFrequency =
  | "Weekly"
  | "Biweekly"
  | "Semi-monthly"
  | "Monthly";

interface ScenarioCompany {
  name: string;
  incomeType: "W-2";
  payFrequency: PayFrequency;
  grossAnnualIncome: number;
  ytdGrossIncome: number;
  ytdFederalWithholding: number;
  ytdSocialSecurityWithholding: number;
  ytdMedicareWithholding: number;
  ytdStateWithholding: number;
  preTaxDeductionsYtd: number;
  retirement401kYtd: number;
  healthPremiumsYtd: number;
}

const scenario = {
  name: "baseline-w2-multi-company",
  userType: "W-2 only" as const,
  filingStatus: "Single" as "Single" | "Married Filing Jointly",
  taxpayer: {
    firstName: "Test",
    lastName: "W2User",
    state: "WA",
  },
  companies: [
    {
      name: "Northwest Hospital",
      incomeType: "W-2",
      payFrequency: "Biweekly",
      grossAnnualIncome: 220_000,
      ytdGrossIncome: 85_000,
      ytdFederalWithholding: 14_500,
      ytdSocialSecurityWithholding: 5_270,
      ytdMedicareWithholding: 1_233,
      ytdStateWithholding: 0,
      preTaxDeductionsYtd: 6_000,
      retirement401kYtd: 6_000,
      healthPremiumsYtd: 1_500,
    },
    {
      name: "Urgent Care Group",
      incomeType: "W-2",
      payFrequency: "Monthly",
      grossAnnualIncome: 60_000,
      ytdGrossIncome: 20_000,
      ytdFederalWithholding: 3_500,
      ytdSocialSecurityWithholding: 1_240,
      ytdMedicareWithholding: 290,
      ytdStateWithholding: 0,
      preTaxDeductionsYtd: 0,
      retirement401kYtd: 0,
      healthPremiumsYtd: 0,
    },
    {
      name: "Telemedicine Shift Co",
      incomeType: "W-2",
      payFrequency: "Semi-monthly",
      grossAnnualIncome: 30_000,
      ytdGrossIncome: 10_000,
      ytdFederalWithholding: 1_200,
      ytdSocialSecurityWithholding: 620,
      ytdMedicareWithholding: 145,
      ytdStateWithholding: 0,
      preTaxDeductionsYtd: 0,
      retirement401kYtd: 0,
      healthPremiumsYtd: 0,
    },
  ] as ScenarioCompany[],
  expectations: {
    noBusinessIncomeExpected: true,
    no1099IncomeExpected: true,
    noK1IncomeExpected: true,
  },
};

// ─────────────────────────────────────────────────────────────────────
// Test config / credentials
// ─────────────────────────────────────────────────────────────────────
const EMAIL =
  process.env.E2E_TEST_EMAIL ?? "brendantparker+codexw2@gmail.com";
const PASSWORD = process.env.E2E_TEST_PASSWORD ?? "Test123!";
const BASE_URL =
  process.env.PLAYWRIGHT_BASE_URL ?? "https://app.paycheckmd.com";

const abs = (path: string) => new URL(path, BASE_URL).toString();

const FREQUENCY_TESTID: Record<PayFrequency, string> = {
  Weekly: "company-pay-frequency-option-weekly",
  Biweekly: "company-pay-frequency-option-biweekly",
  "Semi-monthly": "company-pay-frequency-option-semimonthly",
  Monthly: "company-pay-frequency-option-monthly",
};

const stepLog = (step: string, status: "PASS" | "FAIL" | "INFO", detail = "") =>
  // eslint-disable-next-line no-console
  console.log(`[scenario:${scenario.name}] ${status} ${step}${detail ? ` — ${detail}` : ""}`);

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────
async function loginThroughUI(page: Page): Promise<void> {
  await page.goto(abs("/login"), { waitUntil: "domcontentloaded" });
  await page.getByLabel(/email/i).fill(EMAIL);
  await page.getByLabel(/password/i).fill(PASSWORD);
  await page.getByRole("button", { name: /^(log ?in|sign ?in)$/i }).click();
  await page.waitForURL((u) => !/\/login(\b|\/)/.test(u.pathname), {
    timeout: 30_000,
  });
  stepLog("login", "PASS", `as ${EMAIL}`);
}

async function safeEraseViaSettings(page: Page): Promise<void> {
  await page.goto(abs("/settings"), { waitUntil: "domcontentloaded" });

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

  const triggerBtn = page.locator(
    '[data-testid="settings-delete-erase-account-button"]',
  );
  await triggerBtn.waitFor({ state: "visible", timeout: 10_000 });
  await triggerBtn.scrollIntoViewIfNeeded().catch(() => {});
  await triggerBtn.click({ timeout: 5_000 });

  const dialog = page.getByRole("dialog").first();
  await dialog.waitFor({ state: "visible", timeout: 5_000 });

  const safeOption = page.locator('[data-testid="settings-safe-erase-option"]');
  if (await safeOption.isVisible({ timeout: 2_000 }).catch(() => false)) {
    await safeOption.click({ timeout: 5_000 });
  }

  const safeConfirm = page.locator(
    '[data-testid="settings-safe-erase-confirm-button"]',
  );
  await safeConfirm.waitFor({ state: "visible", timeout: 10_000 });

  // Guardrail: refuse any button text that smells destructive.
  const safeText = (await safeConfirm.textContent().catch(() => "")) ?? "";
  if (/permanent|delete account permanently/i.test(safeText)) {
    throw new Error(
      `Refusing to click — safe-erase button text looks destructive: "${safeText}"`,
    );
  }
  await safeConfirm.click({ timeout: 5_000 });

  await Promise.race([
    page
      .waitForFunction(
        () => !!window.localStorage.getItem("paycheckmd:erase-complete"),
        undefined,
        { timeout: 30_000 },
      )
      .catch(() => {}),
    page
      .locator('[data-testid="settings-safe-erase-success"]')
      .waitFor({ state: "visible", timeout: 30_000 })
      .catch(() => {}),
    page.waitForURL(/\/onboarding/, { timeout: 30_000 }).catch(() => {}),
  ]);

  await page.waitForURL(/\/onboarding/, { timeout: 30_000 });
  stepLog("safe-erase", "PASS", "redirected to /onboarding");
}

async function verifyOnboardingPersistsAfterRefresh(page: Page): Promise<void> {
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForURL(/\/onboarding/, { timeout: 20_000 });
  await page
    .locator('[data-testid="onboarding-step-1"]')
    .waitFor({ state: "visible", timeout: 20_000 });
  stepLog("refresh-after-erase", "PASS", "still on /onboarding");
}

async function fillIfExists(
  locator: Locator,
  value: string,
  label: string,
): Promise<boolean> {
  if (await locator.first().isVisible({ timeout: 1_000 }).catch(() => false)) {
    await locator.first().fill(value).catch(() => {});
    return true;
  }
  stepLog(`field:${label}`, "INFO", "field not present — skipped");
  return false;
}

/** Completes onboarding for a W-2-only user with the FIRST scenario company. */
async function completeOnboardingW2Only(
  page: Page,
  firstCompany: ScenarioCompany,
  firstName: string,
): Promise<void> {
  await page
    .locator('[data-testid="onboarding-step-1"]')
    .waitFor({ state: "visible", timeout: 30_000 });

  const firstNameInput = page.locator(
    '[data-testid="onboarding-first-name-input"]',
  );
  if (await firstNameInput.isVisible({ timeout: 2_000 }).catch(() => false)) {
    await firstNameInput.fill(firstName).catch(() => {});
  }

  await page.locator('[data-testid="onboarding-income-type-w2"]').click();
  await page.locator('[data-testid="onboarding-continue-button"]').click();

  // YTD step — skip; we set up YTD via per-company settings later.
  const ytdSkip = page.locator('[data-testid="onboarding-ytd-skip"]');
  if (await ytdSkip.isVisible({ timeout: 10_000 }).catch(() => false)) {
    await ytdSkip.click();
  } else {
    const ytdNo = page.locator('[data-testid="onboarding-ytd-no"]');
    if (await ytdNo.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await ytdNo.click();
    }
  }

  await page
    .locator('[data-testid="onboarding-company-entry-step"]')
    .waitFor({ state: "visible", timeout: 15_000 });

  const companyInput = page
    .locator(
      '[data-testid="onboarding-employer-name-input"], [data-testid="company-name-0"]',
    )
    .first();
  await companyInput.waitFor({ state: "visible", timeout: 15_000 });
  await companyInput.fill(firstCompany.name);
  await page.locator('[data-testid="onboarding-continue-button"]').click();

  // Final continue (Free/Premium).
  await page
    .locator('[data-testid="onboarding-continue-button"]')
    .waitFor({ state: "visible", timeout: 15_000 });
  await page.locator('[data-testid="onboarding-continue-button"]').click();

  await page.waitForURL((u) => !/\/onboarding/.test(u.pathname), {
    timeout: 30_000,
  });
  stepLog("onboarding-complete", "PASS", `first company: ${firstCompany.name}`);
}

/** Add an additional W-2 company via Settings → Companies modal. */
async function addCompanyViaSettings(
  page: Page,
  company: ScenarioCompany,
): Promise<void> {
  await page.goto(abs("/settings"), { waitUntil: "domcontentloaded" });

  const addBtn = page
    .locator(
      '[data-testid="settings-companies-add-button"], [data-testid="settings-companies-add-button-empty"]',
    )
    .first();
  await addBtn.waitFor({ state: "visible", timeout: 15_000 });
  await addBtn.scrollIntoViewIfNeeded().catch(() => {});
  await addBtn.click();

  const modal = page.locator('[data-testid="settings-company-modal"]');
  await modal.waitFor({ state: "visible", timeout: 10_000 });

  await page
    .locator('[data-testid="settings-company-name-input"]')
    .fill(company.name);

  // Income type — default is W-2 in the dialog; leave as-is.

  // Pay frequency.
  const freqTrigger = page.locator(
    '[data-testid="settings-company-frequency-select"]',
  );
  if (await freqTrigger.isVisible({ timeout: 2_000 }).catch(() => false)) {
    await freqTrigger.click();
    const opt = page.locator(
      `[data-testid="${FREQUENCY_TESTID[company.payFrequency]}"]`,
    );
    await opt.click({ timeout: 5_000 }).catch(() => {});
  }

  // Optional numeric fields — present in the dialog.
  await fillIfExists(
    page.locator(
      '[data-testid="settings-company-projected-annual-gross-input"]',
    ),
    String(company.grossAnnualIncome),
    "projected-annual-gross",
  );
  await fillIfExists(
    page.locator(
      '[data-testid="settings-company-expected-federal-withholding-input"]',
    ),
    String(company.ytdFederalWithholding),
    "expected-federal-withholding",
  );

  // Fields NOT exposed in the company dialog (SS, Medicare, state, pre-tax,
  // 401k, health, YTD gross). Logged for visibility; entered later via the
  // paycheck flow if/when extended.
  for (const [label, val] of [
    ["ytdGrossIncome", company.ytdGrossIncome],
    ["ytdSocialSecurityWithholding", company.ytdSocialSecurityWithholding],
    ["ytdMedicareWithholding", company.ytdMedicareWithholding],
    ["ytdStateWithholding", company.ytdStateWithholding],
    ["preTaxDeductionsYtd", company.preTaxDeductionsYtd],
    ["retirement401kYtd", company.retirement401kYtd],
    ["healthPremiumsYtd", company.healthPremiumsYtd],
  ] as const) {
    stepLog(
      `company-field:${company.name}:${label}`,
      "INFO",
      `value=${val} — no dialog input; persist via paycheck entry`,
    );
  }

  await page.locator('[data-testid="settings-company-save-button"]').click();
  await modal.waitFor({ state: "hidden", timeout: 15_000 });
  stepLog("add-company", "PASS", company.name);
}

async function verifyDashboardLoads(page: Page): Promise<void> {
  await page.goto(abs("/"), { waitUntil: "domcontentloaded" });
  await page.waitForURL((u) => !/\/onboarding/.test(u.pathname), {
    timeout: 20_000,
  });
  const summary = page.locator(
    '[data-testid="dashboard-summary"], main h1, [data-testid="dashboard-metrics"]',
  );
  await summary.first().waitFor({ state: "visible", timeout: 20_000 });
  stepLog("dashboard-loads", "PASS");
}

async function verifyCompaniesInSettings(
  page: Page,
  expectedNames: string[],
): Promise<void> {
  await page.goto(abs("/settings"), { waitUntil: "domcontentloaded" });
  const section = page.locator('[data-testid="settings-companies-section"]');
  await section.waitFor({ state: "visible", timeout: 15_000 });

  const text = (await section.textContent()) ?? "";
  for (const name of expectedNames) {
    expect(
      text.includes(name),
      `company "${name}" should be listed in Settings → Companies`,
    ).toBe(true);
    stepLog("company-present", "PASS", name);
  }

  // No duplicates: each name should appear in at most one row's name input.
  const rows = page.locator('[data-testid="settings-company-row"]');
  const rowCount = await rows.count();
  const seen = new Map<string, number>();
  for (let i = 0; i < rowCount; i++) {
    const nameInput = rows
      .nth(i)
      .locator('[data-testid="settings-company-row-name-input"]');
    const v = ((await nameInput.inputValue().catch(() => "")) || "").trim();
    if (!v) continue;
    seen.set(v, (seen.get(v) ?? 0) + 1);
  }
  for (const [n, c] of seen) {
    expect(c, `company "${n}" should not be duplicated`).toBe(1);
  }
  stepLog("no-duplicate-companies", "PASS", `rows=${rowCount}`);
}

async function verifyNoNonW2IncomeOnTaxOverview(page: Page): Promise<void> {
  // Best-effort: visit /taxes and assert no 1099/K-1/business income labels.
  await page.goto(abs("/taxes"), { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
  const body = (await page.locator("main").innerText().catch(() => "")) || "";

  const forbidden = [
    { label: "1099", expected: scenario.expectations.no1099IncomeExpected },
    { label: "K-1", expected: scenario.expectations.noK1IncomeExpected },
    {
      label: "Business income",
      expected: scenario.expectations.noBusinessIncomeExpected,
    },
  ];
  for (const f of forbidden) {
    if (!f.expected) continue;
    // We allow the literal word to appear in helper/legend text, but flag any
    // numeric/dollar association via "$" on the same line.
    const lines = body.split(/\n+/);
    const offender = lines.find(
      (l) => new RegExp(f.label, "i").test(l) && /\$\s*[\d,]/.test(l),
    );
    if (offender) {
      stepLog(
        "tax-overview-no-non-w2",
        "FAIL",
        `unexpected ${f.label} line: ${offender.trim()}`,
      );
    }
    expect(
      offender,
      `Tax Overview should not show $-valued ${f.label} income for W-2-only scenario`,
    ).toBeFalsy();
  }
  stepLog("tax-overview-no-non-w2", "PASS");
}

// ─────────────────────────────────────────────────────────────────────
// The reusable scenario test
// ─────────────────────────────────────────────────────────────────────
test.describe(`W-2 reusable scenario: ${scenario.name}`, () => {
  test.skip(
    !EMAIL || !PASSWORD,
    "E2E_TEST_EMAIL / E2E_TEST_PASSWORD must be set",
  );

  test("safe-erase → onboarding → multi-company → verify", async ({ page }) => {
    test.setTimeout(180_000);

    await loginThroughUI(page);
    await safeEraseViaSettings(page);
    await verifyOnboardingPersistsAfterRefresh(page);

    const [firstCompany, ...remainingCompanies] = scenario.companies;
    expect(firstCompany, "scenario.companies must have ≥ 1 entry").toBeTruthy();

    await completeOnboardingW2Only(
      page,
      firstCompany,
      scenario.taxpayer.firstName,
    );

    await verifyDashboardLoads(page);

    for (const company of remainingCompanies) {
      await addCompanyViaSettings(page, company);
    }

    await verifyCompaniesInSettings(
      page,
      scenario.companies.map((c) => c.name),
    );

    await verifyNoNonW2IncomeOnTaxOverview(page);

    stepLog("scenario", "PASS", "all major steps completed");
  });
});
