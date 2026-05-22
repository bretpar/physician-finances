import type { PlaywrightTestConfig } from "@playwright/test";
import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright config with dual-mode support:
 *  - Inside the Lovable agent environment, defer to `lovable-agent-playwright-config`
 *    (provides preview wiring, auth, etc.).
 *  - Outside Lovable (Codex, CI, local), fall back to a standard Playwright config
 *    pointed at PLAYWRIGHT_BASE_URL / BASE_URL / the published app.
 */
function loadLovableConfig(): PlaywrightTestConfig | null {
  try {
    // Use eval'd require so bundlers/TS don't hard-resolve the optional dep.
    const req = eval("require") as NodeRequire;
    const mod = req("lovable-agent-playwright-config/config");
    if (mod && typeof mod.createLovableConfig === "function") {
      return mod.createLovableConfig({});
    }
  } catch {
    // Package not installed — fall back below.
  }
  return null;
}

const baseURL =
  process.env.PLAYWRIGHT_BASE_URL ||
  process.env.BASE_URL ||
  "https://app.paycheckmd.com";

const fallbackConfig: PlaywrightTestConfig = defineConfig({
  testDir: "./e2e",
  testMatch: /.*\.spec\.ts/,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL,
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});

export default loadLovableConfig() ?? fallbackConfig;
