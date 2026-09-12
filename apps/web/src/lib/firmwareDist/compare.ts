/**
 * Reinstall-vs-upgrade: comparing the firmware version a device is running against the
 * versions the release index publishes.
 *
 * WHY THIS IS NOT A SHA REGEX. The first implementation pulled a 7-hex commit sha off the end
 * of both strings (`/g?([0-9a-f]{7})[0-9a-f]*$/`) and called them different if the shas
 * differed. That only ever worked because every tag happened to be a `git describe` suffix like
 * `v1.4.1-44-g5dc98285`. The moment a real release tag shipped — `v2.0.0-rc1` — nothing parsed,
 * `hasUpdate` went permanently false, and the UI offered "Reinstall" against every device.
 *
 * The distribution format publishes exactly what SAMENESS needs. `docs/FIRMWARE_DIST.md`
 * ("Compatibility" → "`gitTag`"): the baked version string is "stored verbatim in
 * `/data/INSTALL` and published verbatim in the manifest, so the two byte-compare with no
 * normalisation on either side". So same-or-different is STRING EQUALITY, never parsing.
 *
 * The one normalisation below is not a version parse. `engine/intflashscan.ts`'s `retroGoInfo()`
 * reads the baked string out of the image and keeps only its version token, dropping the
 * `"Retro-Go "` / `"Retro-Go SD "` fork-name prefix (it reports that prefix separately, as
 * `retroGoIsSdFork`). `device.banks[].retroGoVersion` is therefore `"v2.0.0-rc1"` where the
 * manifest's `gitTag` is `"Retro-Go SD v2.0.0-rc1"`. `versionToken()` strips exactly that same
 * prefix off the published side so the two halves that DO exist on both sides compare byte for
 * byte.
 *
 * The same doc is equally explicit that `gitTag` must NOT become a compatibility check — that
 * rests entirely on `providesAbi`. A reinstall/upgrade label is the whole sanctioned use; do
 * not let anything else start gating on these functions.
 *
 * ORDERING, in two tiers.
 *
 *   1. POSITION in the published index. `versions.json` is newest-first and says so, so when
 *      the index lists BOTH versions their positions are a total order that needs no
 *      interpretation. This tier is published fact and always wins.
 *
 *   2. PARSING the tag, used ONLY when the index cannot place one or both. The index retains a
 *      handful of releases; a device on an older build has a version that has aged out, which
 *      is the single most common real upgrade case. Refusing to order it — as this file did at
 *      first, over-correcting from the sha-regex failure above — answered "unknown" and offered
 *      "Reinstall" to exactly the users with the most to gain from upgrading. One bad regex did
 *      not prove ordering is unknowable.
 *
 * THE TRAP IN TIER 2. These tags are `git describe` output over semver-ish tags, and the two
 * hyphen suffixes mean OPPOSITE things:
 *
 *   `v1.4.1-44-g5dc98285`  = 44 commits AFTER v1.4.1  -> NEWER than `v1.4.1`
 *   `v2.0.0-rc1`           = a prerelease OF v2.0.0   -> OLDER than `v2.0.0`
 *
 * A stock semver comparison reads both as prereleases and gets the first one backwards, which
 * would report a downgrade to every user on a describe build. They are parsed as distinct
 * fields here for that reason.
 *
 * Anything tier 2 cannot read stays `"unknown"`, and `"unknown"` is never an upgrade: a
 * malformed or unrecognised tag must not be guessed at by string ordering.
 */

/** Where a target version sits relative to what the device is running. */
export type VersionRelation = "same" | "newer" | "older" | "unknown";

/** `"Retro-Go SD v2.0.0-rc1"` and `"Retro-Go v2.0.0-rc1"` both → `"v2.0.0-rc1"`. */
const FORK_PREFIX = /^Retro-Go(?: SD)? +/;

/**
 * The comparable part of a baked version string: the published `gitTag` minus the fork-name
 * prefix the device-side scanner already drops. `""` for anything absent or empty, and `""`
 * never compares equal to anything (see `sameVersion`).
 */
export function versionToken(v: string | null | undefined): string {
  if (!v) return "";
  return v.replace(FORK_PREFIX, "").trim();
}

/** True when both sides name a version AND it is the same one. */
export function sameVersion(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = versionToken(a);
  return x !== "" && x === versionToken(b);
}

/**
 * A tag this code can order. `release` is the dotted numeric part; `rc` is a `-rc<N>`
 * PRERELEASE (absent sorts ABOVE any rc, because the real release follows its candidates); and
 * `commits` is the `-<N>-g<sha>` describe distance (more commits sorts ABOVE, because they come
 * after the tag). See the header for why those two suffixes cannot share one field.
 */
interface ParsedVersion {
  release: number[];
  rc: number | null;
  commits: number;
}

/** `v1.4.1`, `1.4.1`, `v2.0`, `v1.2.3.4` — an optional `v` and two or more dotted numbers. */
const RELEASE = /^v?(\d+(?:\.\d+)+)/;
/** `-rc3`, `-rc.3` — a genuine prerelease of the release that follows it. */
const RC = /^-rc\.?(\d+)/;
/** `-44-g5dc98285` — git describe's "commits since the tag, and the sha we landed on". */
const DESCRIBE = /^-(\d+)-g[0-9a-f]+/i;
/** `git describe --dirty` leaves a marker; it says nothing about ordering, so it is ignored. */
const DIRTY = /^(?:\+|-dirty)$/;

/**
 * Parse a version token, or `null` when this code cannot read it. `null` is not a failure to be
 * papered over — it is the honest answer that produces `"unknown"` rather than a guess.
 */
function parseVersion(token: string): ParsedVersion | null {
  const rel = RELEASE.exec(token);
  if (!rel) return null;
  const release = rel[1].split(".").map((n) => Number.parseInt(n, 10));
  if (release.some((n) => !Number.isFinite(n))) return null;

  let rest = token.slice(rel[0].length);
  let rc: number | null = null;
  let commits = 0;

  const rcMatch = RC.exec(rest);
  if (rcMatch) {
    rc = Number.parseInt(rcMatch[1], 10);
    rest = rest.slice(rcMatch[0].length);
  }

  const describeMatch = DESCRIBE.exec(rest);
  if (describeMatch) {
    commits = Number.parseInt(describeMatch[1], 10);
    rest = rest.slice(describeMatch[0].length);
  }

  // Anything left over is a shape this code does not claim to understand (`v0.9.0-handbuilt`,
  // a branch name, a vendor suffix). Refuse rather than order two tags on the half we happened
  // to recognise.
  if (rest !== "" && !DIRTY.test(rest)) return null;
  return { release, rc, commits };
}

/** -1 / 0 / +1 for `a` older / same / newer than `b`, or `null` when either side is unreadable. */
function compareVersions(a: string, b: string): number | null {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (!pa || !pb) return null;

  const width = Math.max(pa.release.length, pb.release.length);
  for (let i = 0; i < width; i++) {
    // A missing component is zero: `v2.0` and `v2.0.0` are the same release.
    const d = (pa.release[i] ?? 0) - (pb.release[i] ?? 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }

  // No rc means the release itself, which comes AFTER all of its candidates.
  if (pa.rc !== pb.rc) {
    if (pa.rc === null) return 1;
    if (pb.rc === null) return -1;
    return pa.rc < pb.rc ? -1 : 1;
  }

  if (pa.commits !== pb.commits) return pa.commits < pb.commits ? -1 : 1;
  return 0;
}

/**
 * Where `targetGitTag` sits relative to `installed`.
 *
 * @param installed       `device.banks[].retroGoVersion` — the token read out of the image.
 * @param targetGitTag    the candidate release's published `gitTag` (or its token).
 * @param orderedGitTags  every `gitTag` the index lists, in the index's published order
 *                        (newest first). When it holds BOTH versions, position decides.
 */
export function versionRelation(
  installed: string | null | undefined,
  targetGitTag: string | null | undefined,
  orderedGitTags: readonly string[],
): VersionRelation {
  const inst = versionToken(installed);
  const target = versionToken(targetGitTag);
  if (inst === "" || target === "") return "unknown";
  if (inst === target) return "same";

  // Tier 1: published position, when the index places both.
  const tokens = orderedGitTags.map(versionToken);
  const iInst = tokens.indexOf(inst);
  const iTarget = tokens.indexOf(target);
  if (iInst >= 0 && iTarget >= 0) return iTarget < iInst ? "newer" : "older";

  // Tier 2: parse. This is the aged-out-of-the-index case — the owner running
  // `v1.4.1-44-g5dc98285` while the index retains only back to `v1.4.1-130-g3447670e`.
  const cmp = compareVersions(inst, target);
  if (cmp === null) return "unknown";
  if (cmp === 0) {
    // Two spellings that parse alike but are not byte-equal (`v1.4.1` vs `1.4.1`). Sameness is
    // string equality by the doc, so this cannot be `"same"`; neither is ahead, so it is
    // certainly not an upgrade.
    return "unknown";
  }
  return cmp < 0 ? "newer" : "older";
}

/** The reinstall-vs-upgrade question itself: only a version AHEAD of the installed one. */
export function isUpgrade(
  installed: string | null | undefined,
  targetGitTag: string | null | undefined,
  orderedGitTags: readonly string[],
): boolean {
  return versionRelation(installed, targetGitTag, orderedGitTags) === "newer";
}

/**
 * Which of the three install-pane titles a surface should show.
 *
 * This exists so the guided Wizard and the Advanced rail cannot answer the reinstall-vs-upgrade
 * question differently. They did: the Wizard was wired to `versionRelation` while
 * `advanced/FirmwareRail.svelte` asked only "is anything installed at all", a BINARY test with
 * no version awareness — so a device on a build older than anything the index retains was
 * offered "Reinstall" there forever, no matter what this file concluded. A shared rule is the
 * only thing that keeps two surfaces honest about one question.
 *
 * `installed` is the device's baked version string (`device.banks[].retroGoVersion`); its
 * truthiness IS "something is installed", which is exactly the test the rail already made.
 * Everything else defers to `isUpgrade`, so `"same"`, `"older"` and `"unknown"` all read
 * "reinstall" — `"unknown"` deliberately included, because an upgrade we cannot demonstrate
 * must not be promised.
 */
export type InstallTitleState = "install" | "upgrade" | "reinstall";

export function installTitleState(
  installed: string | null | undefined,
  newestGitTag: string | null | undefined,
  orderedGitTags: readonly string[],
): InstallTitleState {
  if (!installed) return "install";
  return isUpgrade(installed, newestGitTag, orderedGitTags) ? "upgrade" : "reinstall";
}

/**
 * The same question asked of a version the USER picked, rather than of the newest one.
 *
 * `installTitleState` above answers "what does this surface call the install action", and it asks
 * only about `versions[0]` because that is the only version those surfaces offer. The install
 * modal now offers a picker, so the action it is about to perform depends on which release is
 * selected -- and going BACKWARDS is a real answer that `installTitleState` cannot give, because
 * it folds `"older"` into `"reinstall"` along with everything else that is not an upgrade.
 *
 * One control, four faces: the picker and the button are the same elements in the same place and
 * only the verb changes. Nothing else about the modal differs between them.
 *
 * `"unknown"` stays `"reinstall"`, exactly as `isUpgrade` has it: a relation we cannot
 * demonstrate must not be dressed up as either direction. A downgrade we cannot prove is not a
 * downgrade, and saying so would be a claim about an ordering this index could not establish.
 */
export type VersionActionFace = InstallTitleState | "downgrade";

export function versionActionFace(
  installed: string | null | undefined,
  selectedGitTag: string | null | undefined,
  orderedGitTags: readonly string[],
): VersionActionFace {
  if (!installed) return "install";
  switch (versionRelation(installed, selectedGitTag, orderedGitTags)) {
    case "newer":
      return "upgrade";
    case "older":
      return "downgrade";
    default:
      return "reinstall";
  }
}
