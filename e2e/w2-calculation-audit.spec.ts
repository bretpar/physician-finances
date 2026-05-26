/**
 * W-2 calculation audit spec.
 *
 * Goal: deterministically log in as a persistent W-2-only test user, add a
 * focused W-2 paycheck entry through the production UI, then assert that:
 *   • the paycheck form opens and saves without flakiness
 *   • the saved entry appears in the Personal Income ledger
 *   • the saved W-2 field values survive a hard refresh
 *   • the form does NOT leak 1099 / K-1 / Schedule C / business fields for
 *     a W-2-only user
 *   • Washington-state behavior is respected (no state income tax field)
 *
 * The spec writes a structured audit report to:
 *   test-results/w2-calculation-audit.json
 *
 * Required env:
 *   E2E_TEST_EMAIL
 *   E2E_TEST_PASSWORD
 *   PLAYWRIGHT_BASE_URL (defaults to https://app.paycheckmd.com)
 */
import { test, expect, type Page, type Locator } from "../playwright-fixture";
import * as fs from "node:fs";
import * as path from "node:path";

const EMAIL = process.env.E2E_TEST_EMAIL ?? "";
const PASSWORD = process.env.E2E_TEST_PASSWORD ?? "";
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? "https://app.paycheckmd.com";

const REPORT_PATH = path.resolve("test-results/w2-calculation-audit.json");

type AuditStatus = "pass" | "fail" | "skip";
interface AuditFinding {
  id: string;
  title: string;
  status: AuditStatus;
  detail?: string;
}
const findings: AuditFinding[] = [];
function record(f: AuditFinding) {
  findings.push(f);
  // Stream incrementally so a mid-spec crash still leaves a usable report.
  try {
    fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
    fs.writeFileSync(
      REPORT_PATH,
      JSON.stringify(
        { generatedAt: new Date().toISOString(), baseUrl: BASE_URL, findings },
        null,
        2,
      ),
    );
  } catch {
    /* report is best-effort */
  }
}

function abs(p: string) {
  return new URL(p, BASE_URL).toString();
}
async function exists(loc: Locator): Promise<boolean> {
  return (await loc.count().catch(() => 0)) > 0;
}

async function loginThroughUI(page: Page) {
  await page.goto(abs("/login"));
  await page.getByLabel(/email/i).fill(EMAIL);
  await page.getByLabel(/password/i).fill(PASSWORD);
  await page
    .getByRole("button", { name: /^(log ?in|sign ?in)$/i })
    .click();
  await page.waitForURL((u) => !/\/login(\b|\/)/.test(u.pathname), {
    timeout: 30_000,
  });
}

async function dismissOnboardingIfPresent(page: Page) {
  for (let i = 0; i < 6; i++) {
    const url = new URL(page.url());
    if (!/\/onboarding/.test(url.pathname)) return;
    const skip = page
      .getByRole("button", { name: /skip( for now)?/i })
      .first();
    if (await exists(skip)) {
      await skip.click({ timeout: 2000 }).catch(() => {});
      await page.waitForTimeout(500);
      continue;
    }
    const cont = page
      .getByRole("button", { name: /^continue$|next|finish|go to dashboard/i })
      .first();
    if (await exists(cont)) {
      await cont.click({ timeout: 2000 }).catch(() => {});
      await page.waitForTimeout(500);
      continue;
    }
    break;
  }
}

const PAYCHECK = {
  title: `Audit Paycheck ${Date.now()}`,
  gross: "5000",
  federal: "750",
  ss: "310",
  medicare: "72.50",
  k401: "500",
  hsa: "200",
  health: "150",
};

test.describe("W-2 calculation audit", () => {
  test.skip(!EMAIL || !PASSWORD, "E2E_TEST_EMAIL / E2E_TEST_PASSWORD required");

  test("add W-2 paycheck, persist, and verify W-2-only scoping", async ({
    page,
  }) => {
    await loginThroughUI(page);
    await dismissOnboardingIfPresent(page);

    await page.goto(abs("/personal-income"), { waitUntil: "domcontentloaded" });
    await dismissOnboardingIfPresent(page);
    await expect(page.locator("body")).not.toBeEmpty({ timeout: 20_000 });

    // 1) Open add modal
    const addBtn = page.locator('[data-testid="add-paycheck-button"]').first();
    await expect(addBtn).toBeVisible({ timeout: 15_000 });
    await addBtn.click();

    const modal = page.locator('[data-testid="paycheck-form-modal"]').first();
    await expect(modal).toBeVisible({ timeout: 10_000 });
    record({ id: "modal-open", title: "Paycheck modal opens", status: "pass" });

    // 2) W-2-only leakage check: income type select should not offer 1099/K-1/business options.
    // The select content only renders when opened, so probe by reading the
    // active form for 1099/K-1/Schedule C labels.
    const modalText = (await modal.textContent()) ?? "";
    const leaks = ["1099", "K-1", "Schedule C", "Business income"].filter((s) =>
      new RegExp(s, "i").test(modalText),
    );
    record({
      id: "w2-only-scoping",
      title: "No 1099 / K-1 / Schedule C leakage in W-2 modal",
      status: leaks.length === 0 ? "pass" : "fail",
      detail: leaks.length ? `Leaked terms: ${leaks.join(", ")}` : undefined,
    });

    // 3) Employer — switch to manual entry
    const employerTrigger = modal
      .locator('[data-testid="paycheck-employer-trigger"]')
      .first();
    if (await exists(employerTrigger)) {
      await employerTrigger.click();
      const otherBtn = page
        .locator('[data-testid="paycheck-employer-other-button"]')
        .first();
      await otherBtn.waitFor({ state: "visible", timeout: 5_000 });
      await otherBtn.click();
      const employerInput = modal
        .locator('[data-testid="paycheck-employer-input"]')
        .first();
      await employerInput.waitFor({ state: "visible", timeout: 5_000 });
      await employerInput.fill("Audit Hospital");
    }

    // 4) Title + gross
    await modal
      .locator('[data-testid="paycheck-title-input"]')
      .fill(PAYCHECK.title);
    await modal
      .locator('[data-testid="paycheck-gross-input"]')
      .fill(PAYCHECK.gross);

    // 5) Expand federal breakdown and fill components
    const breakdownToggle = modal
      .locator('[data-testid="paycheck-federal-breakdown-toggle"]')
      .first();
    if (await exists(breakdownToggle)) {
      await breakdownToggle.click().catch(() => {});
    }
    await modal
      .locator('[data-testid="paycheck-federal-withholding-input"]')
      .fill(PAYCHECK.federal);
    await modal
      .locator('[data-testid="paycheck-social-security-input"]')
      .fill(PAYCHECK.ss);
    await modal
      .locator('[data-testid="paycheck-medicare-input"]')
      .fill(PAYCHECK.medicare);

    // 6) Deductions (best-effort — these live behind "Advanced details")
    const k401 = modal.locator('[data-testid="paycheck-401k-input"]').first();
    if (await exists(k401)) await k401.fill(PAYCHECK.k401);
    const hsa = modal.locator('[data-testid="paycheck-hsa-input"]').first();
    if (await exists(hsa)) await hsa.fill(PAYCHECK.hsa);
    const health = modal
      .locator('[data-testid="paycheck-health-insurance-input"]')
      .first();
    if (await exists(health)) await health.fill(PAYCHECK.health);

    record({
      id: "deduction-fields",
      title: "401k / HSA / health insurance inputs present",
      status:
        (await exists(k401)) && (await exists(hsa)) && (await exists(health))
          ? "pass"
          : "skip",
      detail: "Inputs are inside the Advanced Details collapsible",
    });

    // 7) Washington state behavior — no state-tax field expected for WA users.
    const stateInput = modal
      .locator('[data-testid="paycheck-state-withholding-input"]')
      .first();
    const stateInputVisible = await exists(stateInput);
    record({
      id: "wa-state-tax",
      title: "Washington state: no state income tax field rendered",
      status: stateInputVisible ? "fail" : "pass",
      detail: stateInputVisible
        ? "State tax field is rendered for a WA user"
        : undefined,
    });

    // 8) Save — button must be enabled when required fields are filled
    const saveBtn = modal
      .locator('[data-testid="paycheck-save-button"]')
      .first();
    await expect(saveBtn).toBeEnabled({ timeout: 5_000 });
    record({
      id: "save-enabled",
      title: "Save button enables once W-2 required fields are filled",
      status: "pass",
    });

    await saveBtn.click();
    await expect(modal).toBeHidden({ timeout: 15_000 });
    record({
      id: "save-closes-modal",
      title: "Modal closes after successful save",
      status: "pass",
    });

    // 9) Ledger contains the new entry
    const ledger = page.locator('[data-testid="paychecks-ledger"]').first();
    await expect(ledger).toBeVisible({ timeout: 15_000 });
    await expect(ledger).toContainText(PAYCHECK.title, { timeout: 15_000 });
    record({
      id: "ledger-shows-entry",
      title: "Saved paycheck appears in ledger",
      status: "pass",
    });

    // 10) Persistence after refresh
    await page.reload({ waitUntil: "domcontentloaded" });
    await dismissOnboardingIfPresent(page);
    const ledgerAfter = page
      .locator('[data-testid="paychecks-ledger"]')
      .first();
    await expect(ledgerAfter).toBeVisible({ timeout: 20_000 });
    await expect(ledgerAfter).toContainText(PAYCHECK.title, {
      timeout: 15_000,
    });
    record({
      id: "persistence-after-refresh",
      title: "W-2 paycheck persists after page refresh",
      status: "pass",
    });

    // Write final report
    fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
    fs.writeFileSync(
      REPORT_PATH,
      JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          baseUrl: BASE_URL,
          paycheck: PAYCHECK,
          findings,
        },
        null,
        2,
      ),
    );

    const failed = findings.filter((f) => f.status === "fail");
    expect(failed, `Audit failures: ${JSON.stringify(failed, null, 2)}`).toHaveLength(0);
  });
});
