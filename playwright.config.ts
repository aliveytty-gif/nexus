import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig, devices } from "@playwright/test";

// Existing process variables win; test-specific values precede local defaults.
for (const name of [".env.test.local", ".env.local"]) {
  const file = resolve(process.cwd(), name);
  if (existsSync(file)) process.loadEnvFile(file);
}

const externalBaseUrl = process.env.NEXUS_E2E_BASE_URL;
const baseURL = externalBaseUrl || "http://127.0.0.1:3000";
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
const nodeCommand =
  process.platform === "win32"
    ? `"${process.execPath}"`
    : `'${process.execPath.replaceAll("'", "'\\''")}'`;

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: Boolean(process.env.CI),
  reporter: "list",
  outputDir: "test-results",
  use: {
    baseURL,
    ...devices["Desktop Chrome"],
    viewport: { width: 1440, height: 1000 },
    launchOptions: executablePath ? { executablePath } : {},
    trace: "off",
    screenshot: "only-on-failure",
    video: "off",
  },
  projects: [{ name: "chromium" }],
  webServer: externalBaseUrl
    ? undefined
    : {
        command: `${nodeCommand} node_modules/next/dist/bin/next dev --hostname 127.0.0.1 --port 3000`,
        url: baseURL,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
});
