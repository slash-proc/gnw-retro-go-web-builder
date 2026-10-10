import { expect } from "../fixtures.mjs";

const tabs = {
  overview: /overview/i,
  firmware: /firmware/i,
  sources: /sources/i,
  library: /library|roms/i,
};

/** Navigate through the visible app tab and verify that its tabpanel mounted. */
export async function goToTab(page, name) {
  const label = tabs[name];
  if (!label) throw new Error(`Unknown app tab: ${name}`);
  const tab = page.getByRole("tab", { name: label });
  await expect(tab).toBeVisible();
  await tab.click();
  await expect(tab).toHaveAttribute("aria-selected", "true");
}

/** Overview rail entries are only available after entering the Overview tab. */
export async function goToOverviewPane(page, name, { ensureTab = true } = {}) {
  if (!["Status", "Details", "Activity", "Device log"].includes(name)) {
    throw new Error(`Unknown Overview pane: ${name}`);
  }
  if (ensureTab) await goToTab(page, "overview");
  const pane = page.getByRole("button", { name: new RegExp(`^${name}$`, "i") });
  await expect(pane).toBeVisible();
  await pane.click();
  await expect(pane).toHaveAttribute("aria-current", "true");
}

export async function goToFirmwarePane(page, name) {
  const panes = {
    "OFW Backup & Patch": /backup.*patch/i,
    Install: /install|upgrade|reinstall/i,
    "File Browser": /file browser/i,
    "Write image": /write image/i,
    Dump: /^dump$/i,
    Erase: /^erase$/i,
  };
  const label = panes[name];
  if (!label) throw new Error(`Unknown Firmware pane: ${name}`);
  await goToTab(page, "firmware");
  const rail = page.locator("nav.rail");
  const pane = rail.getByRole("button", { name: label }).first();
  const advanced = page.getByRole("button", { name: /^advanced$/i });
  if (!(await pane.isVisible().catch(() => false)) && await advanced.isVisible()) {
    await advanced.click();
    const confirmMethod = page.getByRole("dialog").filter({ hasText: /Change Installation Method/i });
    if (await confirmMethod.isVisible().catch(() => false)) {
      await confirmMethod.getByRole("button", { name: /Change Method/i }).click();
      await expect(confirmMethod).toBeHidden();
    }
  }
  await expect(pane).toBeVisible();
  await pane.click();
}

export async function goToGuidedSetup(page) {
  await goToTab(page, "firmware");
  // The firmware sub-navigation is labelled simply “Guided” in the current UI.
  const guided = page.getByRole("button", { name: /^guided(?: setup)?$/i });
  if (await guided.isVisible()) await guided.click();
  await expect(page.locator(".wizard-container")).toBeVisible();
}
