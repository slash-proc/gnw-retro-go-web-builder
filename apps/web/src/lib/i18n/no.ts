// Norwegian (Bokmål) locale assembler. Mirrors en.ts/de.ts's shape, built from strings/*.no.ts
// (each created independently, never editing the source en/de files) and registers itself with
// locale.svelte.ts's registry — see registerLocales.ts for why this is a side-effect import
// rather than locale.svelte.ts importing this file directly (avoids a circular import).
import { deviceHeaderNo } from "./strings/deviceHeader.no.js";
import { landingNo } from "./strings/landing.no.js";
import { sharedNo } from "./strings/shared.no.js";
import { overviewNo } from "./strings/overview.no.js";
import { overviewRailNo } from "./strings/overviewRail.no.js";
import { wizardNo } from "./strings/wizard.no.js";
import { romsNo } from "./strings/roms.no.js";
import {
  advancedNo,
  officialFirmwareNo,
  romSectionNo,
  dumpSectionNo,
  flashSectionNo,
  eraseSectionNo,
  fileBrowserSectionNo,
  retroGoTabNo,
} from "./strings/firmwareSetup.no.js";
import { sourcesNo } from "./strings/sources.no.js";
import { registerLocale } from "./locale.svelte.js";

registerLocale("no", {
  advanced: advancedNo,
  deviceHeader: deviceHeaderNo,
  landing: landingNo,
  officialFirmware: officialFirmwareNo,
  overview: overviewNo,
  overviewRail: overviewRailNo,
  roms: romsNo,
  romSection: romSectionNo,
  dumpSection: dumpSectionNo,
  flashSection: flashSectionNo,
  eraseSection: eraseSectionNo,
  fileBrowserSection: fileBrowserSectionNo,
  retroGoTab: retroGoTabNo,
  shared: sharedNo,
  sources: sourcesNo,
  wizard: wizardNo,
});
