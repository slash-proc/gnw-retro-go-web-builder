// config.js — shared constants
import { systems } from "./systems.js";

export const API = "https://api.screenscraper.fr/api2/";

// App name sent to ScreenScraper alongside the dev credentials.
export const SOFTNAME = "CoverStudio";

// Single-media sources: <select> value -> ScreenScraper media type.
export const SINGLE_MEDIA = { ss: "ss", box: "box-2D" };

const _k = "9336163bb3255b523d175bb6b097294c42b92ebc656c2c14";
const _c = ["akpfQFREBFo=", "AXRYD2sHeA4DCwc="];
const _dec = (s) => {
  const d = atob(s);
  let o = "";
  for (let i = 0; i < d.length; i++) o += String.fromCharCode(d.charCodeAt(i) ^ _k.charCodeAt(i % _k.length));
  return o;
};
export const devCreds = () => ({ devid: _dec(_c[0]), devpassword: _dec(_c[1]) });

// Preferred regions when several variants of a media exist.
export const REGION_PREF = ["wor", "eu", "us", "jp", "fr", "ss"];

// Folder shortcode -> ScreenScraper systemeid.
//
// THE TABLE IS GONE. It was hand-written and inherited verbatim from CoverStudio, which is why
// `gba` and `tama` were missing and no cover could ever be scraped for them. `screenscraper/
// systems.js` derives the mapping from ScreenScraper's own `systemesListe.php` instead; what is
// still hand-written there is an ALIAS table of Retro-Go's short names to ScreenScraper names,
// never to ids. Re-exported here so every existing importer keeps working.
export { systemIdsFor, isKnownSystemFolder, systemSourceFor, allSystems } from "./systemMap.js";

// Systems for the manual picker (id = ScreenScraper systemeid), from the checked-in snapshot of
// the API's own list. Was a hand-curated 26 entries, which meant the offline picker showed a
// different world from the online one (`loadSystems` in run.js already fetched all 250 when it
// could). Now they are the same list.
export const SYSTEMS = systems
  .filter((s) => s.name)
  .map((s) => ({ id: s.id, name: s.name }))
  .sort((a, b) => a.name.localeCompare(b.name));

// Extensions that are NOT ROMs (covers, saves, configs…).
export const NON_ROM = new Set([
  ".png", ".jpg", ".jpeg", ".bmp", ".gif", ".img", ".keep", ".txt", ".crc",
  ".sav", ".state", ".sram", ".srm", ".bak", ".cfg", ".config", ".db", ".dat",
  ".lnk", ".xml", ".nfo",
]);

export const IMAGE_EXT = new Set([".png", ".jpg", ".jpeg", ".bmp"]);

// Skraper resource type -> ScreenScraper media type(s), in priority order.
export const RESOURCE_MAP = {
  Screenshot: ["ss"],
  ScreenshotTitle: ["sstitle"],
  Wheel: ["wheel", "wheel-hd"],
  WheelCarbon: ["wheel-carbon"],
  WheelSteel: ["wheel-steel"],
  Marquee: ["screenmarquee", "marquee"],
  Box3D: ["box-3D"],
  Box2D: ["box-2D"],
  Box2DBack: ["box-2D-back"],
  Box2DSide: ["box-2D-side"],
  Support: ["support-2D"],
  Fanart: ["fanart"],
  SystemWallPaper: ["fanart"],
};
