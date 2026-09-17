/**
 * Step 1 of the install order: **fetch and verify**, then extract
 * (`docs/FIRMWARE_DIST.md` in game-and-watch-retro-go-sd, "Installing").
 *
 * The doc's rule, in order:
 *   1. Check `bundle.sha256` BEFORE opening the archive. A bundle whose bytes do not match
 *      is refused, not unpacked — the zip reader never sees it.
 *   2. Check the `sha256` of every `image` and `content[]` entry AFTER
 *      extracting.
 *   3. Hashes are lowercase hex over the raw file bytes.
 *
 * The distinction the doc calls the easiest mistake to make holds throughout: extraction
 * reads `path` (the entry inside the bundle zip) and NEVER `install` (where the bytes land on
 * the device). `install` is carried through on the result untouched, for a later step to act
 * on; nothing here joins it onto anything.
 *
 *  * Nothing here writes to a device or a card, patches a superblock, or touches
 * `/data/INSTALL`. It reuses `src/lib/unzip.ts` (the in-browser zip reader `artifacts.ts`
 * already uses) and `sources/blobCache.ts`'s `blobKey()` for the digest, so there is exactly
 * one sha256 helper in the app. Both are injectable, for tests and for a future worker.
 *
 * A refusal is a typed value carrying its evidence, matching `select.ts` — not a thrown
 * string. There are no user-visible strings in here on purpose; the copy that renders a
 * refusal is a separate (seven-locale) i18n change.
 *
 * Worth noting for the layer above: unlike `artifacts.ts`'s tag-pointer workaround, a
 * firmware bundle now has a real PUBLISHED sha256, so it can be cached under a genuine
 * content key. Wiring that up is deliberately not done here.
 */
import { unzip as defaultUnzip } from "../unzip.js";
import { blobKey } from "../sources/blobCache.js";
import type { BundleMember, ContentEntry, FirmwareBuild } from "./types.js";

/** The subset of `src/lib/unzip.ts` this module uses. Injected so a test can count calls. */
export type UnzipLike = (buf: Uint8Array) => Promise<Map<string, Uint8Array>>;

/** Lowercase-hex sha256 over the raw bytes. Defaults to `blobCache.ts`'s `blobKey`. */
export type DigestLike = (bytes: Uint8Array) => Promise<string>;

/** Which declaration a file came from. */
export type MemberRole = "image" | "content";

/**
 * Names one declared member of a build, so a refusal can say exactly which entry failed
 * without the caller re-deriving it. `index` is the position in `content[]`, and is
 * `undefined` for the two singular roles.
 */
export interface MemberRef {
  role: MemberRole;
  /** The zip entry name, verbatim as declared. Never a URL, never a device path. */
  path: string;
  index?: number;
}

/**
 * One verified file out of the bundle. `bytes` are the raw archive bytes; `sha256` is the
 * digest that was actually computed over them, and it equals the manifest's claim (an entry
 * whose digest differed never becomes an `ExtractedFile` — it becomes a refusal).
 */
export interface ExtractedFile {
  role: MemberRole;
  /** Where it was read FROM, inside the zip. */
  path: string;
  bytes: Uint8Array;
  sha256: string;
  /** `content[]` only: where the bytes go on the device, relative to the storage root. */
  install?: string;
  /** `content[]` only, on `lang/*.bin`: the language this blob is for. Per-build; never shared. */
  language?: string;
  /** `content[]` only: its position in the manifest's array. */
  index?: number;
}

export type ExtractRefusalReason =
  | "bundle-hash"
  | "unreadable-archive"
  | "missing-entry"
  | "member-hash";

interface RefusalBase {
  ok: false;
  reason: ExtractRefusalReason;
  /** The build whose bundle this was, echoed back so a caller need not keep it. */
  buildId: string;
}

/**
 * The bundle's own bytes are not what the manifest published. Refused BEFORE the archive is
 * opened — the zip reader is never called with these bytes.
 */
export interface BundleHashRefusal extends RefusalBase {
  reason: "bundle-hash";
  /** Lowercase hex, as published in `bundle.sha256`. */
  expected: string;
  /** Lowercase hex, computed over the bytes actually supplied. */
  actual: string;
  /** `bundle.bytes` as published, and the length actually supplied. */
  expectedBytes: number;
  actualBytes: number;
}

/** The bytes hashed correctly but are not a readable zip. The reader's own message is kept. */
export interface UnreadableArchiveRefusal extends RefusalBase {
  reason: "unreadable-archive";
  detail: string;
}

/** A declared `path` is not in the archive. Refused rather than yielding `undefined` bytes. */
export interface MissingEntryRefusal extends RefusalBase {
  reason: "missing-entry";
  member: MemberRef;
  /** The entry names the archive does hold, for a diagnostic. Untrusted text — render only. */
  available: string[];
}

/** An extracted entry's bytes do not match the `sha256` its declaration published. */
export interface MemberHashRefusal extends RefusalBase {
  reason: "member-hash";
  member: MemberRef;
  expected: string;
  actual: string;
  expectedBytes: number;
  actualBytes: number;
}

export type ExtractRefusal =
  | BundleHashRefusal
  | UnreadableArchiveRefusal
  | MissingEntryRefusal
  | MemberHashRefusal;

export interface BundleExtraction {
  ok: true;
  buildId: string;
  /** The intflash image. Still unpatched — the superblock pass is a later step. */
  image: ExtractedFile;
  /** Every zip entry that was actually read, once each. */
  entriesRead: string[];
}

export type ExtractionResult = BundleExtraction | ExtractRefusal;

export interface ExtractOptions {
  unzip?: UnzipLike;
  digest?: DigestLike;
}

/**
 * Verify a bundle's raw bytes against `bundle.sha256` WITHOUT opening it.
 *
 * Split out because it is the gate the doc puts before the archive is touched at all: a
 * caller streaming a download can answer "may I unpack this?" with no zip reader in scope.
 */
export async function verifyBundleBytes(
  build: FirmwareBuild,
  bundleBytes: Uint8Array,
  digest: DigestLike = blobKey,
): Promise<BundleHashRefusal | null> {
  const actual = await digest(bundleBytes);
  if (actual === build.bundle.sha256) return null;
  return {
    ok: false,
    reason: "bundle-hash",
    buildId: build.id,
    expected: build.bundle.sha256,
    actual,
    expectedBytes: build.bundle.bytes,
    actualBytes: bundleBytes.length,
  };
}

/** Pull one declared member out of an already-opened archive and check its digest. */
async function takeMember(
  buildId: string,
  entries: Map<string, Uint8Array>,
  member: BundleMember,
  ref: MemberRef,
  digest: DigestLike,
): Promise<ExtractedFile | MissingEntryRefusal | MemberHashRefusal> {
  // `path`, never `install`: `install` says where the bytes go on the DEVICE and has no
  // meaning inside the archive.
  const bytes = entries.get(ref.path);
  if (!bytes) {
    return {
      ok: false,
      reason: "missing-entry",
      buildId,
      member: ref,
      available: [...entries.keys()],
    };
  }
  const actual = await digest(bytes);
  if (actual !== member.sha256) {
    return {
      ok: false,
      reason: "member-hash",
      buildId,
      member: ref,
      expected: member.sha256,
      actual,
      expectedBytes: member.bytes,
      actualBytes: bytes.length,
    };
  }
  return { role: ref.role, path: ref.path, bytes, sha256: actual, index: ref.index };
}

function isRefusal(v: ExtractedFile | ExtractRefusal): v is ExtractRefusal {
  return (v as ExtractRefusal).ok === false;
}

/**
 * Verify the bundle, open it, and verify every declared member.
 *
 * Returns a `BundleExtraction` or the FIRST refusal, in the doc's own order: the bundle's
 * hash, then the archive's readability, then `image` and `content[]` in turn.
 * Stopping at the first failure is deliberate — a bundle with one bad entry is not a bundle
 * a partial install may proceed from.
 */
export async function extractBundle(
  build: FirmwareBuild,
  bundleBytes: Uint8Array,
  options: ExtractOptions = {},
): Promise<ExtractionResult> {
  const unzip = options.unzip ?? defaultUnzip;
  const digest = options.digest ?? blobKey;

  // 1. The bundle's own hash, BEFORE the archive is opened.
  const bad = await verifyBundleBytes(build, bundleBytes, digest);
  if (bad) return bad;

  let entries: Map<string, Uint8Array>;
  try {
    entries = await unzip(bundleBytes);
  } catch (e) {
    return {
      ok: false,
      reason: "unreadable-archive",
      buildId: build.id,
      detail: e instanceof Error ? e.message : String(e),
    };
  }

  // 2. Every declared member's hash, AFTER extracting.
  const image = await takeMember(build.id, entries, build.image, { role: "image", path: build.image.path }, digest);
  if (isRefusal(image)) return image;

  const entriesRead = [build.image.path];

  const content: ExtractedFile[] = [];
  for (let i = 0; i < build.content.length; i++) {
    const decl: ContentEntry = build.content[i];
    const taken = await takeMember(build.id, entries, decl, { role: "content", path: decl.path, index: i }, digest);
    if (isRefusal(taken)) return taken;
    // `install` is carried through verbatim for the write step. It was NOT used to find
    // anything in the archive.
    content.push({ ...taken, install: decl.install, language: decl.language });
    entriesRead.push(decl.path);
  }

  return {
    ok: true,
    buildId: build.id,
    image,
    content,
    entriesRead,
  };
}
