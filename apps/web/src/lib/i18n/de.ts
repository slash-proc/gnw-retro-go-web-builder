// German string table. Thin assembler over per-feature-area files in ./strings/ — each area
// file's `Strings`-like type keeps its own DE export checked against its own slice's shape.
import { deviceHeaderDe } from "./strings/deviceHeader.js";
import {
  advancedDe,
  officialFirmwareDe,
  romSectionDe,
  dumpSectionDe,
  flashSectionDe,
  eraseSectionDe,
  fileBrowserSectionDe,
  retroGoTabDe,
  expertCornerDe,
  deferredSectionDe,
} from "./strings/firmwareSetup.js";
import { landingDe } from "./strings/landing.js";
import { overviewDe } from "./strings/overview.js";
import { romsDe } from "./strings/roms.js";
import { sharedDe } from "./strings/shared.js";
import { wizardDe } from "./strings/wizard.js";
import type { Strings } from "./en.js";

export const de: Strings = {
  advanced: advancedDe,
  deviceHeader: deviceHeaderDe,
  landing: landingDe,
  officialFirmware: officialFirmwareDe,
  overview: overviewDe,
  roms: romsDe,
  romSection: romSectionDe,
  dumpSection: dumpSectionDe,
  flashSection: flashSectionDe,
  eraseSection: eraseSectionDe,
  fileBrowserSection: fileBrowserSectionDe,
  retroGoTab: retroGoTabDe,
  expertCorner: expertCornerDe,
  deferredSection: deferredSectionDe,
  shared: sharedDe,
  wizard: wizardDe,
};
