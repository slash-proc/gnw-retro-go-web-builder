// Japanese locale assembler. Mirrors en.ts/de.ts/fr.ts's shape, built from strings/*.ja.ts
// (each created independently, never editing the source en/de files) and registers itself
// with locale.svelte.ts's registry — see registerLocales.ts for why this is a side-effect
// import rather than locale.svelte.ts importing this file directly (avoids a circular import).
import { deviceHeaderJa } from "./strings/deviceHeader.ja.js";
import { landingJa } from "./strings/landing.ja.js";
import { sharedJa } from "./strings/shared.ja.js";
import { overviewJa } from "./strings/overview.ja.js";
import { wizardJa } from "./strings/wizard.ja.js";
import { romsJa } from "./strings/roms.ja.js";
import {
  advancedJa,
  officialFirmwareJa,
  romSectionJa,
  dumpSectionJa,
  flashSectionJa,
  eraseSectionJa,
  fileBrowserSectionJa,
  retroGoTabJa,
  expertCornerJa,
  deferredSectionJa,
} from "./strings/firmwareSetup.ja.js";
import { registerLocale } from "./locale.svelte.js";

registerLocale("ja", {
  advanced: advancedJa,
  deviceHeader: deviceHeaderJa,
  landing: landingJa,
  officialFirmware: officialFirmwareJa,
  overview: overviewJa,
  roms: romsJa,
  romSection: romSectionJa,
  dumpSection: dumpSectionJa,
  flashSection: flashSectionJa,
  eraseSection: eraseSectionJa,
  fileBrowserSection: fileBrowserSectionJa,
  retroGoTab: retroGoTabJa,
  expertCorner: expertCornerJa,
  deferredSection: deferredSectionJa,
  shared: sharedJa,
  wizard: wizardJa,
});
