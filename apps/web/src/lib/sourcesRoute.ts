/**
 * The Sources tab's URL sub-route: everything after `#sources/`.
 *
 * Before this existed, the ENTIRE Sources tab — which rail pane is showing, which source is
 * selected, and the full-page add/configure view that REPLACES the list — lived in component
 * `$state` and appeared nowhere in the URL. `#sources` was the only address the tab had, so
 * Back from a source's config page could not return to the list even in principle: there was
 * no earlier URL to return to. That is the owner's actual reported case, so the route is the
 * fix, not just push-vs-replace on the tab strip.
 *
 * Grammar (`|` = alternatives, `<…>` = a value):
 *
 *   <pane>                     the pane's list
 *   <pane>/add                 the add-a-source / add-a-folder page
 *   <pane>/<id>                a row selected in the list
 *   <pane>/<id>/config         that row's configure page
 *
 * `<id>` is a repo ("owner/name", which CONTAINS a slash) for the remote panes and a local
 * folder id for the local ones, so it is parsed as "everything between the pane and an
 * optional trailing `config`" rather than by splitting on `/` and counting. `add` and
 * `config` are therefore reserved words in the id position; neither a GitHub repo path
 * ("owner/name" is always two segments) nor a generated folder id can collide with them.
 *
 * Kept pure and free of runes so it is directly testable — `test/history.mjs`. Nothing in
 * this repo's node suites can observe a Svelte effect re-running, so the routing DECISION
 * lives here, in a function, and the component only applies it.
 */

export const SOURCE_PANE_IDS = [
  // The SD card sits FIRST among the local entries, above Directories, and holds exactly one
  // selection rather than a list. See docs/design/proposals/sd-source/.
  "local-sd",
  "local-directories",
  "local-cache",
  "remote-cores",
  "remote-homebrew",
] as const;

/** The Sources tab's rail entries — three local (SD card, directories, cache) and two remote. */
export type SourcePaneId = (typeof SOURCE_PANE_IDS)[number];

/** The pane the tab opens on with no sub-route at all. */
export const DEFAULT_SOURCE_PANE: SourcePaneId = "remote-cores";

/**
 * Does this pane list a REMOTE catalogue?
 *
 * A POSITIVE FACT ABOUT THE PANE, derived from its own id, because the alternative has already
 * failed once. `Sources.svelte` guarded its remote chrome with `!isLocal && !isCache`, two
 * EXACT-ID tests, so `local-sd` matched neither and fell through to the remote branch: it drew
 * `Update all` and `Add` over a card with no catalogue to refresh and no second card to add,
 * titled itself `Homebrew` off the end of a title chain, and resolved a `remoteKind` of `core`
 * that `Update all` would have acted on.
 *
 * Every id in the table above carries its group in its prefix, so asking the prefix is asking
 * the pane rather than reciting a list, and a local pane added tomorrow is right by
 * construction instead of being the next thing to fall through.
 */
export function isRemotePane(p: SourcePaneId): boolean {
  return p.startsWith("remote-");
}

/** The full-page view stacked over a pane's list, if any. */
export type SourcePage = "none" | "add" | "config";

export type SourcesRoute = {
  pane: SourcePaneId;
  /** The selected row's id — repo for the remote panes, folder id for the local ones. */
  selected: string | null;
  page: SourcePage;
};

/** `decodeURI` throws on a malformed `%` sequence, and the hash is user-editable text. */
function safeDecode(v: string): string {
  try {
    return decodeURI(v);
  } catch {
    return v;
  }
}

function isPane(v: string): v is SourcePaneId {
  return (SOURCE_PANE_IDS as readonly string[]).includes(v);
}

/** The route a fresh, untouched Sources tab is on. */
export function defaultSourcesRoute(): SourcesRoute {
  return { pane: DEFAULT_SOURCE_PANE, selected: null, page: "none" };
}

export function serializeSourcesRoute(r: SourcesRoute): string {
  if (r.page === "add") return `${r.pane}/add`;
  if (!r.selected) return r.pane;
  // `encodeURI`, not `encodeURIComponent`: a repo id is "owner/name" and that slash is part
  // of the grammar above, not a character to escape.
  return `${r.pane}/${encodeURI(r.selected)}${r.page === "config" ? "/config" : ""}`;
}

/**
 * Parse a sub-route. Anything unrecognised falls back to the default route rather than
 * throwing: the hash is user-editable text, and a typo must land on a usable tab.
 */
export function parseSourcesRoute(raw: string): SourcesRoute {
  const trimmed = raw.replace(/^\/+|\/+$/g, "");
  if (!trimmed) return defaultSourcesRoute();
  const slash = trimmed.indexOf("/");
  const pane = slash === -1 ? trimmed : trimmed.slice(0, slash);
  if (!isPane(pane)) return defaultSourcesRoute();
  let rest = slash === -1 ? "" : trimmed.slice(slash + 1);
  if (!rest) return { pane, selected: null, page: "none" };
  if (rest === "add") return { pane, selected: null, page: "add" };
  let page: SourcePage = "none";
  if (rest.endsWith("/config")) {
    page = "config";
    rest = rest.slice(0, -"/config".length);
  }
  if (!rest) return { pane, selected: null, page: "none" };
  return { pane, selected: safeDecode(rest), page };
}
