// Visual preview harness — mocks a connected device so the themed UI renders
// without hardware, for screenshotting. Not shipped.
import "./styles/tokens.css";
import "./styles/global.css";
import { mount } from "svelte";
import App from "./App.svelte";
import { device } from "./lib/device.svelte.js";

const q = new URLSearchParams(location.search);
const model = q.get("model") === "zelda" ? "zelda" : "mario";

const fw = q.get("fw") === "retro-go" ? "retro-go" : "stock-ofw";
device.connection = "connected";
device.model = model;
// `device.firmware` is a derived getter off `deviceClass` now — mock deviceClass directly so
// this harness (screenshotting only, not shipped) still renders the requested firmware.
device.deviceClass =
  fw === "retro-go"
    ? { kind: "retrogo-sd", label: "Retro-Go", ofw: null, hasGames: true, hasSaves: true, installBanks: [1] }
    : { kind: "stock", model, label: `Stock ${model}`, ofw: { model, patched: false }, hasGames: false, hasSaves: false, installBanks: [1, 2] };
device.locked = false;
device.extSizeMB = model === "zelda" ? 4 : 1;
device.probeName = "ST-Link/V2J37";
device.info = {
  status: "IDLE",
  detectedStockFirmware: model.toUpperCase(),
  externalFlashSizeBytes: device.extSizeMB! * 1024 * 1024,
  externalFlashSizeMiB: device.extSizeMB!,
  minEraseSizeBytes: 4096,
  locked: false,
};

mount(App, { target: document.getElementById("app")! });
