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
import { localFolders } from "./localFolders.svelte.js";
import { basePath } from "./libraryScan.js";
import { sha1Hex } from "./inputGate.js";
import { prepareState } from "./prepareState.svelte.js";
import {
  declaredExtensions,
  discoverInputs,
  folderCandidates,
  foldersToSearch,
  libraryCandidates,
  type CandidateFile,
} from "./inputDiscovery.js";
import type { ConverterInput } from "./converterTypes.js";
import type { VariantHint } from "./gameRows.js";

/**
 * What discovery matched, per library key — the half of its answer the Library needs and
 * `prepareState` has no use for.
 *
 * `prepareState.discovered` stores `OfferedFile[]` (`{inputId, filename, bytes}`), which is
 * everything RUNNING the converter needs and nothing the LIBRARY does: pairing a `.wad` with
 * the `.whd` it will become requires the matched variant's declared filename, and that was
 * being discarded. Recording it here costs nothing extra — `discoverInputs` already computed
 * it under its own hash budget.
 *
 * Keyed by the candidate's library key so `sources/gameRows.ts` can ask about a scanned file
 * directly. Written in full per source on every pass, like `setDiscovered`.
 */
/** A hint plus who contributed it, so one source's pass can replace only its own entries. */
interface OwnedHint extends VariantHint {
  repo: string;
}

class VariantHints {
  private byKey = $state(new Map<string, OwnedHint>());

  /** Replace every hint contributed by `repo`; other sources' entries are left alone. */
  set(repo: string, hints: ReadonlyMap<string, VariantHint>): void {
    const next = new Map(this.byKey);
    for (const [k, v] of [...next]) if (v.repo === repo) next.delete(k);
    for (const [k, v] of hints) next.set(k, { ...v, repo });
    this.byKey = next;
  }

  get(key: string): VariantHint | undefined {
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
  try {
    const searchable = foldersToSearch(localFolders.folders, targetKeys);
    const allowed = new Set(searchable.map((f) => f.id));
    const scan = library.scan;
    const candidates: CandidateFile[] = scan
      ? libraryCandidates(scan.userRoms, library.fileOrigin, allowed, basePath)
      : [];
    // A folder that contributed nothing to the merged scan is one nothing else walks (one
    // dedicated to a homebrew target). Walking a folder the scan covered would read it twice.
    const covered = new Set(library.fileOrigin.values());
    const exts = declaredExtensions(inputs);
    for (const f of searchable) {
      if (covered.has(f.id)) continue;
      candidates.push(...(await folderCandidates(f.handle, f.id, exts)));
    }
    const results = await discoverInputs(inputs, candidates, { hash: sha1Hex });
    // `found[]` is one-per-`files[]`, same order, and carries the matched variant. The Library
    // pairs a `.wad` with the `.whd` it becomes on that variant's declared filename, so record
    // it rather than dropping it on the floor as this did before.
    const hints = new Map<string, VariantHint>();
    for (const r of results) {
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
      const files = keep.map((i) => {
        const f = r.files[i];
        const id = r.found[i]?.variantId;
        return id === undefined ? f : { ...f, variantId: id };
      });
      prepareState.setDiscovered(repo, r.inputId, files, r.unrecognised);
      for (const i of keep) {
        const f = r.found[i];
        if (f.variantFilename) hints.set(f.path, { variantFilename: f.variantFilename });
      }
    }
    variantHints.set(repo, hints);
  } catch {
    /* discovery is an optimisation over the picker; it never becomes an error the user sees */
  }
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
