// Arabic locale assembler. Mirrors en.ts/de.ts's shape, built from strings/*.ar.ts (each
// created independently, never editing the source en/de files) and registers itself with
// locale.svelte.ts's registry — see registerLocales.ts for why this is a side-effect import
// rather than locale.svelte.ts importing this file directly (avoids a circular import).
//
// Arabic is the app's first right-to-left locale. The direction itself is NOT set here: it
// belongs to the document, not to a string table, and lives in `lib/direction.svelte.ts`.
import { deviceHeaderAr } from "./strings/deviceHeader.ar.js";
import { landingAr } from "./strings/landing.ar.js";
import { sharedAr } from "./strings/shared.ar.js";
import { overviewAr } from "./strings/overview.ar.js";
import { overviewRailAr } from "./strings/overviewRail.ar.js";
import { wizardAr } from "./strings/wizard.ar.js";
import { romsAr } from "./strings/roms.ar.js";
import {
  advancedAr,
  officialFirmwareAr,
  romSectionAr,
  dumpSectionAr,
  flashSectionAr,
  eraseSectionAr,
  fileBrowserSectionAr,
  retroGoTabAr,
} from "./strings/firmwareSetup.ar.js";
import { sourcesAr } from "./strings/sources.ar.js";
import { registerLocale } from "./locale.svelte.js";

registerLocale("ar", {
  advanced: advancedAr,
  deviceHeader: deviceHeaderAr,
  landing: landingAr,
  officialFirmware: officialFirmwareAr,
  overview: overviewAr,
  overviewRail: overviewRailAr,
  roms: romsAr,
  romSection: romSectionAr,
  dumpSection: dumpSectionAr,
  flashSection: flashSectionAr,
  eraseSection: eraseSectionAr,
  fileBrowserSection: fileBrowserSectionAr,
  retroGoTab: retroGoTabAr,
  shared: sharedAr,
  sources: sourcesAr,
  wizard: wizardAr,
});
