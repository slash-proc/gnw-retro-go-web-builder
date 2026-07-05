// Korean locale assembler. Mirrors en.ts/de.ts/fr.ts/ja.ts's shape, built from strings/*.ko.ts
// (each created independently, never editing the source en/de files) and registers itself
// with locale.svelte.ts's registry — see registerLocales.ts for why this is a side-effect
// import rather than locale.svelte.ts importing this file directly (avoids a circular import).
import { deviceHeaderKo } from "./strings/deviceHeader.ko.js";
import { landingKo } from "./strings/landing.ko.js";
import { sharedKo } from "./strings/shared.ko.js";
import { overviewKo } from "./strings/overview.ko.js";
import { wizardKo } from "./strings/wizard.ko.js";
import { romsKo } from "./strings/roms.ko.js";
import {
  advancedKo,
  officialFirmwareKo,
  romSectionKo,
  dumpSectionKo,
  flashSectionKo,
  eraseSectionKo,
  fileBrowserSectionKo,
  retroGoTabKo,
  expertCornerKo,
  deferredSectionKo,
} from "./strings/firmwareSetup.ko.js";
import { registerLocale } from "./locale.svelte.js";

registerLocale("ko", {
  advanced: advancedKo,
  deviceHeader: deviceHeaderKo,
  landing: landingKo,
  officialFirmware: officialFirmwareKo,
  overview: overviewKo,
  roms: romsKo,
  romSection: romSectionKo,
  dumpSection: dumpSectionKo,
  flashSection: flashSectionKo,
  eraseSection: eraseSectionKo,
  fileBrowserSection: fileBrowserSectionKo,
  retroGoTab: retroGoTabKo,
  expertCorner: expertCornerKo,
  deferredSection: deferredSectionKo,
  shared: sharedKo,
  wizard: wizardKo,
});
