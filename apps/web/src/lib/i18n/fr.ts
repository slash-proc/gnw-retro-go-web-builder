// French locale assembler. Mirrors en.ts/de.ts's shape, built from strings/*.fr.ts (each
// created independently, never editing the source en/de files) and registers itself with
// locale.svelte.ts's registry — see registerLocales.ts for why this is a side-effect import
// rather than locale.svelte.ts importing this file directly (avoids a circular import).
import { deviceHeaderFr } from "./strings/deviceHeader.fr.js";
import { landingFr } from "./strings/landing.fr.js";
import { sharedFr } from "./strings/shared.fr.js";
import { overviewFr } from "./strings/overview.fr.js";
import { wizardFr } from "./strings/wizard.fr.js";
import { romsFr } from "./strings/roms.fr.js";
import {
  advancedFr,
  officialFirmwareFr,
  romSectionFr,
  dumpSectionFr,
  flashSectionFr,
  eraseSectionFr,
  fileBrowserSectionFr,
  retroGoTabFr,
  expertCornerFr,
  deferredSectionFr,
} from "./strings/firmwareSetup.fr.js";
import { registerLocale } from "./locale.svelte.js";

registerLocale("fr", {
  advanced: advancedFr,
  deviceHeader: deviceHeaderFr,
  landing: landingFr,
  officialFirmware: officialFirmwareFr,
  overview: overviewFr,
  roms: romsFr,
  romSection: romSectionFr,
  dumpSection: dumpSectionFr,
  flashSection: flashSectionFr,
  eraseSection: eraseSectionFr,
  fileBrowserSection: fileBrowserSectionFr,
  retroGoTab: retroGoTabFr,
  expertCorner: expertCornerFr,
  deferredSection: deferredSectionFr,
  shared: sharedFr,
  wizard: wizardFr,
});
