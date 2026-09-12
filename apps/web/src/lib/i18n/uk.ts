// Ukrainian locale assembler. Mirrors en.ts/de.ts's shape, built from strings/*.uk.ts (each
// created independently, never editing the source en/de files) and registers itself with
// locale.svelte.ts's registry — see registerLocales.ts for why this is a side-effect import
// rather than locale.svelte.ts importing this file directly (avoids a circular import).
import { deviceHeaderUk } from "./strings/deviceHeader.uk.js";
import { landingUk } from "./strings/landing.uk.js";
import { sharedUk } from "./strings/shared.uk.js";
import { overviewUk } from "./strings/overview.uk.js";
import { overviewRailUk } from "./strings/overviewRail.uk.js";
import { wizardUk } from "./strings/wizard.uk.js";
import { romsUk } from "./strings/roms.uk.js";
import {
  advancedUk,
  officialFirmwareUk,
  romSectionUk,
  dumpSectionUk,
  flashSectionUk,
  eraseSectionUk,
  fileBrowserSectionUk,
  retroGoTabUk,
} from "./strings/firmwareSetup.uk.js";
import { sourcesUk } from "./strings/sources.uk.js";
import { registerLocale } from "./locale.svelte.js";

registerLocale("uk", {
  advanced: advancedUk,
  deviceHeader: deviceHeaderUk,
  landing: landingUk,
  officialFirmware: officialFirmwareUk,
  overview: overviewUk,
  overviewRail: overviewRailUk,
  roms: romsUk,
  romSection: romSectionUk,
  dumpSection: dumpSectionUk,
  flashSection: flashSectionUk,
  eraseSection: eraseSectionUk,
  fileBrowserSection: fileBrowserSectionUk,
  retroGoTab: retroGoTabUk,
  shared: sharedUk,
  sources: sourcesUk,
  wizard: wizardUk,
});
