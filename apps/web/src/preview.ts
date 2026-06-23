// Visual preview harness — mocks a connected device so the themed UI renders
// without hardware, for screenshotting. Not shipped.
import "./styles/tokens.css";
import "./styles/global.css";
import { mount } from "svelte";
import App from "./App.svelte";
import { device } from "./lib/device.svelte.js";

const q = new URLSearchParams(location.search);
const model = q.get("model") === "zelda" ? "zelda" : "mario";

device.connection = "connected";
device.model = model;
device.firmware = q.get("fw") === "retro-go" ? "retro-go" : "stock-ofw";
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
