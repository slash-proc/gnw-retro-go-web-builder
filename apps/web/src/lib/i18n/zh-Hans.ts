// Simplified Chinese locale assembler. Mirrors en.ts/de.ts/fr.ts's shape, built from
// strings/*.zh-Hans.ts (each created independently, never editing the source en/de files) and
// registers itself with locale.svelte.ts's registry — see registerLocales.ts for why this is a
// side-effect import rather than locale.svelte.ts importing this file directly (avoids a
// circular import).
import { deviceHeaderZhHans } from "./strings/deviceHeader.zh-Hans.js";
import { landingZhHans } from "./strings/landing.zh-Hans.js";
import { sharedZhHans } from "./strings/shared.zh-Hans.js";
import { overviewZhHans } from "./strings/overview.zh-Hans.js";
import { overviewRailZhHans } from "./strings/overviewRail.zh-Hans.js";
import { wizardZhHans } from "./strings/wizard.zh-Hans.js";
import { romsZhHans } from "./strings/roms.zh-Hans.js";
import {
  advancedZhHans,
  officialFirmwareZhHans,
  romSectionZhHans,
  dumpSectionZhHans,
  flashSectionZhHans,
  eraseSectionZhHans,
  fileBrowserSectionZhHans,
  retroGoTabZhHans,
} from "./strings/firmwareSetup.zh-Hans.js";
import { sourcesZhHans } from "./strings/sources.zh-Hans.js";
import { registerLocale } from "./locale.svelte.js";

registerLocale("zh-Hans", {
  advanced: advancedZhHans,
  deviceHeader: deviceHeaderZhHans,
  landing: landingZhHans,
  officialFirmware: officialFirmwareZhHans,
  overview: overviewZhHans,
  overviewRail: overviewRailZhHans,
  roms: romsZhHans,
  romSection: romSectionZhHans,
  dumpSection: dumpSectionZhHans,
  flashSection: flashSectionZhHans,
  eraseSection: eraseSectionZhHans,
  fileBrowserSection: fileBrowserSectionZhHans,
  retroGoTab: retroGoTabZhHans,
  shared: sharedZhHans,
  sources: sourcesZhHans,
  wizard: wizardZhHans,
});
