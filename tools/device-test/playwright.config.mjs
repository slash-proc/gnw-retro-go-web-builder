import { defineConfig } from "@playwright/test";

const reportDir = process.env.GNW_TEST_REPORT_DIR || "/reports";

export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 20_000 },
  outputDir: `${reportDir}/artifacts`,
  reporter: [
    ["list"],
    ["html", { outputFolder: `${reportDir}/html`, open: "never" }],
    ["json", { outputFile: `${reportDir}/results.json` }],
  ],
  use: {
    baseURL: process.env.GNW_TEST_APP_URL || "http://127.0.0.1:3000",
    browserName: process.env.GNW_TEST_BROWSER || "chromium",
    headless: process.env.GNW_TEST_HEADLESS !== "0",
    viewport: { width: 1920, height: 1080 },
    trace: process.env.GNW_TEST_BROWSER_INSTRUMENTATION === "full" ? "retain-on-failure" : "off",
    screenshot: "only-on-failure",
  },
});
