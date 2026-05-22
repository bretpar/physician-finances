/**
 * Playwright fixture with dual-mode support (ESM-safe).
 *
 * - Inside the Lovable agent environment, re-export the Lovable fixture
 *   (which wires preview auth, base URL, etc.).
 * - Outside Lovable (Codex, CI, local), fall back to the stock
 *   `@playwright/test` `test` / `expect` so specs can still run against
 *   PLAYWRIGHT_BASE_URL.
 *
 * Uses dynamic `import()` instead of `require` so this works in both
 * CommonJS and ESM module scopes.
 */
import type { TestType, Expect } from "@playwright/test";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _test: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _expect: any;

try {
  const mod: any = await import(
    /* @vite-ignore */ "lovable-agent-playwright-config/fixture"
  );
  _test = mod.test ?? mod.default?.test;
  _expect = mod.expect ?? mod.default?.expect;
  if (!_test || !_expect) {
    throw new Error("lovable-agent-playwright-config/fixture missing exports");
  }
} catch {
  const pw: any = await import("@playwright/test");
  _test = pw.test;
  _expect = pw.expect;
}

export const test = _test as TestType<any, any>;
export const expect = _expect as Expect;
export type { Page, Locator } from "@playwright/test";
