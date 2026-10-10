import { test } from "../fixtures.mjs";
import { runDeviceScenario } from "../scenarios/shared-device-scenario.mjs";

test('register ROM, BIOS, and OFW backup directories and settle Library', async ({ page, device }, testInfo) => {
  test.setTimeout(1_800_000);
  await runDeviceScenario({ page, device }, testInfo, test);
});
