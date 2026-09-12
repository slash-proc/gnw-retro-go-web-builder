// systems.js — every platform ScreenScraper knows, as a local lookup.
//
// WHY THIS IS CHECKED IN. `SS_SYSTEM_MAP` (config.js) answers one question: which systemeid do
// we scrape for a folder we already support. This answers the other one: what CAN be scraped.
// It was inherited from CoverStudio with no way to ask, so a console the firmware gained later
// (gba, tama) silently had no cover source and nothing in the app could say so. New cores are
// in the works; adding one should be a lookup, not a research task.
//
// `systems.json` is a snapshot of `systemesListe.php` taken 2026-09-11 (250 systems). It is a
// SNAPSHOT, not a cache: no credentials, no network, safe to read at import. Refresh it with
// `node apps/web/scripts/fetch-ss-systems.mjs`, which is the only thing that talks to the API.
//
// Fields per row: `id` (the systemeid), `name`, `shortcodes` (ScreenScraper's own nom_recalbox
// and nom_retropie values, deduped), `extensions`, `type`, `company`.
import systems from "./systems.json";

export { systems };

/** One system by ScreenScraper id, or undefined. */
export function systemById(id) {
  const n = Number(id);
  return systems.find((s) => s.id === n);
}

/**
 * Every system publishing this folder shortcode, most-likely first.
 *
 * ScreenScraper publishes Recalbox and RetroPie folder names, so `gba` resolves on its own --
 * but Retro-Go uses its own short names for plenty of consoles (`md` where Recalbox says
 * `megadrive`), so a miss here is normal and means "needs an alias", not "unsupported".
 *
 * Arcade is the case to watch: ~55 systems publish the identical `arcade,mame,fba` shortcodes
 * because ScreenScraper splits arcade by MANUFACTURER, not by folder. They are returned with
 * the umbrella `Mame` entry first, since that is what a whole-cabinet library wants.
 */
export function systemsByShortcode(shortcode) {
  const q = String(shortcode).trim().toLowerCase();
  if (!q) return [];
  const hits = systems.filter((s) => s.shortcodes.includes(q));
  return hits.sort((a, b) => (a.name === "Mame" ? -1 : b.name === "Mame" ? 1 : a.id - b.id));
}

/** Free-text lookup over name, shortcode and extension, for "what is this core's system?". */
export function findSystems(query) {
  const q = String(query).trim().toLowerCase();
  if (!q) return [];
  if (/^\d+$/.test(q)) {
    const hit = systemById(q);
    return hit ? [hit] : [];
  }
  return systems.filter((s) =>
    s.name.toLowerCase().includes(q) ||
    s.shortcodes.some((c) => c.includes(q)) ||
    s.extensions.some((e) => e === q),
  );
}
