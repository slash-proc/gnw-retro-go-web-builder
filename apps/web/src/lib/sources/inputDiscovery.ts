/**
 * AUTOMATIC DISCOVERY OF A CONVERTER INPUT, FROM FOLDERS THE USER HAS ALREADY REGISTERED.
 *
 * The owner's report, verbatim: "They should be recognized automatically. I've added my rom
 * folder that has doom/*.wad and I also added doom as a dedicated source folder. it doesn't
 * make sense." He is right. Until now a `tools[].inputs[]` file could arrive ONE way — the
 * user pointing `ui/FilePromptModal.svelte` at it — even though the app already holds read
 * access to the folder the file is sitting in, and the manifest already says, by hash and by
 * extension, exactly which file it wants. The library scan looks for GAMES (doom's system
 * extension is `.whd`), so a `.wad` in the very same folder is invisible to it.
 *
 * So: this module answers "which files the user already has satisfy this input?", and the
 * picker stays as the fallback for the files the folders do not contain.
 *
 * ## THE COST RULE — the hard constraint, and the reason the order below is the way it is
 *
 * `libraryScan.ts` deliberately hashes ZERO files on a clean scan. A 1000-ROM library that
 * starts hashing itself because a Doom source was added would be the same regression in a new
 * place. The narrowing is therefore, cheapest test first:
 *
 *   1. EXTENSION. `input.extensions` is declared, so a `.nes` is not a `.wad` and that costs
 *      one string compare. An input declaring NO extensions is not auto-discovered at all
 *      (see `extensionCandidates`): every file in the library would be a candidate, which is
 *      precisely the hash-everything regression.
 *   2. SIZE. `variants[]` publish `bytes`, and a file of the wrong length cannot be that
 *      variant however it hashes. A `.wad` whose length matches no published one is never
 *      hashed. (If ANY variant omits `bytes` this eliminates nothing and is skipped — the
 *      manifest gave us nothing to eliminate with.)
 *   3. HASH, and only now. `sha1Hex` via the injected `hash` — the same digest
 *      `inputGate.ts` uses, never a second one.
 *
 * For the owner's case — a 1000-ROM library, three WADs, the live DOOM manifest whose four
 * variants all publish `bytes` — step 1 leaves 3 files, step 2 leaves however many are a
 * published length (1-2 in practice), and that is the hash count. `discovered.hashed` reports
 * it and `test/validate.mjs` asserts it numerically, so a regression to hash-everything fails
 * loudly rather than quietly costing a minute of the user's time.
 *
 * ## HASHES FIRST, THEN FILENAMES
 *
 * The owner: "The check for optional files should look at hashes first and then filenames."
 * So a size+hash match against `variants[]` is the STRONG match and is ordered first; a name
 * that looks like a variant's canonical filename is only a tiebreak among the leftovers, and a
 * bare extension match is the weakest. None of the three is an ACCEPTANCE decision — that is
 * `gateInputs`', below.
 *
 * ## `strict: false` STILL MEANS ACCEPTED
 *
 * `freedoom2.wad` matches no variant and is still a legitimate input (spec/03: accept it and
 * SAY it was not recognised). Discovery must not quietly drop it for failing to hash to
 * something. Under `strict: true` the opposite holds: nothing but a variant can ever be
 * accepted, so an unrecognised file is not offered at all.
 *
 * ## ONE MATCHER, NOT TWO
 *
 * Everything above only PRESELECTS. The verdict on the narrowed set is `gateInputs`' — the
 * same call the picker makes, with the same `maxBytes`/`strict`/arity rules and the same
 * `variantFilename` on the way out (which is what gives a matched WAD its canonical
 * "The Ultimate Doom.whd"). There is no second matcher here and there must never be one.
 *
 * ## RUNNING IS NOT IN SCOPE
 *
 * Auto-PREPARE was explicitly cancelled by the owner. Nothing here starts a conversion; it
 * fills the slot so the user finds the input already supplied and only has to press prepare.
 *
 * Pure and rune-free, like `fileRows.ts`/`metaFacts.ts`: no `$state`, no store import, no
 * `locale`. The caller resolves the stores into the plain candidates below, which is what lets
 * `test/validate.mjs` run the real rule with no browser.
 */
import { gateInputs, type OfferedFile } from "./inputGate.js";
import { targetOf } from "./types.js";
import type { ConverterInput, InputVariant } from "./converterTypes.js";
import { resolveBytes, type MaybeLazy } from "../lazyBytes.js";

/**
 * One file discovery may consider. `size` is known WITHOUT reading (a library entry already
 * holds its bytes; a directory entry answers `File.size` from metadata), which is the whole
 * reason step 2 above is free — `read()` is only ever called once a candidate has survived
 * every cheaper test.
 */
export interface CandidateFile {
  /** Relative path as the user has it. Untrusted text: reported, never used as a path. */
  path: string;
  /** `LocalFolderRow.id` — which registered folder this came from. */
  folderId: string;
  size: number;
  read(): Promise<Uint8Array>;
}

/** How a candidate came to be offered. Diagnostic; the acceptance verdict is the gate's. */
export type DiscoveryMatch = "variant" | "name" | "extension";

export interface DiscoveredFile {
  path: string;
  folderId: string;
  match: DiscoveryMatch;
  /** The matched variant's id, for a `"variant"` match. */
  variantId?: string;
  /** That variant's canonical `filename`, when it declares one. */
  variantFilename?: string;
}

export interface InputDiscovery {
  inputId: string;
  /** Ready to hand to `prepareState.run()` — already through `gateInputs`. */
  files: OfferedFile[];
  /** One per entry of `files`, same order. */
  found: DiscoveredFile[];
  /** Names accepted under `strict: false` without matching a variant. MUST reach the user. */
  unrecognised: string[];
  /** How many candidates were hashed. Asserted by the tests; the cost rule's own metric. */
  hashed: number;
}

/** Injected so a test can count hashes and stage bytes without a browser. */
export interface DiscoveryDeps {
  hash(bytes: Uint8Array): Promise<string>;
}

/** `.WAD` and `wad` both mean `.wad`. */
function normExt(ext: string): string {
  const lower = ext.trim().toLowerCase();
  return lower.startsWith(".") ? lower : `.${lower}`;
}

/** The extension of a path, folded, or "" — the destination is a case-folding card anyway. */
export function extensionOf(path: string): string {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  return dot <= 0 ? "" : name.slice(dot).toLowerCase();
}

/**
 * The basename of a path, EXACTLY as the user has it.
 *
 * This is what gets offered to the gate and, from there, shown back to the user and used to
 * derive an unmatched output's name. Folding it here once cost the owner his own filenames:
 * `Legend of Zelda, The - A Link to the Past (France).sfc` was offered as
 * `legend of zelda, the - a link to the past (france).sfc`. Compare with `foldedNameOf`;
 * never display that.
 */
function baseNameOf(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

/** The same basename folded, for COMPARISON only — the destination is a case-folding card. */
function foldedNameOf(path: string): string {
  return baseNameOf(path).toLowerCase();
}

/** A filename with its extension removed. */
function stemOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot <= 0 ? name : name.slice(0, dot);
}

/**
 * Step 1. An input with an EMPTY `extensions[]` returns nothing — deliberately: `extensions`
 * is spec/03's "a hint, never a check", but it is the only cheap narrowing there is, and
 * without it every file the user owns would reach the size test. A manifest that declares no
 * extension is asking to be pointed at a file, and the picker is still there to do it.
 */
export function extensionCandidates(
  input: Pick<ConverterInput, "extensions">,
  candidates: readonly CandidateFile[],
): CandidateFile[] {
  const want = new Set(input.extensions.map(normExt));
  if (want.size === 0) return [];
  return candidates.filter((c) => want.has(extensionOf(c.path)));
}

/**
 * Step 2. The set of candidates worth hashing.
 *
 * A published `bytes` is a free eliminator; a variant that omits one eliminates nothing, so
 * the moment any variant is size-less every extension candidate is size-plausible. An input
 * with no variants at all has nothing to hash AGAINST, so nothing is hashed for it.
 */
export function sizePlausible(
  variants: readonly InputVariant[],
  candidates: readonly CandidateFile[],
): CandidateFile[] {
  if (variants.length === 0) return [];
  if (variants.some((v) => v.bytes === undefined)) return [...candidates];
  const sizes = new Set(variants.map((v) => v.bytes as number));
  return candidates.filter((c) => sizes.has(c.size));
}

/**
 * How many files this input can still take. `maxCount` is applied HERE as well as in the gate:
 * with `runPerFile` the run count IS the file count, so offering a 33rd WAD to a
 * `maxCount: 32` input would only be arranging a refusal the user then has to undo.
 */
export function capacityOf(input: Pick<ConverterInput, "allowMultiple" | "maxCount">): number {
  if (!input.allowMultiple) return 1;
  return input.maxCount === undefined ? Infinity : input.maxCount;
}

/** Is this basename what the manifest calls a variant, give or take the extension? */
function looksLikeAVariantName(name: string, variants: readonly InputVariant[]): boolean {
  const stem = stemOf(name);
  for (const v of variants) {
    if (v.filename === undefined) continue;
    const declared = v.filename.toLowerCase();
    if (name === declared || stem === stemOf(declared)) return true;
  }
  return false;
}

/**
 * Everything the user already has that satisfies ONE input.
 *
 * The three passes are the header's three rules in order, and the result is whatever
 * `gateInputs` then accepts — never this function's own opinion.
 */
export async function discoverInput(
  input: ConverterInput,
  candidates: readonly CandidateFile[],
  deps: DiscoveryDeps,
): Promise<InputDiscovery> {
  const empty: InputDiscovery = { inputId: input.id, files: [], found: [], unrecognised: [], hashed: 0 };

  const byExtension = extensionCandidates(input, candidates).filter((c) => c.size <= input.maxBytes);
  if (byExtension.length === 0) return empty;
  // A strict input with no variants can never accept anything (the gate refuses every file
  // matching no variant), so there is nothing to discover and nothing to hash.
  if (input.strict && input.variants.length === 0) return empty;

  const strong: { cand: CandidateFile; found: DiscoveredFile }[] = [];
  // Every candidate that MATCHED a variant, including a second copy of one already taken. A
  // duplicate dump must not fall through into the weak pool and be offered a second time as a
  // bare extension match — that is the same file, and with `runPerFile` it would be a second
  // run producing a name that collides with the first.
  const consumed = new Set<CandidateFile>();
  const seenVariants = new Set<string>();
  let hashed = 0;

  for (const cand of sizePlausible(input.variants, byExtension)) {
    const bytes = await cand.read();
    const sha1 = (await deps.hash(bytes)).toLowerCase();
    hashed++;
    const variant = input.variants.find(
      (v) => v.sha1.toLowerCase() === sha1 && (v.bytes === undefined || v.bytes === cand.size),
    );
    if (!variant) continue;
    consumed.add(cand);
    // The same dump found in two registered folders is ONE input, not two runs of it.
    if (seenVariants.has(variant.id)) continue;
    seenVariants.add(variant.id);
    const found: DiscoveredFile = {
      path: cand.path,
      folderId: cand.folderId,
      match: "variant",
      variantId: variant.id,
      ...(variant.filename !== undefined ? { variantFilename: variant.filename } : {}),
    };
    strong.push({ cand, found });

  }

  // The weak half. Only under `strict: false`, because under `strict` the gate would refuse
  // every one of these and offering them would be a promise we cannot keep.
  const weak: { cand: CandidateFile; found: DiscoveredFile }[] = [];
  if (!input.strict) {
    const rest = byExtension.filter((c) => !consumed.has(c));
    const named = rest.filter((c) => looksLikeAVariantName(foldedNameOf(c.path), input.variants));
    const plain = rest.filter((c) => !named.includes(c));
    for (const cand of named) {
      weak.push({ cand, found: { path: cand.path, folderId: cand.folderId, match: "name" } });
    }
    for (const cand of plain) {
      weak.push({ cand, found: { path: cand.path, folderId: cand.folderId, match: "extension" } });
    }
  }

  const ordered = [...strong, ...weak].slice(0, capacityOf(input));
  if (ordered.length === 0) return { ...empty, hashed };

  const offered: OfferedFile[] = [];
  for (const { cand } of ordered) {
    offered.push({ inputId: input.id, filename: baseNameOf(cand.path), bytes: await cand.read() });
  }

  // ONE matcher. The gate re-derives the verdict for exactly these files (a handful, already
  // narrowed) and its `accepted`/`unrecognised` — not anything decided above — is what the
  // caller acts on.
  const gate = await gateInputs([input], offered);
  const acceptedSet = new Set(gate.accepted);
  const files: OfferedFile[] = [];
  const found: DiscoveredFile[] = [];
  ordered.forEach(({ found: f }, i) => {
    const file = offered[i];
    if (!acceptedSet.has(file)) return;
    files.push(file);
    found.push(f);
  });

  return {
    inputId: input.id,
    files,
    found,
    unrecognised: gate.unrecognised.map((v) => v.filename),
    hashed,
  };
}

/**
 * Every input of one tool (or one source's deduplicated list), in order.
 *
 * ONE HASH PER FILE, NOT ONE PER INPUT. Two inputs of the same tool routinely accept the same
 * extensions — zelda3's `base` and `language` are both `.sfc`/`.smc`, and since its variants
 * publish no `bytes` there is nothing to narrow with, so every SNES ROM the user owns reaches
 * the hash step for BOTH. Hashing each file once and sharing the digest across the inputs of
 * one tool halves that, and the saving grows with the input count. The cache is per CALL, so
 * nothing is held across discoveries and a file changed between passes is re-read.
 *
 * `hashed` on each result counts the candidates THAT input took to the hash step, so a
 * per-input narrowing regression stays visible. It is not the number of digests computed: the
 * memo is below it, so a file two inputs both consider is counted by both and hashed once.
 * Count the injected `deps.hash` calls for the real total (`test/validate.mjs` does).
 */
export async function discoverInputs(
  inputs: readonly ConverterInput[],
  candidates: readonly CandidateFile[],
  deps: DiscoveryDeps,
): Promise<InputDiscovery[]> {
  const shared = sharedHashDeps(deps);
  const out: InputDiscovery[] = [];
  for (const input of inputs) out.push(await discoverInput(input, candidates, shared));
  return out;
}

/**
 * `deps` with a per-call memo keyed by the exact bytes object the candidate returns.
 *
 * Keying on the `Uint8Array` identity rather than on a path is deliberate: `libraryCandidates`
 * hands out the scan's own buffer and `folderCandidates` memoises its read, so the same file
 * yields the same object both times, while two genuinely different files can never collide.
 */
function sharedHashDeps(deps: DiscoveryDeps): DiscoveryDeps {
  const memo = new Map<Uint8Array, Promise<string>>();
  return {
    hash: (bytes) => {
      const hit = memo.get(bytes);
      if (hit !== undefined) return hit;
      const p = deps.hash(bytes);
      memo.set(bytes, p);
      return p;
    },
  };
}

// --- Which folders are searched ------------------------------------------------------------

/** The slice of a `LocalFolderRow` the rule needs. Structural, so the store's rows pass as-is. */
export interface SearchableFolder {
  id: string;
  status: string;
  usedBy: string[];
  handle: unknown | null;
}

/**
 * WHICH FOLDERS A CONVERTER INPUT MAY BE SATISFIED FROM. The owner has BOTH a general ROM
 * folder holding `doom/*.wad` AND a dedicated Doom folder, and expects both to work.
 *
 * The rule is: **every registered folder that is readable right now and is not narrowed away
 * from this target.** Two deliberate halves:
 *
 *   - WHAT A FOLDER HOLDS IS NOT CONSULTED, and there is no longer a field claiming to say so:
 *     folders had a `kind` of "roms"/"homebrew" that grouped the Sources panes and never said
 *     who may READ one. A WAD in a shared folder is the same file as a WAD in a dedicated one,
 *     and the owner put one in each precisely because he expected either to count. Filtering on
 *     a role here would answer his complaint with "the file is there, I can read it, and I will
 *     not look".
 *   - `usedBy` IS CONSULTED, because that is the one field that IS about who a folder feeds:
 *     empty means Any (the default and the permissive case), and a non-empty list NARROWS the
 *     folder to the targets it names. A folder the user pointed at one homebrew title should
 *     not silently start feeding another. `targetKeys` is every target key this input belongs
 *     to; an empty `targetKeys` means the caller has no target context and only "Any" folders
 *     are searched, which is the conservative reading of a narrowing the caller cannot check.
 *     The comparison is on the TARGET half of each key (`types.ts`'s `targetOf`): a folder
 *     narrowed to one SYSTEM of a core is still that core's folder, and an input belongs to the
 *     target, not to a console.
 *
 * `status` must be "ready": a `needs-permission` or `missing` folder cannot be read without a
 * user gesture, and discovery is not a user gesture. Those rows keep their own re-grant
 * affordances in the Sources tab; nothing here prompts.
 */
export function foldersToSearch<T extends SearchableFolder>(
  folders: readonly T[],
  targetKeys: readonly string[],
): T[] {
  const keys = new Set(targetKeys);
  return folders.filter(
    (f) =>
      f.status === "ready" &&
      f.handle !== null &&
      (f.usedBy.length === 0 || f.usedBy.some((k) => keys.has(targetOf(k)))),
  );
}

/**
 * Candidates out of the merged library scan — the folders it already walked, for free.
 *
 * The scan already holds every file's bytes in memory (`romScan.ts` reads them), so these
 * candidates cost nothing at all: no second walk, no second read, and `read()` is a resolved
 * promise. `allowed` is the id set from `foldersToSearch`; a path whose origin is not in it is
 * dropped, which is how `usedBy` narrowing applies to a merged scan.
 *
 * `basePath` is deliberately NOT applied to the map key here — the caller passes the key it
 * has and the display path it wants — see `libraryScan.ts` for why a duplicate key is not a
 * path.
 */
export function libraryCandidates(
  files: ReadonlyMap<string, MaybeLazy>,
  origin: ReadonlyMap<string, string>,
  allowed: ReadonlySet<string>,
  pathOf: (key: string) => string,
): CandidateFile[] {
  const out: CandidateFile[] = [];
  for (const [key, bytes] of files) {
    const folderId = origin.get(key) ?? "";
    if (!allowed.has(folderId)) continue;
    out.push({
      path: pathOf(key),
      folderId,
      // `size` from metadata and `read` deferred: a zipped ROM offered as a converter input is
      // listed and filtered without being inflated, and read only if the user picks it.
      size: bytes.length,
      read: () => resolveBytes(bytes),
    });
  }
  return out;
}

/** The duck-typed slice of a `FileSystemDirectoryHandle` the walk below needs. */
interface WalkableDir {
  entries(): AsyncIterable<[string, WalkableEntry]>;
}
interface WalkableEntry {
  kind: string;
  entries?: () => AsyncIterable<[string, WalkableEntry]>;
  getFile?: () => Promise<{ size: number; arrayBuffer(): Promise<ArrayBuffer> }>;
}

/** How deep a folder walk goes. A shelf of WADs is one or two levels; a runaway tree is not. */
export const WALK_MAX_DEPTH = 4;

/**
 * Candidates out of a folder NOTHING ELSE WALKS — one dedicated to a homebrew target, which
 * never enters `library.scan` and so has no bytes anywhere in memory.
 *
 * Only files whose extension is in `extensions` are even turned into candidates, and `size`
 * comes from `File.size`, which is metadata: a folder of 500 files costs 500 `getFile()`
 * calls and reads NOTHING. `read()` is memoised so the hash pass and the offer do not read the
 * same file twice.
 *
 * A directory that throws mid-walk contributes what it had rather than taking the whole
 * discovery down — the same "a folder that cannot be read is skipped, not fatal" rule
 * `libraryScan.ts` states.
 */
export async function folderCandidates(
  handle: unknown,
  folderId: string,
  extensions: readonly string[],
  maxDepth: number = WALK_MAX_DEPTH,
): Promise<CandidateFile[]> {
  const want = new Set(extensions.map(normExt));
  if (want.size === 0 || !handle) return [];
  const out: CandidateFile[] = [];

  const walk = async (dir: WalkableDir, prefix: string, depth: number): Promise<void> => {
    if (depth > maxDepth) return;
    let iter: AsyncIterable<[string, WalkableEntry]>;
    try {
      iter = dir.entries();
    } catch {
      return;
    }
    try {
      for await (const [name, entry] of iter) {
        if (name.startsWith(".")) continue;
        const rel = prefix ? `${prefix}/${name}` : name;
        if (entry.kind === "directory") {
          if (typeof entry.entries === "function") {
            await walk(entry as unknown as WalkableDir, rel, depth + 1);
          }
          continue;
        }
        if (!want.has(extensionOf(rel)) || typeof entry.getFile !== "function") continue;
        let file: { size: number; arrayBuffer(): Promise<ArrayBuffer> };
        try {
          file = await entry.getFile();
        } catch {
          continue;
        }
        let bytes: Uint8Array | null = null;
        out.push({
          path: rel,
          folderId,
          size: file.size,
          read: async () => {
            if (bytes === null) bytes = new Uint8Array(await file.arrayBuffer());
            return bytes;
          },
        });
      }
    } catch {
      /* the walk stopped early; keep what it found */
    }
  };

  await walk(handle as WalkableDir, "", 0);
  return out;
}

/** Every extension any of these inputs declares — what a folder walk needs to look for. */
export function declaredExtensions(inputs: readonly Pick<ConverterInput, "extensions">[]): string[] {
  const out = new Set<string>();
  for (const input of inputs) for (const ext of input.extensions) out.add(normExt(ext));
  return [...out];
}
