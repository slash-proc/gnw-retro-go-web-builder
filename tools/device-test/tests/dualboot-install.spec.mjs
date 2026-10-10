import { test } from "../fixtures.mjs";
import { runDeviceScenario } from "../scenarios/shared-device-scenario.mjs";

test('patch stock OFW, install Retro-Go, and install Game Boy Tetris', async ({ page, device }, testInfo) => {
  test.setTimeout(1_800_000);
  await runDeviceScenario({ page, device }, testInfo, test);
});
