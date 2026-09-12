// systemMap.js — which ScreenScraper systems a Retro-Go ROM folder means.
//
// `systems.js` answers "what can ScreenScraper scrape". This answers the narrower question the
// scraper actually asks: given a folder called `gba` or `md`, which systemeids do we try, and in
// what order. It is POLICY over that data, kept in its own file so `systems.js` stays a pure
// snapshot reader (there is a test asserting it holds no fetch and no credentials; do not move
// any of this in there).
//
// WHY IT IS NOT A TABLE ANY MORE. `SS_SYSTEM_MAP` was hand-written and inherited verbatim from
// CoverStudio. `systemIdsFor` returns `[]` for anything absent, and an empty list means no cover
// can ever be scraped for that console -- silently. CoverStudio predates this firmware's GBA
// support, so `gba` and `tama` were simply missing: the Library listed the games and the scraper
// had nowhere to ask. Nothing failed; there was just never a cover.
//
// HOW DYNAMIC THIS ACTUALLY IS, measured against the committed 250-system snapshot rather than
// hoped: ScreenScraper publishes Recalbox and RetroPie folder names, and 9 of our 21 console
// folders match one outright. The other 12 need an alias, because Retro-Go says `md`, `pce`,
// `sms`, `a2600` where Recalbox says `megadrive`, `pcengine`, `mastersystem`, `atari2600`. So
// the honest claim is not "no table" -- it is that what remains ALIASES NAMES, never ids. Every
// id still comes from the snapshot, and a new core whose folder matches Recalbox naming needs no
// edit here at all.
//
// 46 of the 250 systems publish no shortcode whatsoever (Arcadia 2001, PC Win9X, PC Windows and
// others). Those can only ever be reached by an alias. That is the floor.

import { systems, systemsByShortcode } from "./systems.js";

/**
 * Retro-Go folder -> ordered ScreenScraper lookup terms.
 *
 * A term is a Recalbox/RetroPie shortcode or a ScreenScraper system NAME, resolved through the
 * snapshot -- never a raw id, so a system ScreenScraper renumbers still resolves, and a typo
 * fails loudly in the tests rather than silently scraping the wrong console.
 *
 * Two reasons an entry exists, and they are different:
 *
 *  1. NO SHORTCODE MATCHES. Retro-Go's name for the console is not one Recalbox or RetroPie
 *     uses. Most of this table, and pure translation.
 *  2. ORDER THE SNAPSHOT CANNOT EXPRESS. `systemIdsFor` returns candidates TRIED IN ORDER UNTIL
 *     A GAME IS FOUND, and the order is a fact about this firmware's folder layout: a `gb`
 *     folder routinely holds Game Boy Color games, and an `msx` folder is more often MSX2 than
 *     MSX1. ScreenScraper has no opinion about either, so we keep ours.
 *
 * `tama` belongs to case 1 with a detail worth recording: upstream, Tamagotchi's `nom_recalbox`
 * is the single letter "b". The data is not clean, which is the other reason a name is a safer
 * term than a shortcode wherever the two disagree.
 */
export const RETRO_GO_SYSTEMS = {
  // 1. Retro-Go's own short names. No Recalbox or RetroPie shortcode matches these.
  a2600: ["Atari 2600"],
  a7800: ["Atari 7800"],
  amstrad: ["amstradcpc", "CPC"],
  col: ["Colecovision"],
  gg: ["Game Gear"],
  md: ["Megadrive"],
  mini: ["Pokémon mini"],
  pce: ["PC Engine"],
  sg: ["SG-1000"],
  sg1000: ["SG-1000"],
  sms: ["Master System"],
  tama: ["Tamagotchi"],
  wsv: ["Watara Supervision"],
  // Folder spellings Retro-Go and its users write that no upstream field carries.
  sfc: ["Super Nintendo"],
  wswan: ["WonderSwan"],
  wswanc: ["WonderSwan Color"],
  turbor: ["MSX Turbo R"],
  msx2plus: ["MSX2+"],
  "msx2+": ["MSX2+"],
  // 2. Ordered preferences. Every term still resolves through the snapshot.
  gb: ["Game Boy", "Game Boy Color"],
  gbc: ["Game Boy Color", "Game Boy"],
  msx: ["MSX2", "MSX", "MSX2+", "MSX Turbo R"],
  nes: ["NES"],
  snes: ["Super Nintendo"],
};

/**
 * A type a ROM folder never means.
 *
 * `gb` as a Recalbox shortcode is claimed by Game Boy (9) AND by Super Game Boy (127) and Super
 * Game Boy 2 (128), both `type: "Accessory"`. Those are peripherals, not a console a folder of
 * ROMs belongs to, and every extra candidate costs a ScreenScraper request per ROM that misses,
 * against a quota.
 *
 * Applied to SHORTCODE matches only. An alias that names an accessory outright still finds it,
 * because then someone meant it.
 */
const NOT_A_CONSOLE = new Set(["Accessory"]);

const norm = (s) => String(s == null ? "" : s).trim().toLowerCase();

/** Systems whose NAME is exactly this term. */
function byName(term) {
  const q = norm(term);
  return systems.filter((s) => norm(s.name) === q).map((s) => s.id);
}

/**
 * One lookup term -> ids, NAME FIRST.
 *
 * An alias is authored here and names one specific system, so the exact name wins. Upstream
 * shortcodes are shared and fuzzy: `megadrive` is claimed by Megadrive (1) and by a Sonic romhack
 * collection; `msx2` by MSX2 (116) and by MSX2+ (117), whose `nom_recalbox` is "msx,msx2".
 * Name-first is what resolves "MSX2" to 116 alone and so preserves the deliberate MSX ordering.
 */
function idsForTerm(term) {
  const named = byName(term);
  if (named.length) return named;
  return systemsByShortcode(term)
    .filter((s) => !NOT_A_CONSOLE.has(s.type))
    .map((s) => s.id);
}

/**
 * Folder shortcode -> ordered candidate systemeids, tried in order until a game is found.
 * `[]` for a folder no rule resolves, exactly the contract the hand table had.
 */
export function systemIdsFor(shortcode) {
  return resolve(shortcode).ids;
}

/** Which rule answered: "alias", "shortcode" or "none". Diagnostic, and what the tests assert. */
export function systemSourceFor(shortcode) {
  return resolve(shortcode).source;
}

/** True when this folder resolves to at least one system. Replaces `SS_SYSTEM_MAP[seg]`. */
export function isKnownSystemFolder(shortcode) {
  return systemIdsFor(shortcode).length > 0;
}

function resolve(shortcode) {
  const key = norm(shortcode);
  if (!key) return { ids: [], source: "none" };
  const terms = RETRO_GO_SYSTEMS[key];
  if (terms) {
    const ids = [];
    for (const t of terms) for (const id of idsForTerm(t)) if (!ids.includes(id)) ids.push(id);
    if (ids.length) return { ids, source: "alias" };
  }
  // `systemsByShortcode` already puts the umbrella `Mame` entry first, which is what an `arcade`
  // folder wants: ~55 systems publish the identical arcade/mame/fba shortcodes because
  // ScreenScraper splits arcade by MANUFACTURER, and no shortcode can disambiguate them.
  const direct = systemsByShortcode(key)
    .filter((s) => !NOT_A_CONSOLE.has(s.type))
    .map((s) => s.id);
  if (direct.length) return { ids: direct, source: "shortcode" };
  return { ids: [], source: "none" };
}

/** Every system, for the manual picker. Sorted by name. */
export function allSystems() {
  return systems
    .filter((s) => s.id && s.name)
    .map((s) => ({ id: s.id, name: s.name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
