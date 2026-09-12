// Traditional Chinese (Taiwan) locale assembler. Mirrors en.ts/de.ts's shape, built from
// strings/*.zh-Hant.ts (each created independently, never editing the source en/de files) and
// registers itself with locale.svelte.ts's registry — see registerLocales.ts for why this is a
// side-effect import rather than locale.svelte.ts importing this file directly (avoids a
// circular import).
import { deviceHeaderZhHant } from "./strings/deviceHeader.zh-Hant.js";
import { landingZhHant } from "./strings/landing.zh-Hant.js";
import { sharedZhHant } from "./strings/shared.zh-Hant.js";
import { overviewZhHant } from "./strings/overview.zh-Hant.js";
import { overviewRailZhHant } from "./strings/overviewRail.zh-Hant.js";
import { wizardZhHant } from "./strings/wizard.zh-Hant.js";
import { romsZhHant } from "./strings/roms.zh-Hant.js";
import {
  advancedZhHant,
  officialFirmwareZhHant,
  romSectionZhHant,
  dumpSectionZhHant,
  flashSectionZhHant,
  eraseSectionZhHant,
  fileBrowserSectionZhHant,
  retroGoTabZhHant,
} from "./strings/firmwareSetup.zh-Hant.js";
import { sourcesZhHant } from "./strings/sources.zh-Hant.js";
import { registerLocale } from "./locale.svelte.js";

registerLocale("zh-Hant", {
  advanced: advancedZhHant,
  deviceHeader: deviceHeaderZhHant,
  landing: landingZhHant,
  officialFirmware: officialFirmwareZhHant,
  overview: overviewZhHant,
  overviewRail: overviewRailZhHant,
  roms: romsZhHant,
  romSection: romSectionZhHant,
  dumpSection: dumpSectionZhHant,
  flashSection: flashSectionZhHant,
  eraseSection: eraseSectionZhHant,
  fileBrowserSection: fileBrowserSectionZhHant,
  retroGoTab: retroGoTabZhHant,
  shared: sharedZhHant,
  sources: sourcesZhHant,
  wizard: wizardZhHant,
});
