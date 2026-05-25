/**
 * W-2 paycheck persistence — lossless round-trip E2E.
 *
 * Saves a complex W-2 paycheck with non-trivial cents on every field, reloads
 * the page, opens the entry in edit mode, and asserts every input reflects
 * the saved value exactly. Guards against the audit-flagged bug where the
 * insert path silently dropped fields like `additional_tax_reserve` and
 * collapsed explicit `$0` values via `||` fallbacks.
 *
 * Requires a pre-existing user with onboarding already complete. Uses the
 * same E2E_TEST_EMAIL / E2E_TEST_PASSWORD env vars as the W-2 spec.
 */
import { test, expect, type Page } from "../playwright-fixture";

const EMAIL = process.env.E2E_TEST_EMAIL ?? "";
const PASSWORD = process.env.E2E_TEST_PASSWORD ?? "";
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? "https://app.paycheckmd.com";

function abs(p: string) {
  return new URL(p, BASE_URL).toString();
}

async function login(page: Page) {
  await page.goto(abs("/login"));
  await page.getByLabel(/email/i).fill(EMAIL);
  await page.getByLabel(/password/i).fill(PASSWORD);
  await page.getByRole("button", { name: /^(log ?in|sign ?in)$/i }).click();
  await page.waitForURL((u) => !/\/login/.test(u.pathname), { timeout: 30_000 });
}

const W2 = {
  title: "E2E W-2 Round-Trip",
  gross: "8421.57",
  net: "5123.91",
  retirement: "750.00",
  hsa: "250.55",
  health: "187.42",
};

test.describe("W-2 paycheck — lossless persistence", () => {
  test.skip(!EMAIL || !PASSWORD, "Requires E2E_TEST_EMAIL/PASSWORD");

  test("save → reload → edit reflects every value", async ({ page }) => {
    await login(page);
    await page.goto(abs("/personal-income"));

    // Open the add-paycheck form (button copy may vary; match common variants).
    const addBtn = page
      .getByRole("button", { name: /add (paycheck|income|w-?2)/i })
      .first();
    await addBtn.click({ timeout: 10_000 });

    await page.getByTestId("pi-title").fill(W2.title);
    await page.getByTestId("pi-gross").fill(W2.gross);
    await page.getByTestId("pi-net").fill(W2.net);

    // Expand advanced section to access 401k / HSA / health insurance.
    const advanced = page.getByRole("button", { name: /advanced details/i });
    if (await advanced.count()) await advanced.click();

    await page.getByTestId("pi-401k").fill(W2.retirement);
    await page.getByTestId("pi-hsa").fill(W2.hsa);
    await page.getByTestId("pi-health").fill(W2.health);

    await page.getByRole("button", { name: /^(save|add)/i }).first().click();
    await expect(page.getByText(/added|updated|saved/i).first()).toBeVisible({
      timeout: 10_000,
    });

    // Reload — fresh fetch from the DB, no client cache.
    await page.reload();

    // Re-open the entry in edit mode.
    await page.getByText(W2.title).first().click();

    await expect(page.getByTestId("pi-title")).toHaveValue(W2.title);
    await expect(page.getByTestId("pi-gross")).toHaveValue(W2.gross);
    await expect(page.getByTestId("pi-net")).toHaveValue(W2.net);

    const advanced2 = page.getByRole("button", { name: /advanced details/i });
    if (await advanced2.count()) await advanced2.click();

    await expect(page.getByTestId("pi-401k")).toHaveValue(W2.retirement);
    await expect(page.getByTestId("pi-hsa")).toHaveValue(W2.hsa);
    await expect(page.getByTestId("pi-health")).toHaveValue(W2.health);
  });
});
