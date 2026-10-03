/**
 * Running `inputDiscovery.ts` against the LIVE stores, from wherever a converter input is
 * shown.
 *
 * `inputDiscovery.ts` is pure on purpose (no store, no runes, so a node test drives the real
 * rule). This is the other half: it resolves `library`/`localFolders` into candidates, calls
 * the rule, and writes the answer into `prepareState`.
 *
 * IT LIVES HERE RATHER THAN IN A COMPONENT because two surfaces need it and they must not
 * disagree. The Sources tab's "Additional files" section shows a row per input; the Library
 * tab's prepare button decides from the same fact whether to open the picker at all. A copy in
 * each would drift, and a user who never opens Configure would get no discovery — the picker
 * would still ask for the WAD sitting in the folder they registered, which is the whole
 * complaint.
 *
 * WHAT IT COSTS. The two candidate sources are deliberately asymmetric: a library folder is
 * already walked by the library scan and its bytes are in memory, so it is free; a folder
 * the scan never touches is walked here, extension-filtered, reading sizes from metadata only.
 * The hash count is the pure rule's business and is asserted there.
 *
 * NOTHING IS CONVERTED. Discovery fills the slot; the user still presses prepare.
 */
import { library } from "../library.svelte.js";
import { coreRegistry } from "./coreRegistry.svelte.js";
import { isLibrarySource } from "./coreRegistry.js";
import { localFolders } from "./localFolders.svelte.js";
import { basePath } from "./libraryScan.js";
import { sha1Hex } from "./inputGate.js";
import { prepareState } from "./prepareState.svelte.js";
import {
  declaredExtensions,
  discoverInputsEach,
  folderCandidates,
  foldersToSearch,
  libraryCandidates,
  type CandidateFile,
  type DiscoveredOffer,
} from "./inputDiscovery.js";
import type { ConverterInput } from "./converterTypes.js";
import type { VariantHint } from "./gameRows.js";

/**
 * What discovery matched, per library key — the half of its answer the Library needs and
 * `prepareState` has no use for.
 *
 * `prepareState.discovered` stores file readers and metadata, not ROM bytes. The library needs
 * the matched variant's declared filename to pair a `.wad` with the `.whd` it will become; the
 * converter reopens bytes only if the user runs it.
 *
 * Keyed by the candidate's library key so `sources/gameRows.ts` can ask about a scanned file
 * directly. Written in full per source on every pass, like `setDiscovered`.
 */
/** A hint plus who contributed it, so one source's pass can replace only its own entries. */
interface RecognitionHint extends VariantHint {
  sha1?: string;
}

interface OwnedHint extends RecognitionHint {
  repo: string;
}

class VariantHints {
  private byKey = $state(new Map<string, OwnedHint>());

  /** Replace every hint contributed by `repo`; other sources' entries are left alone. */
  set(repo: string, hints: ReadonlyMap<string, RecognitionHint>): void {
    let unchanged = true;
    let owned = 0;
    for (const [key, existing] of this.byKey) {
      if (existing.repo !== repo) continue;
      owned++;
      const hint = hints.get(key);
      if (!hint || hint.sha1 !== existing.sha1 || hint.matched !== existing.matched
        || hint.variantFilename !== existing.variantFilename) {
        unchanged = false;
        break;
      }
    }
    if (unchanged && owned === hints.size) return;
    const next = new Map(this.byKey);
    for (const [k, v] of [...next]) if (v.repo === repo) next.delete(k);
    for (const [k, v] of hints) next.set(k, { ...v, repo });
    this.byKey = next;
  }

  get(key: string): RecognitionHint | undefined {
    return this.byKey.get(key);
  }
}

/** Singleton: two surfaces read the same discovery answer (see this file's header). */
export const variantHints = new VariantHints();

/**
 * Answer `inputs` for `repo` out of the folders registered for `targetKeys`, and record the
 * result. Written in full every time, so a file added later is picked up and one removed stops
 * satisfying. Never throws: a folder that cannot be walked contributes nothing.
 */
export async function discoverForSource(
  repo: string,
  inputs: readonly ConverterInput[],
  targetKeys: readonly string[],
): Promise<void> {
  if (!repo || inputs.length === 0) return;
  const trace = new URLSearchParams(location.search).has("libraryTrace");
  const traceStarted = performance.now();
  const candidates: CandidateFile[] = [];
  let payloadReads = 0;
  let payloadBytes = 0;
  let streamedHashes = 0;
  let streamedHashBytes = 0;
  try {
    const searchable = foldersToSearch(localFolders.folders, targetKeys);
    const allowed = new Set(searchable.map((f) => f.id));
    const scan = library.scan;
    const exts = declaredExtensions(inputs);
    candidates.push(...(scan
      ? libraryCandidates(
        scan.userRoms,
        library.fileOrigin,
        allowed,
        basePath,
        (key, folderId) => library.sha1ForPath(basePath(key), folderId),
        (key, folderId, sha1) => library.rememberSha1ForPath(basePath(key), folderId, sha1),
        exts,
      )
      : []));
    // Library sources are owned by the shared scan even before its cached snapshot hydrates.
    // Inferring coverage from fileOrigin starts redundant directory walks in that startup
    // window. Those walks can finish after hydration and hash large archives without the
    // library's lazy readers or remembered digests. The consuming effects run again when the
    // shared snapshot arrives; only dedicated converter folders need an independent walk.
    for (const f of searchable) {
      if (isLibrarySource(coreRegistry.current, f.usedBy)) continue;
      candidates.push(...(await folderCandidates(f.handle, f.id, exts)));
    }
    if (trace) {
      for (const candidate of candidates) {
        const read = candidate.read;
        candidate.read = async () => {
          const bytes = await read();
          payloadReads++;
          payloadBytes += bytes.byteLength;
          return bytes;
        };
        if (candidate.hashSha1) {
          const hashSha1 = candidate.hashSha1;
          candidate.hashSha1 = async () => {
            streamedHashes++;
            streamedHashBytes += candidate.size;
            return hashSha1();
          };
        }
      }
      console.info("[library trace] discovery start", JSON.stringify({ repo, inputs: inputs.length, candidates: candidates.length, hashableCandidates: candidates.filter((candidate) => !!candidate.hashSha1).length, durationMs: Math.round(performance.now() - traceStarted) }));
    }
    const hints = new Map<string, RecognitionHint>();
    await discoverInputsEach(inputs, candidates, { hash: sha1Hex }, async (r) => {
      const input = inputs.find((entry) => entry.id === r.inputId);
      if (input?.unmatched === "passthrough") {
        for (const candidate of candidates) {
          if (input.extensions.some((extension) => candidate.path.toLowerCase().endsWith(extension.toLowerCase()))) {
            hints.set(candidate.path, { sha1: candidate.sha1, matched: input.variants.some((variant) => candidate.sha1?.toLowerCase() === variant.sha1.toLowerCase()
              && (variant.bytes === undefined || variant.bytes === candidate.size)) });
          }
        }
      }
      // `found[]` also names the matched VARIANT, not just its declared output filename, and a
      // discovered row leads with that variant's label exactly as a picked one does. Same
      // one-per-file ordering, so the index is the pairing.
      const keep: number[] = [];
      const seen = new Set<string>();
      r.found.forEach((f, i) => {
        const file = r.files[i];
        const key = f.sha1 === undefined
          ? `${file.filename.toLowerCase()}\u0000${i}`
          : `${file.filename.toLowerCase()}\u0000${f.sha1}`;
        if (seen.has(key)) return;
        seen.add(key);
        keep.push(i);
      });
      const files: DiscoveredOffer[] = keep.flatMap((i) => {
        const found = r.found[i];
        const candidate = candidates.find((c) => c.folderId === found.folderId && c.path === found.path);
        if (!candidate) return [];
        return [{
          inputId: r.inputId,
          filename: baseName(found.path),
          ...(found.sha1 === undefined ? {} : { sha1: found.sha1 }),
          ...(found.variantId === undefined ? {} : { variantId: found.variantId }),
          readBytes: () => candidate.read(),
          release: () => candidate.release?.(),
        }];
      });
      prepareState.setDiscovered(repo, r.inputId, files, r.unrecognised);
      for (const i of keep) {
        const f = r.found[i];
        hints.set(f.path, { sha1: f.sha1, matched: f.variantId !== undefined, ...(f.variantFilename ? { variantFilename: f.variantFilename } : {}) });
      }
    }, true);
    variantHints.set(repo, hints);
    if (trace) console.info("[library trace] discovery done", JSON.stringify({ repo, inputs: inputs.length, candidates: candidates.length, payloadReads, payloadMiB: +(payloadBytes / 1048576).toFixed(1), streamedHashes, streamedHashMiB: +(streamedHashBytes / 1048576).toFixed(1), durationMs: Math.round(performance.now() - traceStarted) }));
  } catch {
    /* discovery is an optimisation over the picker; it never becomes an error the user sees */
  } finally {
    // Hashing is a scan-time probe. Keep only source references in app state; matched bytes
    // are reopened when the user actually runs the converter.
    for (const candidate of candidates) candidate.release?.();
  }
}

function baseName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

/**
 * KEEP a directory the user pointed a converter input at, and hand the handle back.
 *
 * The owner: "Maybe have the modal add the directory as a dedicated source?" — yes, and that is
 * the whole difference between this and a plain multi-file pick. A one-shot import answers today
 * and goes stale the moment he drops another level into the folder; a registered source is
 * re-read on every pass, so `discoverySignature` moves the instant this returns and
 * `discoverForSource` finds whatever is in there now, and again next week.
 *
 * ADOPTED AT PICK TIME, not on submit. Picking IS the act of adding the folder, so cancelling
 * the prompt afterwards leaves the source in place and the files still discovered — the
 * behaviour that survives a user closing a modal they only opened to look in.
 *
 * DEDICATED TO ITS TARGET, and the reason is COST, not taxonomy. A folder adopted here names
 * the target it was picked for, which is what keeps it OUT of `libraryScan.ts`'s
 * `romFolderSources` (see `isLibrarySource`): that walk READS every file it meets into memory,
 * so a Tomb Raider install treated as a library folder would be read whole for a library that
 * would then discard every byte of it as an unrecognised extension. `foldersToSearch` walks it
 * on demand instead, extension-filtered, with sizes from metadata. Folders no longer have a
 * kind; this is the same cost rule, now carried by the association the user actually made.
 *
 * No name is invented for the row: `name` stays "" so `displayName` falls back to the
 * directory's own name. The user picked it from inside a prompt and was never offered a field.
 *
 * THE PICKER ITSELF STAYS IN THE COMPONENT. Raising one is a user gesture, and every other
 * picker in this app is raised from a component (`ui/SourceFolders.svelte`,
 * `ui/AddLocalFolder.svelte`). Importing `romScan` here would also drag a browser-only module
 * into the import graph of every suite that stubs it — `test/coreregistry.mjs` fakes
 * `romScan.js` with a one-line stub, and its build broke the moment this module reached for it.
 */
export async function adoptInputFolder(
  handle: unknown,
  targetKeys: readonly string[],
): Promise<unknown> {
  await localFolders.adopt({ handle, usedBy: [...targetKeys] });
  return handle;
}

/**
 * A string that changes exactly when discovery could come back different: the registry, the
 * library scan's identity, and what is being asked for. A caller reads this in an `$effect` and
 * calls `discoverForSource` when it moves — re-running on every reactive tick would re-walk
 * folders for an answer that cannot have changed.
 *
 * The scan is compared by IDENTITY by the caller (an object cannot go in a string); everything
 * else is here.
 */
export function discoverySignature(repo: string, inputIds: readonly string[], targetKeys: readonly string[]): string {
  return [
    repo,
    inputIds.join(","),
    targetKeys.join(","),
    library.romFolderSignature,
    localFolders.folders.map((f) => `${f.id}:${f.status}:${f.usedBy.join("+")}`).join("|"),
  ].join("#");
}
