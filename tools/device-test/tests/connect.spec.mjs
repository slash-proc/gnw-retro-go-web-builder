import { test, expect } from "../fixtures.mjs";
import { readFile, writeFile } from "node:fs/promises";
import { ppmToPng } from "../device.mjs";

async function checkpoint(page, testInfo, name) {
  const path = testInfo.outputPath(`${name}.png`);
  await page.screenshot({ path, fullPage: true });
  await testInfo.attach(name, { path, contentType: "image/png" });
}

test("web app connects to the Retro-Go firmware running in GWemu", async ({ page, device }, testInfo) => {
  const host = process.env.GNW_TEST_ADAPTER_HOST || "127.0.0.1";
  const port = Number(process.env.GNW_TEST_ADAPTER_PORT || "8765");
  const browserLog = [];
  page.on("console", (message) => browserLog.push(`[console:${message.type()}] ${message.text()}`));
  page.on("pageerror", (error) => browserLog.push(`[pageerror] ${error.stack || error.message}`));
  page.on("requestfailed", (request) => browserLog.push(`[requestfailed] ${request.url()} ${request.failure()?.errorText || ""}`));

  await page.addInitScript(({ remoteHost, remotePort }) => {
    localStorage.setItem("gnw:adapterType", JSON.stringify("remote"));
    localStorage.setItem("gnw:remoteHost", JSON.stringify(remoteHost));
    localStorage.setItem("gnw:remotePort", JSON.stringify(remotePort));
    localStorage.setItem("gnw:target-media", JSON.stringify("sd"));
    localStorage.setItem("gnw:landing-media-chosen", JSON.stringify(true));
  }, { remoteHost: host, remotePort: port });

  await test.step("open the app", async () => {
    await page.goto("/");
    await expect(page.getByRole("button", { name: /^Manage Device Backup/i })).toBeVisible();
    await checkpoint(page, testInfo, "01-app-ready");
  });

  await test.step("open device overview", async () => {
    await page.getByRole("button", { name: /^Manage Device Backup/i }).click();
    await checkpoint(page, testInfo, "02-device-overview");
  });

  await test.step("connect through the remote GDB adapter", async () => {
    const connect = page.getByRole("button", { name: /^connect$/i });
    if (await connect.isVisible().catch(() => false)) await connect.click();
    await expect(page.getByText(/Connected \(Retro-Go\)/i)).toBeVisible({ timeout: 60_000 });
    await checkpoint(page, testInfo, "03-retro-go-connected");
  });

  await test.step("record the emulated device screen through QMP", async () => {
    test.skip(!device.qmp, "QMP capture is disabled for this run");
    const qmpPath = process.env.GNW_TEST_QMP_SCREENSHOT;
    test.skip(!qmpPath, "QMP screenshot path is not mounted into both containers");
    await device.qmp.screenshot(qmpPath);
    const pngPath = process.env.GNW_TEST_QMP_SCREENSHOT_REPORT_PATH.replace(/\.ppm$/i, ".png");
    const png = ppmToPng(await readFile(process.env.GNW_TEST_QMP_SCREENSHOT_REPORT_PATH));
    await writeFile(pngPath, png);
    await testInfo.attach("04-device-screen", {
      path: pngPath,
      contentType: "image/png",
    });
  });
  await testInfo.attach("browser-console.log", Buffer.from(browserLog.join("\n") + "\n"), {
    contentType: "text/plain",
  });
});
