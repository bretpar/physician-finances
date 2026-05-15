/**
 * Disposable-user E2E harness.
 *
 * Provisions a brand-new Supabase user, marks onboarding complete, seeds
 * realistic 1099 income / business expenses / projected stream / YTD catch-up
 * rows through RLS, then drives the browser to verify Dashboard, Business
 * Activity, and Tax page outputs reflect that seeded data.
 *
 * Users are tagged e2e+...@paycheckmd-e2e.test and intentionally NOT deleted.
 */
import { test, expect, type Page } from "../playwright-fixture";
import { provisionDisposableUser, type DisposableUser } from "./helpers/seed";

function parseMoney(s: string | null | undefined): number {
  if (!s) return NaN;
  const m = s.match(/-?\$?\s?[\d,]+(?:\.\d+)?/);
  if (!m) return NaN;
  return Number(m[0].replace(/[$,\s]/g, ""));
}

async function loginAs(page: Page, user: DisposableUser) {
  await page.goto("/login");
  await page.getByLabel(/email/i).fill(user.email);
  await page.getByLabel(/password/i).fill(user.password);
  await page.getByRole("button", { name: /^(log ?in|sign ?in)$/i }).click();
  await page.waitForURL((u) => !/\/(login|onboarding)/.test(u.pathname), {
    timeout: 20_000,
  });
}

test.describe("Disposable user — full seed + verify", () => {
  let user: DisposableUser;

  test.beforeAll(async () => {
    user = await provisionDisposableUser("full");
  });

  test("dashboard reflects seeded business income and expenses", async ({ page }) => {
    await loginAs(page, user);
    await page.goto("/");

    // The dashboard renders multiple totals — assert the seeded gross figure
    // ($50,000) appears somewhere on the page (formatted with $ + commas).
    const body = page.locator("body");
    await expect(body).toContainText(/\$50,000/, { timeout: 20_000 });
    // And the seeded business expense ($8,000) is reflected.
    await expect(body).toContainText(/\$8,000/);
  });

  test("business activity ledger shows seeded transaction", async ({ page }) => {
    await loginAs(page, user);
    await page.goto("/business-activity");

    await expect(page.getByText(/E2E Medical Supplies/i)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(/E2E Locums/i).first()).toBeVisible();
  });

  test("taxes page shows non-zero federal + SE estimates from seeded data", async ({ page }) => {
    await loginAs(page, user);
    await page.goto("/taxes");
    await expect(page.getByRole("heading", { name: /tax overview/i })).toBeVisible({
      timeout: 20_000,
    });

    // Pull the visible page text and look for the major engine outputs. We
    // assert presence + reasonable bounds rather than exact pennies, since
    // bracket math is covered by unit tests in src/test/.
    const text = (await page.locator("body").textContent()) ?? "";

    const seMatch = text.match(/Self[- ]?Employment Tax[^$]*\$([\d,]+(?:\.\d+)?)/i);
    expect(seMatch, "SE tax line not found on Taxes page").not.toBeNull();
    const seTax = parseMoney(seMatch![1]);
    // Net SE profit ≈ $42k → SE tax ≈ 14.13% × 92.35% × 42k ≈ $5.5k.
    // Loose bounds let bracket tweaks slide without breaking the harness.
    expect(seTax).toBeGreaterThan(3_000);
    expect(seTax).toBeLessThan(9_000);

    const fedMatch = text.match(/Federal (?:Income )?Tax[^$]*\$([\d,]+(?:\.\d+)?)/i);
    expect(fedMatch, "Federal tax line not found on Taxes page").not.toBeNull();
    const fedTax = parseMoney(fedMatch![1]);
    expect(fedTax).toBeGreaterThan(0);
  });

  test("projected income stream surfaces forecast expense annualized", async ({ page }) => {
    await loginAs(page, user);
    await page.goto("/projected-income");

    // Stream card should exist; forecast expense field was set to $1,500/mo.
    await expect(page.getByText(/E2E Locums Group/i).first()).toBeVisible({
      timeout: 20_000,
    });
    // The forecast expense input value (1500) should appear somewhere on the
    // page — either as the per-period value, an annualized preview, or in
    // the edit form when the stream card is opened.
    const body = await page.locator("body").textContent();
    expect(body ?? "").toMatch(/1[,]?500|18[,]?000|6[,]?000/);
  });
});
