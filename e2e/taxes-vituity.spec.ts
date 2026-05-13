import { test, expect, Page, Locator } from "../playwright-fixture";

const EMAIL = "brendantparker@gmail.com";
const PASSWORD = "Test123!";
const ENTITY = "Vituity";

function parseMoney(s: string | null): number {
  if (!s) return NaN;
  const m = s.match(/-?\$?[\d,]+(?:\.\d+)?/);
  if (!m) return NaN;
  return Number(m[0].replace(/[$,]/g, ""));
}

async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel(/email/i).fill(EMAIL);
  await page.getByLabel(/password/i).fill(PASSWORD);
  await page.getByRole("button", { name: /^(log ?in|sign ?in)$/i }).click();
  await page.waitForURL((u) => !/\/login/.test(u.pathname), { timeout: 15_000 });
}

async function gotoTaxes(page: Page) {
  await page.goto("/taxes");
  await expect(page.getByRole("heading", { name: /tax overview/i })).toBeVisible({ timeout: 15_000 });
}

async function selectMode(page: Page, mode: "Planned Income" | "Actual Only") {
  await page.getByRole("button", { name: mode, exact: true }).click();
  // Allow re-render
  await page.waitForTimeout(500);
}

async function getVituityCards(page: Page): Promise<Locator[]> {
  // Each entity card is a Card containing the company name AND a "Profit" row
  const candidates = page.locator(`div:has-text("${ENTITY}")`);
  const count = await candidates.count();
  const seen = new Set<string>();
  const cards: Locator[] = [];
  for (let i = 0; i < count; i++) {
    const el = candidates.nth(i);
    const text = (await el.textContent()) ?? "";
    // Must look like an income source card (has Profit + Revenue/Expenses)
    if (!/Profit/.test(text) || !/Expenses/.test(text)) continue;
    if (!new RegExp(`\\b${ENTITY}\\b`).test(text)) continue;
    // Only the smallest enclosing card (skip outer wrappers that contain >1 card)
    const profitMatches = text.match(/Profit/g) ?? [];
    if (profitMatches.length !== 1) continue;
    const key = text.replace(/\s+/g, " ").trim().slice(0, 200);
    if (seen.has(key)) continue;
    seen.add(key);
    cards.push(el);
  }
  return cards;
}

async function assertVituityCardMath(card: Locator) {
  const text = (await card.textContent()) ?? "";

  // In planned mode the canonical revenue label is "Total revenue used".
  // In actual mode it is just "Revenue".
  const revenueMatch =
    text.match(/Total revenue used\s*\$?([\d,]+(?:\.\d+)?)/i) ??
    text.match(/(?:^|\s)Revenue\s*\$?([\d,]+(?:\.\d+)?)/i);
  const expensesMatch = text.match(/Expenses\s*−?\s*\$?([\d,]+(?:\.\d+)?)/i);
  const profitMatches = [...text.matchAll(/Profit\s*\$?(-?[\d,]+(?:\.\d+)?)/gi)];

  expect(revenueMatch, `revenue not found in card: ${text}`).not.toBeNull();
  expect(expensesMatch, `expenses not found in card: ${text}`).not.toBeNull();
  expect(profitMatches.length).toBeGreaterThan(0);

  const revenue = parseMoney(revenueMatch![1]);
  const expenses = parseMoney(expensesMatch![1]);
  const profit = parseMoney(profitMatches[profitMatches.length - 1][1]);

  expect(Math.abs(profit - (revenue - expenses))).toBeLessThanOrEqual(1);
}

test.describe("Taxes page – Vituity card", () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
    await gotoTaxes(page);
    // Scroll the income breakdown section into view
    await page.mouse.wheel(0, 1200);
    await page.waitForTimeout(300);
  });

  for (const mode of ["Actual Only", "Planned Income"] as const) {
    test(`renders exactly one Vituity card in ${mode} mode with matching profit`, async ({ page }) => {
      await selectMode(page, mode);

      const cards = await getVituityCards(page);
      expect(cards.length, `expected exactly one Vituity card in ${mode}, got ${cards.length}`).toBe(1);

      await assertVituityCardMath(cards[0]);
    });
  }
});
