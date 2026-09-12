// Italian locale assembler. Mirrors en.ts/de.ts's shape, built from strings/*.it.ts (each
// created independently, never editing the source en/de files) and registers itself with
// locale.svelte.ts's registry — see registerLocales.ts for why this is a side-effect import
// rather than locale.svelte.ts importing this file directly (avoids a circular import).
import { deviceHeaderIt } from "./strings/deviceHeader.it.js";
import { landingIt } from "./strings/landing.it.js";
import { sharedIt } from "./strings/shared.it.js";
import { overviewIt } from "./strings/overview.it.js";
import { overviewRailIt } from "./strings/overviewRail.it.js";
import { wizardIt } from "./strings/wizard.it.js";
import { romsIt } from "./strings/roms.it.js";
import {
  advancedIt,
  officialFirmwareIt,
  romSectionIt,
  dumpSectionIt,
  flashSectionIt,
  eraseSectionIt,
  fileBrowserSectionIt,
  retroGoTabIt,
} from "./strings/firmwareSetup.it.js";
import { sourcesIt } from "./strings/sources.it.js";
import { registerLocale } from "./locale.svelte.js";

registerLocale("it", {
  advanced: advancedIt,
  deviceHeader: deviceHeaderIt,
  landing: landingIt,
  officialFirmware: officialFirmwareIt,
  overview: overviewIt,
  overviewRail: overviewRailIt,
  roms: romsIt,
  romSection: romSectionIt,
  dumpSection: dumpSectionIt,
  flashSection: flashSectionIt,
  eraseSection: eraseSectionIt,
  fileBrowserSection: fileBrowserSectionIt,
  retroGoTab: retroGoTabIt,
  shared: sharedIt,
  sources: sourcesIt,
  wizard: wizardIt,
});
