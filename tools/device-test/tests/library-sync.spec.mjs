import { test } from "../fixtures.mjs";
import { runDeviceScenario } from "../scenarios/shared-device-scenario.mjs";

test('sync Game Boy Tetris to a prepared Retro-Go device', async ({ page, device }, testInfo) => {
  test.setTimeout(1_800_000);
  await runDeviceScenario({ page, device }, testInfo, test);
});
