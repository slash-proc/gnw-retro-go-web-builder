import { test, expect } from "../fixtures.mjs";
import { goToFirmwarePane } from "../workflows/navigation.mjs";

test("open each Advanced firmware pane on a prepared device", async ({ page }, testInfo) => {
  test.setTimeout(300_000);
  page.setDefaultTimeout(30_000);
  await page.addInitScript(() => localStorage.setItem("gnw:locale", "en"));
  await page.goto("/");
  const mediaChoice = page.getByRole("button", { name: /Flash Memory.*internal flash chip/i });
  if (await mediaChoice.isVisible().catch(() => false)) await mediaChoice.click();
  await expect(page.getByRole("button", { name: /^Manage Device Backup/i })).toBeVisible();
  await page.getByRole("button", { name: /^Manage Device Backup/i }).click();
  const connect = page.getByRole("button", { name: /^connect$/i });
  if (await connect.isVisible().catch(() => false)) await connect.click();
  // Captured dual-boot profiles boot through stock OFW. The Advanced pane smoke
  // only needs the linked target; its UI identity can be Stock or Retro-Go.
  await expect.poll(() => page.locator("body").innerText(), { timeout: 90_000 })
    .toMatch(/Connected \((?:Stock|Retro-Go)\)/i);

  const panes = [
    ["OFW Backup & Patch", /backup|patch/i],
    ["Install", /install|upgrade|reinstall/i],
    ["File Browser", /file browser/i],
    ["Write image", /write image/i],
    ["Dump", /^dump$/i],
    ["Erase", /^erase$/i],
  ];
  for (const [name, heading] of panes) {
    await test.step(`open Advanced / ${name}`, async () => {
      await goToFirmwarePane(page, name);
      await expect(page.locator("h2").filter({ hasText: heading }).first()).toBeVisible();
      await testInfo.attach(`advanced-${name.toLowerCase().replaceAll(" ", "-")}.png`, {
        body: await page.screenshot({ fullPage: true }),
        contentType: "image/png",
      });
    });
  }
});
