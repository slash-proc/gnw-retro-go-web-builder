/**
 * Why the net change is the number it is.
 *
 * THE BUG THIS EXISTS FOR. The dock's net change is one subtraction of two whole-image
 * lengths -- `newFrogfsLen - currentFrogfsLen` -- and when it comes out wrong there is nothing
 * to look at. The owner saw `-0.18 MB` on a fresh install, then `+19.36 MB` moments later on
 * the same device, and neither figure could say which files it was talking about.
 *
 * So this decomposes the same subtraction into terms that name themselves:
 *
 *     net = (sum of per-file deltas) + (overhead delta)
 *
 * Both sides are exact byte counts of the same kind, which is what makes the comparison fair:
 * the device side is the image's own `bin_sz` header (`engine/fsscan.ts` reads it at +8) and
 * every file's `dataSize` from the real FrogFS parse; the built side is the image length and
 * `plan.frogfsFiles`. Neither is a declared-name list or an estimate.
 *
 * OVERHEAD IS A REAL TERM, not a rounding fudge. A FrogFS image is an index plus a data
 * section, and the index grows with the number of files while the data section carries
 * alignment padding. Two images holding byte-identical files can therefore differ in total
 * length. Folding that into the per-file numbers would hide exactly the case that produces a
 * small unexplained delta, so it is reported separately and the identity above always holds.
 *
 * Pure and importless, so a node suite can drive it.
 */

/** One file on either side, as that side spells it. */
export interface DiffFile {
  path: string;
  size: number;
}

/** One category's before/after, where a category is a top-level directory. */
export interface CategoryDelta {
  category: string;
  beforeBytes: number;
  afterBytes: number;
  beforeFiles: number;
  afterFiles: number;
  deltaBytes: number;
}

export interface FrogfsDiff {
  /** The device image's own declared total. */
  beforeTotal: number;
  /** The built image's length. */
  afterTotal: number;
  /** What the dock renders: `afterTotal - beforeTotal`. */
  net: number;
  /** Sum of every category's `deltaBytes`. */
  fileDelta: number;
  /**
   * `net - fileDelta`: index and padding, the part no file accounts for.
   *
   * A non-zero value here with no file changes is the signature of a rebuild that produced the
   * same content in a different shape, which is a very different problem from a file appearing
   * or disappearing, and the two are indistinguishable in the single number the dock shows.
   */
  overheadDelta: number;
  categories: CategoryDelta[];
  /** Paths on the device that the build does not produce. */
  onlyBefore: string[];
  /** Paths the build produces that are not on the device. */
  onlyAfter: string[];
  /** Paths on both sides whose size changed. */
  resized: { path: string; before: number; after: number }[];
}

/**
 * The category a path belongs to.
 *
 * Top-level directory, except under `roms/`, where the system is the useful unit -- "roms" as
 * one bucket would put every console together and say nothing about which one moved. A path
 * with no directory at all is reported under `(root)` rather than being dropped, because a
 * stray file at the image root is itself worth seeing.
 */
export function categoryOf(path: string): string {
  const parts = path.split("/").filter((p) => p !== "");
  if (parts.length <= 1) return "(root)";
  if (parts[0] === "roms" && parts.length >= 3) return `roms/${parts[1]}`;
  return parts[0]!;
}

/** Last-write-wins by path, so a side listing one path twice cannot double-count it. */
function index(files: readonly DiffFile[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const f of files) out.set(f.path, f.size);
  return out;
}

/**
 * Decompose the dock's subtraction.
 *
 * `cap` bounds each name list so one log line cannot become unreadable when a whole library
 * differs; the counts in `categories` stay exact regardless of it.
 */
export function diffFrogfs(
  before: { total: number; files: readonly DiffFile[] },
  after: { total: number; files: readonly DiffFile[] },
  cap = 12,
): FrogfsDiff {
  const b = index(before.files);
  const a = index(after.files);

  const cats = new Map<string, CategoryDelta>();
  const at = (path: string): CategoryDelta => {
    const key = categoryOf(path);
    let c = cats.get(key);
    if (!c) {
      c = { category: key, beforeBytes: 0, afterBytes: 0, beforeFiles: 0, afterFiles: 0, deltaBytes: 0 };
      cats.set(key, c);
    }
    return c;
  };

  for (const [path, size] of b) {
    const c = at(path);
    c.beforeBytes += size;
    c.beforeFiles += 1;
  }
  for (const [path, size] of a) {
    const c = at(path);
    c.afterBytes += size;
    c.afterFiles += 1;
  }
  for (const c of cats.values()) c.deltaBytes = c.afterBytes - c.beforeBytes;

  const onlyBefore: string[] = [];
  const onlyAfter: string[] = [];
  const resized: { path: string; before: number; after: number }[] = [];
  for (const [path, size] of b) {
    const other = a.get(path);
    if (other === undefined) onlyBefore.push(path);
    else if (other !== size) resized.push({ path, before: size, after: other });
  }
  for (const path of a.keys()) if (!b.has(path)) onlyAfter.push(path);

  const fileDelta = [...cats.values()].reduce((n, c) => n + c.deltaBytes, 0);
  const net = after.total - before.total;

  return {
    beforeTotal: before.total,
    afterTotal: after.total,
    net,
    fileDelta,
    // The identity `net = fileDelta + overheadDelta` is what makes this decomposition
    // trustworthy: whatever the files do not explain is named rather than lost.
    overheadDelta: net - fileDelta,
    categories: [...cats.values()].sort((x, y) => Math.abs(y.deltaBytes) - Math.abs(x.deltaBytes)),
    onlyBefore: onlyBefore.sort().slice(0, cap),
    onlyAfter: onlyAfter.sort().slice(0, cap),
    resized: resized.sort((x, y) => Math.abs(y.after - y.before) - Math.abs(x.after - x.before)).slice(0, cap),
  };
}

/** Categories that actually moved, which is all a log line needs. */
export function movedCategories(diff: FrogfsDiff): CategoryDelta[] {
  return diff.categories.filter((c) => c.deltaBytes !== 0);
}
