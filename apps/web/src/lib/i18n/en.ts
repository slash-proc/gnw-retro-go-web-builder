// Canonical English string table. Thin assembler over per-feature-area files in ./strings/ —
// each area file owns the canonical English for its area (one language per file: see de.ts,
// fr.ts, … for the sibling strings/<area>.<code>.ts translations).
import { deviceHeaderEn } from "./strings/deviceHeader.js";
import {
  advancedEn,
  officialFirmwareEn,
  romSectionEn,
  dumpSectionEn,
  flashSectionEn,
  eraseSectionEn,
  fileBrowserSectionEn,
  retroGoTabEn,
} from "./strings/firmwareSetup.js";
import { landingEn } from "./strings/landing.js";
import { overviewEn } from "./strings/overview.js";
import { overviewRailEn } from "./strings/overviewRail.js";
import { romsEn } from "./strings/roms.js";
import { sharedEn } from "./strings/shared.js";
import { sourcesEn } from "./strings/sources.js";
import { wizardEn } from "./strings/wizard.js";
import type { Widen } from "./widen.js";

export const en = {
  advanced: advancedEn,
  deviceHeader: deviceHeaderEn,
  landing: landingEn,
  officialFirmware: officialFirmwareEn,
  overview: overviewEn,
  overviewRail: overviewRailEn,
  roms: romsEn,
  romSection: romSectionEn,
  dumpSection: dumpSectionEn,
  flashSection: flashSectionEn,
  eraseSection: eraseSectionEn,
  fileBrowserSection: fileBrowserSectionEn,
  retroGoTab: retroGoTabEn,
  shared: sharedEn,
  sources: sourcesEn,
  wizard: wizardEn,
} as const;

// Widen the `as const` literal string/function-return types back to `string` so translated
// tables (e.g. de.ts) can hold different text while still being structurally checked against
// this shape (same keys, same function arities).
export type Strings = Widen<typeof en>;
