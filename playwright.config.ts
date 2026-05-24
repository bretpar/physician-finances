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
    // CI/dev containers (e.g. Codex sandbox) often lack an up-to-date root CA
    // bundle, so the live app's cert chain trips ERR_CERT_AUTHORITY_INVALID.
    // Allow opting in via PLAYWRIGHT_IGNORE_HTTPS_ERRORS or E2E_IGNORE_HTTPS_ERRORS.
    // Both accept "1" or "true". Defaults to true in CI so the existing-user
    // spec can reach https://app.paycheckmd.com. For local dev against trusted
    // hosts, set either variable to "0" or "false".
    ignoreHTTPSErrors: (() => {
      const envVal =
        process.env.PLAYWRIGHT_IGNORE_HTTPS_ERRORS ||
        process.env.E2E_IGNORE_HTTPS_ERRORS ||
        "";
      const lower = envVal.toLowerCase();
      if (lower === "0" || lower === "false") return false;
      if (lower === "1" || lower === "true") return true;
      return !!process.env.CI;
    })(),
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
          ? { launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } }
          : {}),
      },
    },
  ],
});

export default loadLovableConfig() ?? fallbackConfig;
