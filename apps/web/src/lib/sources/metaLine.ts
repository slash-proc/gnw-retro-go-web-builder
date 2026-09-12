/**
 * The composition rule for a Sources row's one meta line.
 *
 * This lives here, not in `views/Sources.svelte`, so it can be tested: the rule it encodes is
 * the owner's and is easy to erode by accident. A Sources row says WHAT THE SOURCE GIVES YOU —
 * a core's systems and the extensions they list — and deliberately NEVER a count of
 * titles. We are not spending this real estate on counting.
 *
 * Pure and rune-free ON PURPOSE: no `$state`, no store import, no `locale`. Everything
 * language-dependent is resolved by the caller and handed in as already-localised text, so a
 * plain node test can import this module and pin the rule directly.
 *
 * Every string in `card` is untrusted third-party manifest text. Nothing here builds markup or
 * a path with it; the component interpolates the returned segments as text.
 */

/** The only shape of a card this module reads. `SourceCard` (store.svelte.ts) satisfies it. */
import { isCoreKind } from "./types.js";

export interface MetaLineCard {
  kind: string;
  systems: { longName: string }[];
  extensions: string[];
}

/**
 * Segment 0: the systems a core source declares, and the extensions they list — the
 * Repos artboard's `WonderSwan, WS Color · .ws .wsc`.
 *
 * Returns `undefined`, never `""`, for anything that has nothing to say: a homebrew card (it
 * already sits under the Homebrew heading), a card that has not resolved its systems yet, or
 * no card at all. An empty string would render a divider with nothing on either side.
 * Likewise a card with no extensions yields the systems alone, with no dangling divider.
 */
export function systemsSegment(card: MetaLineCard | undefined): string | undefined {
  if (card === undefined || !isCoreKind(card.kind) || card.systems.length === 0) return undefined;
  const systems = card.systems.map((s) => s.longName).join(", ");
  const exts = card.extensions.join(" ");
  return exts ? `${systems}\u00a0\u00b7\u00a0${exts}` : systems;
}

/**
 * The whole meta line, in order: what the source gives you, then any note about the row
 * itself, then the short factual notes. `originNote` and `facts` arrive already localised.
 * Segments that have nothing to say are dropped rather than emitted empty.
 */
export function metaSegments(
  card: MetaLineCard | undefined,
  originNote: string | undefined,
  facts: string[],
): string[] {
  const segments: string[] = [];
  const systems = systemsSegment(card);
  if (systems !== undefined) segments.push(systems);
  if (originNote !== undefined) segments.push(originNote);
  segments.push(...facts);
  return segments;
}
