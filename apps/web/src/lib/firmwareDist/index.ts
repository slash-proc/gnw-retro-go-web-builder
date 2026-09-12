/**
 * Client for the Retro-Go SD firmware distribution format.
 *
 * The contract is `docs/FIRMWARE_DIST.md` in game-and-watch-retro-go-sd — the firmware's own
 * distribution standard, a SIBLING of the GWRG spec that `src/lib/sources/` speaks rather than
 * a `kind` inside it. This module is parsing, discovery and verified extraction only: no UI, no device access, and
 * everything it returns is untrusted third-party text to render, never to interpolate into a
 * path.
 *
 * Fixtures for the format live in `apps/web/test/fixtures/firmwaredist/`; see the SOURCE note
 * there before changing anything in here.
 */
export * from "./types.js";
export * from "./parse.js";
export * from "./client.js";
export * from "./curated.js";
export * from "./select.js";
export * from "./extract.js";
export * from "./compare.js";
export * from "./installMarker.js";
export * from "./memo.js";
