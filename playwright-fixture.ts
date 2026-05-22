/**
 * Playwright fixture with dual-mode support.
 *
 * - Inside the Lovable agent environment, re-export the Lovable fixture
 *   (which wires preview auth, base URL, etc.).
 * - Outside Lovable (Codex, CI, local), fall back to the stock
 *   `@playwright/test` `test` / `expect` so specs can still run against
 *   PLAYWRIGHT_BASE_URL.
 */
import type { TestType, Expect } from "@playwright/test";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _test: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _expect: any;

try {
  // Use eval'd require so bundlers/TS don't hard-resolve the optional dep.
  const req = eval("require") as NodeRequire;
  const mod = req("lovable-agent-playwright-config/fixture");
  _test = mod.test;
  _expect = mod.expect;
} catch {
  // Fallback to vanilla Playwright.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const pw = eval("require")("@playwright/test");
  _test = pw.test;
  _expect = pw.expect;
}

export const test = _test as TestType<any, any>;
export const expect = _expect as Expect;
export type { Page } from "@playwright/test";
