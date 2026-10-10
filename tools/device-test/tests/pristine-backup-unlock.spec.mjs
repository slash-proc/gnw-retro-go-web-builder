import { test } from "../fixtures.mjs";
import { runDeviceScenario } from "../scenarios/shared-device-scenario.mjs";

test('back up a pristine locked device, patch it, and verify unlocked Status', async ({ page, device }, testInfo) => {
  test.setTimeout(1_800_000);
  await runDeviceScenario({ page, device }, testInfo, test);
});
