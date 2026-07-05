// Polish locale assembler. Mirrors en.ts/de.ts/fr.ts/ja.ts/ko.ts/es.ts's shape, built from
// strings/*.pl.ts (each created independently, never editing the source en/de files) and
// registers itself with locale.svelte.ts's registry — see registerLocales.ts for why this is
// a side-effect import rather than locale.svelte.ts importing this file directly (avoids a
// circular import).
import { deviceHeaderPl } from "./strings/deviceHeader.pl.js";
import { landingPl } from "./strings/landing.pl.js";
import { sharedPl } from "./strings/shared.pl.js";
import { overviewPl } from "./strings/overview.pl.js";
import { wizardPl } from "./strings/wizard.pl.js";
import { romsPl } from "./strings/roms.pl.js";
import {
  advancedPl,
  officialFirmwarePl,
  romSectionPl,
  dumpSectionPl,
  flashSectionPl,
  eraseSectionPl,
  fileBrowserSectionPl,
  retroGoTabPl,
  expertCornerPl,
  deferredSectionPl,
} from "./strings/firmwareSetup.pl.js";
import { registerLocale } from "./locale.svelte.js";

registerLocale("pl", {
  advanced: advancedPl,
  deviceHeader: deviceHeaderPl,
  landing: landingPl,
  officialFirmware: officialFirmwarePl,
  overview: overviewPl,
  roms: romsPl,
  romSection: romSectionPl,
  dumpSection: dumpSectionPl,
  flashSection: flashSectionPl,
  eraseSection: eraseSectionPl,
  fileBrowserSection: fileBrowserSectionPl,
  retroGoTab: retroGoTabPl,
  expertCorner: expertCornerPl,
  deferredSection: deferredSectionPl,
  shared: sharedPl,
  wizard: wizardPl,
});
