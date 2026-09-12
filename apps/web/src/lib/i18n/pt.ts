// Portuguese locale assembler. Mirrors en.ts/de.ts's shape, built from strings/*.pt.ts (each
// created independently, never editing the source en/de files) and registers itself with
// locale.svelte.ts's registry — see registerLocales.ts for why this is a side-effect import
// rather than locale.svelte.ts importing this file directly (avoids a circular import).
//
// Base register is EUROPEAN Portuguese (pt-PT), which is what a bare `pt` conventionally
// means, with neutral wording preferred wherever a pt-PT term would read as wrong rather
// than merely foreign to a Brazilian reader.
import { deviceHeaderPt } from "./strings/deviceHeader.pt.js";
import { landingPt } from "./strings/landing.pt.js";
import { sharedPt } from "./strings/shared.pt.js";
import { overviewPt } from "./strings/overview.pt.js";
import { overviewRailPt } from "./strings/overviewRail.pt.js";
import { wizardPt } from "./strings/wizard.pt.js";
import { romsPt } from "./strings/roms.pt.js";
import {
  advancedPt,
  officialFirmwarePt,
  romSectionPt,
  dumpSectionPt,
  flashSectionPt,
  eraseSectionPt,
  fileBrowserSectionPt,
  retroGoTabPt,
} from "./strings/firmwareSetup.pt.js";
import { sourcesPt } from "./strings/sources.pt.js";
import { registerLocale } from "./locale.svelte.js";

registerLocale("pt", {
  advanced: advancedPt,
  deviceHeader: deviceHeaderPt,
  landing: landingPt,
  officialFirmware: officialFirmwarePt,
  overview: overviewPt,
  overviewRail: overviewRailPt,
  roms: romsPt,
  romSection: romSectionPt,
  dumpSection: dumpSectionPt,
  flashSection: flashSectionPt,
  eraseSection: eraseSectionPt,
  fileBrowserSection: fileBrowserSectionPt,
  retroGoTab: retroGoTabPt,
  shared: sharedPt,
  sources: sourcesPt,
  wizard: wizardPt,
});
