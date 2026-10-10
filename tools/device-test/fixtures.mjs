import { test as base } from "@playwright/test";
export { expect } from "@playwright/test";
import { QmpDevice } from "./device.mjs";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";

export const test = base.extend({
  page: async ({ page }, use, testInfo) => {
    const reportDir = process.env.GNW_TEST_REPORT_DIR || testInfo.outputDir;
    await mkdir(reportDir, { recursive: true });
    let consoleQueue = [];
    let consoleTimer = null;
    let consoleWrites = Promise.resolve();
    const flushConsole = () => {
      if (consoleTimer !== null) { clearTimeout(consoleTimer); consoleTimer = null; }
      const lines = consoleQueue;
      consoleQueue = [];
      if (lines.length) consoleWrites = consoleWrites.then(() =>
        appendFile(path.join(reportDir, 'browser-console.log'), lines.join('\n') + '\n'));
      return consoleWrites;
    };
    const consoleRecord = (line) => {
      consoleQueue.push(line);
      if (consoleTimer === null) consoleTimer = setTimeout(() => {
        consoleTimer = null;
        void flushConsole().catch(() => {});
      }, 250);
    };
    page.on('console', message => consoleRecord(`[console:${message.type()}] ${message.text()}`));
    page.on('pageerror', error => consoleRecord(`[pageerror] ${error.stack || error.message}`));

    // The production app streams audit entries through this binding only when the
    // harness is present. No source-module import or periodic ring traversal is needed.
    await page.exposeBinding("__gnwTestAuditSink", async (_source, entries) => {
      if (!Array.isArray(entries) || entries.length === 0) return;
      const records = entries.map((entry) => ({ capturedAt: new Date().toISOString(), ...entry }));
      await appendFile(path.join(reportDir, "app-debug.jsonl"),
        records.map((record) => JSON.stringify(record)).join("\n") + "\n");
      await appendFile(path.join(reportDir, "app-debug.log"),
        records.map((record) => `${record.time} [${record.severity}/${record.source}] ${record.text}`).join("\n") + "\n");
    });
    try {
      await use(page);
    } finally {
      await Promise.race([
        page.evaluate(() => window.__gnwTestFlushAuditLog?.()).catch(() => {}),
        new Promise((resolve) => setTimeout(resolve, 3_000)),
      ]);
      await flushConsole();
      const debugLog = await readFile(path.join(reportDir, "app-debug.log")).catch(() => Buffer.alloc(0));
      const debugJsonl = await readFile(path.join(reportDir, "app-debug.jsonl")).catch(() => Buffer.alloc(0));
      const summary = Buffer.from(JSON.stringify({
        capturedEntries: debugJsonl.toString("utf8").split("\n").filter(Boolean).length,
        files: ["app-debug.log", "app-debug.jsonl"],
      }, null, 2) + "\n");
      await testInfo.attach("app-debug-summary.json", summary, { contentType: "application/json" });
      if (debugLog.length) await testInfo.attach("app-debug.log", debugLog, { contentType: "text/plain" });
      if (debugJsonl.length) await testInfo.attach("app-debug.jsonl", debugJsonl, { contentType: "application/x-ndjson" });
      const consoleLog = await readFile(path.join(reportDir, 'browser-console.log')).catch(() => Buffer.alloc(0));
      if (consoleLog.length) await testInfo.attach('browser-console.log', consoleLog, { contentType: 'text/plain' });
    }
  },
  context: async ({ playwright, browserName, baseURL, contextOptions, launchOptions }, use) => {
    const profileDir = process.env.GNW_TEST_BROWSER_PROFILE_DIR;
    const browserType = playwright[browserName];
    const headless = process.env.GNW_TEST_HEADLESS !== "0";
    const launchOptionsForRun = process.env.GNW_TEST_WAYLAND === "1" || process.env.GNW_TEST_DESKTOP === "1"
      ? { ...launchOptions, args: [...(launchOptions.args || []),
          `--ozone-platform=${process.env.GNW_TEST_WAYLAND === "1" ? "wayland" : "x11"}`,
          "--start-maximized"] }
      : launchOptions;
    if (browserName === 'chromium' && process.env.GNW_TEST_CHROMIUM_EXECUTABLE)
      launchOptionsForRun.executablePath = process.env.GNW_TEST_CHROMIUM_EXECUTABLE;
    let browser;
    let context;
    if (profileDir) {
      context = await browserType.launchPersistentContext(profileDir, {
        ...launchOptionsForRun,
        ...contextOptions,
        ignoreHTTPSErrors: baseURL?.startsWith('https://'),
        ...(headless ? {} : { viewport: null }),
        baseURL,
        headless,
      });
    } else {
      browser = await browserType.launch({ ...launchOptionsForRun, headless });
      context = await browser.newContext({ ...contextOptions, ignoreHTTPSErrors:baseURL?.startsWith('https://'), ...(headless ? {} : { viewport: null }), baseURL });
    }
    if (process.env.GNW_TEST_ADAPTER_ENABLED === "1") {
      await context.addInitScript(({ host, port }) => {
        localStorage.setItem("gnw:adapterType", JSON.stringify("remote"));
        localStorage.setItem("gnw:remoteHost", JSON.stringify(host));
        localStorage.setItem("gnw:remotePort", JSON.stringify(port));
        localStorage.setItem("gnw:target-media", JSON.stringify("flash"));
        localStorage.setItem("gnw:landing-media-chosen", JSON.stringify(false));
      }, { host: process.env.GNW_TEST_ADAPTER_HOST || "127.0.0.1",
        port: Number(process.env.GNW_TEST_ADAPTER_PORT || 0) });
    }
    await context.addInitScript((enabled) => {
      window.__GNW_BROWSER_INSTRUMENTATION__ = enabled;
    }, process.env.GNW_TEST_BROWSER_INSTRUMENTATION === "full");
    try {
      await use(context);
    } finally {
      await context.close();
      await browser?.close();
    }
  },
  device: async ({}, use) => {
    const port = Number(process.env.GNW_TEST_QMP_PORT || 0);
    const qmp = port ? await new QmpDevice(process.env.GNW_TEST_QMP_HOST || "127.0.0.1", port).connect() : null;
    const inputMode = process.env.GNW_TEST_INPUT_MODE || "qmp";
    if (!["timeline", "qmp", "remote-input"].includes(inputMode)) {
      throw new Error(`Unknown device input mode: ${inputMode}`);
    }
    if (inputMode === "remote-input" && !process.env.GNW_TEST_REMOTE_INPUT_URL) {
      throw new Error("remote-input mode requires GNW_TEST_REMOTE_INPUT_URL; configure a REMOTE_INPUT-enabled target controller");
    }
    await use({
      qmp: qmp && {
        press: (button, holdMs) => qmp.press(button, holdMs),
        screenshot: (path) => qmp.screenshot(path),
      },
      inputMode,
      // Timeline playback is started by the GWemu container at boot. Hardware
      // REMOTE_INPUT playback is delegated to the configured controller URL.
      remoteInputUrl: process.env.GNW_TEST_REMOTE_INPUT_URL || null,
      timeline: process.env.GNW_TEST_TIMELINE || null,
    });
    await qmp?.close();
  },
});
