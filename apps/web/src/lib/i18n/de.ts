// German locale assembler. Mirrors en.ts's shape, built from strings/*.de.ts (one language
// per file, exactly like es/fr/ja/ko/pl) — the English source files own the shared
// `Widen<...>` types each DE export is structurally checked against.
import { deviceHeaderDe } from "./strings/deviceHeader.de.js";
import {
  advancedDe,
  officialFirmwareDe,
  romSectionDe,
  dumpSectionDe,
  flashSectionDe,
  eraseSectionDe,
  fileBrowserSectionDe,
  retroGoTabDe,
} from "./strings/firmwareSetup.de.js";
import { landingDe } from "./strings/landing.de.js";
import { overviewDe } from "./strings/overview.de.js";
import { overviewRailDe } from "./strings/overviewRail.de.js";
import { romsDe } from "./strings/roms.de.js";
import { sharedDe } from "./strings/shared.de.js";
import { sourcesDe } from "./strings/sources.de.js";
import { wizardDe } from "./strings/wizard.de.js";
import type { Strings } from "./en.js";

export const de: Strings = {
  advanced: advancedDe,
  deviceHeader: deviceHeaderDe,
  landing: landingDe,
  officialFirmware: officialFirmwareDe,
  overview: overviewDe,
  overviewRail: overviewRailDe,
  roms: romsDe,
  romSection: romSectionDe,
  dumpSection: dumpSectionDe,
  flashSection: flashSectionDe,
  eraseSection: eraseSectionDe,
  fileBrowserSection: fileBrowserSectionDe,
  retroGoTab: retroGoTabDe,
  shared: sharedDe,
  sources: sourcesDe,
  wizard: wizardDe,
};
