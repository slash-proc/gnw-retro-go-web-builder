/**
 * `$defs/subpath` from `schema/manifest.schema.json` (gwrg-dist-spec `61d3726`, "Let a homebrew
 * keep its data in a folder of its own").
 *
 * Two manifest fields use it: a target's `dataDir`, the folder a homebrew reads its data from
 * (OpenLara opens `/homebrews/openlara/TITLE.PKD`, and the folder name is compiled into the
 * binary), and an output's `subdir`, one level deeper still and relative to `dataDir`.
 *
 * Both become path SEGMENTS on the card, so this is the same class of untrusted input as a
 * filename and is validated the same way: spec/05-host says to "validate them as paths -- no
 * leading separator, no `..`, no empty segment -- and refuse rather than sanitising".
 *
 * A subpath differs from a filename in exactly one way: it MAY contain `/`, because it can be
 * more than one segment deep. Everything else is narrower than `$defs/filename` on purpose --
 * the schema restricts each segment to `[A-Za-z0-9 ._-]` starting with `[A-Za-z0-9_-]`, so a
 * leading dot, a trailing space and `..` are all unrepresentable rather than merely refused.
 */
const SUBPATH = /^[A-Za-z0-9_-][A-Za-z0-9 ._-]*(?:\/[A-Za-z0-9_-][A-Za-z0-9 ._-]*)*$/;

/** From `$defs/subpath`'s `maxLength`. */
const MAX_SUBPATH_CHARS = 100;

/**
 * True when `value` is a subpath this host will place a file under.
 *
 * Takes `unknown` because every caller reads it straight off a parsed manifest, and a type
 * check at the boundary is the point.
 */
export function isSubpath(value: unknown): value is string {
  if (typeof value !== "string") return false;
  if (value.length === 0 || value.length > MAX_SUBPATH_CHARS) return false;
  return SUBPATH.test(value);
}
