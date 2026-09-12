// Russian locale assembler. Mirrors en.ts/de.ts's shape, built from strings/*.ru.ts (each
// created independently, never editing the source en/de files) and registers itself with
// locale.svelte.ts's registry — see registerLocales.ts for why this is a side-effect import
// rather than locale.svelte.ts importing this file directly (avoids a circular import).
import { deviceHeaderRu } from "./strings/deviceHeader.ru.js";
import { landingRu } from "./strings/landing.ru.js";
import { sharedRu } from "./strings/shared.ru.js";
import { overviewRu } from "./strings/overview.ru.js";
import { overviewRailRu } from "./strings/overviewRail.ru.js";
import { wizardRu } from "./strings/wizard.ru.js";
import { romsRu } from "./strings/roms.ru.js";
import {
  advancedRu,
  officialFirmwareRu,
  romSectionRu,
  dumpSectionRu,
  flashSectionRu,
  eraseSectionRu,
  fileBrowserSectionRu,
  retroGoTabRu,
} from "./strings/firmwareSetup.ru.js";
import { sourcesRu } from "./strings/sources.ru.js";
import { registerLocale } from "./locale.svelte.js";

registerLocale("ru", {
  advanced: advancedRu,
  deviceHeader: deviceHeaderRu,
  landing: landingRu,
  officialFirmware: officialFirmwareRu,
  overview: overviewRu,
  overviewRail: overviewRailRu,
  roms: romsRu,
  romSection: romSectionRu,
  dumpSection: dumpSectionRu,
  flashSection: flashSectionRu,
  eraseSection: eraseSectionRu,
  fileBrowserSection: fileBrowserSectionRu,
  retroGoTab: retroGoTabRu,
  shared: sharedRu,
  sources: sourcesRu,
  wizard: wizardRu,
});
