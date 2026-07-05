// Spanish locale assembler. Mirrors en.ts/de.ts/fr.ts/ja.ts/ko.ts's shape, built from
// strings/*.es.ts (each created independently, never editing the source en/de files) and
// registers itself with locale.svelte.ts's registry — see registerLocales.ts for why this is
// a side-effect import rather than locale.svelte.ts importing this file directly (avoids a
// circular import).
import { deviceHeaderEs } from "./strings/deviceHeader.es.js";
import { landingEs } from "./strings/landing.es.js";
import { sharedEs } from "./strings/shared.es.js";
import { overviewEs } from "./strings/overview.es.js";
import { wizardEs } from "./strings/wizard.es.js";
import { romsEs } from "./strings/roms.es.js";
import {
  advancedEs,
  officialFirmwareEs,
  romSectionEs,
  dumpSectionEs,
  flashSectionEs,
  eraseSectionEs,
  fileBrowserSectionEs,
  retroGoTabEs,
  expertCornerEs,
  deferredSectionEs,
} from "./strings/firmwareSetup.es.js";
import { registerLocale } from "./locale.svelte.js";

registerLocale("es", {
  advanced: advancedEs,
  deviceHeader: deviceHeaderEs,
  landing: landingEs,
  officialFirmware: officialFirmwareEs,
  overview: overviewEs,
  roms: romsEs,
  romSection: romSectionEs,
  dumpSection: dumpSectionEs,
  flashSection: flashSectionEs,
  eraseSection: eraseSectionEs,
  fileBrowserSection: fileBrowserSectionEs,
  retroGoTab: retroGoTabEs,
  expertCorner: expertCornerEs,
  deferredSection: deferredSectionEs,
  shared: sharedEs,
  wizard: wizardEs,
});
