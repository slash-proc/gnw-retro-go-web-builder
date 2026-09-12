/**
 * Homebrew titles, derived from the ACTIVE sources — the replacement for the hand-maintained
 * `engine/homebrew.ts` table (`HOMEBREW_TITLES`), deleted 2026-09-07.
 *
 * Owner: "we're removing the existing smw and zelda3 tools. the wasm converters they use will
 * be what we use. we don't hardcode anything like that into the web-builder anymore."
 *
 * Nothing in here is a list of known games. Every title below exists because a user added a
 * source whose manifest declares it, and every field is read out of that manifest:
 *
 *   HOMEBREW_TITLES entry  ->  one `targets[]` entry of an ACTIVE source with `kind: "homebrew"`
 *   sourceRoms             ->  the tool's `inputs[]` (`extensions[]` to offer, `variants[]` to check)
 *   deviceFiles            ->  `targets[].artifacts[]` + the outputs its `uses[]` names
 *   label / displayName    ->  the manifest `title`, and the `.bin` artifact's filename stem
 *   restool conversion     ->  `sources/converter.ts` (the WASM host)
 *
 * The old table's `virtualConsole` ("snes", "pico8") — which told cover scraping which art
 * library to search — is now the manifest's own top-level `originalSystem` (spec/03-manifest.md,
 * "Provenance and cover art"), carried through as `originalSystem` below.
 *
 * The behaviour that has to survive all of this: homebrew are NATIVE APPS, not ROMs. They do
 * not map 1:1 to a folder file and must never be treated as removable games. A title is
 * COMPLETE only when ALL of its device files are present in the device FrogFS; a partial set
 * means it needs re-installing.
 */
import { sources } from "./store.svelte.js";
import { prepareTool, type PreparedTool } from "./converter.js";
import { inputNeed } from "./inputPrompt.js";
import { targetNeedsToolInput } from "./needsUserFiles.js";
import { isCoreKind, type Manifest, type Target } from "./types.js";
import { owningTitle } from "./homebrewOwner.js";

/**
 * One installable homebrew title. Shaped to be a drop-in for the old `HomebrewTitle`, so the
 * five consumers keep their logic and only change where the data comes from.
 */
export interface HomebrewTitle {
  /**
   * Stable id: `owner/repo#targetId`. Namespaced by repo on purpose — two sources may both
   * publish a target called `zelda3`, and the old bare key ("zelda3") could not tell them
   * apart. Selection state, size lookups and cover paths are all keyed on this.
   */
  key: string;
  repo: string;
  targetId: string;
  /**
   * TRUE FOR A CORE, FALSE FOR HOMEBREW — the field that un-conflates the two.
   *
   * This list is "targets with something to prepare", not "homebrew". A core that declares a
   * converter belongs in it: the Sources tab's Additional-files section asks it for a WAD
   * exactly as it asks a homebrew title for its assets, and dropping cores back out of the
   * list would blank that section again.
   *
   * What must NOT follow from being in this list is appearing in the LIBRARY's Homebrew group.
   * A core's games are real ROMs under its own console (`roms/doom/`), discovered by the scan
   * and collapsed by `sources/gameRows.ts`; a pseudo-row here would show Doom under Homebrew,
   * which is precisely the bug the owner reported. `views/RomManagementTab.svelte` reads this
   * flag to decide that, and nothing else should need to.
   */
  isCore: boolean;
  /** The manifest's `title`. Untrusted third-party text — render, never interpolate as a path. */
  label: string;
  /**
   * The `.bin` artifact's filename stem, e.g. `Zelda 3`. This is the name Retro-Go shows and
   * the name cover art is filed under (`covers/homebrew/<displayName>.img`), which is why it
   * comes from the artifact rather than from `title`.
   */
  displayName: string;
  /**
   * Everything this title puts under `roms/homebrew/` once installed — the files whose names
   * are DECLARED (artifacts, plus any output with a fixed `filename`).
   *
   * NOT the whole install set when `derivedOutputs > 0`: a derived output is named after a
   * file the user supplies, and with `runPerFile` there is one per file supplied, so neither
   * the names nor the count exist before a run. Read `derivedOutputs` before treating this
   * list as exhaustive — `isComplete` deliberately does not.
   */
  deviceFiles: string[];
  /**
   * How many of this title's outputs take a DERIVED name (`outputs[].extension`), i.e. how
   * many entries `deviceFiles` cannot list. Zero for every title whose install set is fully
   * declared; non-zero means the set is open-ended and completeness is a statement about the
   * declared files alone. See `outputFilenames` for why this is a count and not names.
   */
  derivedOutputs: number;
  /**
   * The subdirectory of the homebrew directory this title's DATA lives in (`dataDir`,
   * gwrg-dist-spec `61d3726`) -- OpenLara's `/homebrews/openlara/`. Absent for a title whose
   * files all sit directly in the homebrew directory. Needed to attribute a derived output back
   * to its title: those are named after the input, so `deviceFiles` can never list them.
   */
  dataDir?: string;
  /** Lowercased file extensions (with dot) the converter accepts, for the folder-file hint. */
  sourceExtensions: string[];
  /** True when nothing user-supplied is REQUIRED — the old table's `celeste` case, generalised.
   *  Deliberately not the same as "has nothing to ask for": see `promptsForInput`. */
  selfContained: boolean;
  /**
   * True when the converter declares any input at all, required or not — i.e. the file prompt
   * has something to offer. A tool whose inputs are all OPTIONAL is `selfContained` (it runs
   * without them) and still `promptsForInput`; skipping the prompt for it would leave the user
   * no way to supply those files. A title with no tool prompts for nothing and goes straight
   * to fetching its artifacts.
   */
  promptsForInput: boolean;
  /** The narrowed converter, when this title has one. Absent means artifacts-only. */
  tool?: PreparedTool;
  /** The manifest target, for the install path (artifact URLs + hashes). */
  target: Target;
  /**
   * The manifest's top-level `originalSystem`: the console this work came from ("snes",
   * "pico8"), a hint for looking the title up in the right art library. OPTIONAL by design —
   * an original Game & Watch work has no origin console and omits it. When it is absent we do
   * NOT scrape at all (no name-based fallback, no lookup table — a hardcoded console map is
   * the exact thing this file replaced); the UI says so instead.
   */
  originalSystem?: string;
  /**
   * The manifest's top-level `originalName`: the original work's title, used AS GIVEN for the
   * cover lookup. Absent when the publisher did not say, which is the normal case today.
   */
  originalName?: string;
}

/**
 * Every output filename a target's `uses[]` entries name, resolved through the tool — and how
 * many of its outputs have no name to give.
 *
 * Only the FIXED ones are listable. A derived output declares an `extension` and no name, and
 * that name comes from a file the user has not supplied yet; worse, HOW MANY there are is not
 * a property of the manifest at all — with `runPerFile` it is however many files the user
 * brings. There is nothing to list before a run, and inventing a placeholder would put a file
 * in the install set that never exists.
 *
 * **Revisited (the `runPerFile` step), and deliberately kept — with the omission made
 * visible.** `deviceFiles` feeds `isComplete`, so silently dropping derived outputs means a
 * title whose ROMs were never converted can still report "complete" on the strength of its
 * artifacts. The three ways out were weighed:
 *
 *   - *invent placeholder names* — refused outright: a file in the install set that never
 *     exists is worse than an incomplete list, and every such title would carry the same
 *     invented name;
 *   - *report a title with derived outputs as never complete* — honest about the open set, and
 *     unusable: the count can never be satisfied, so the UI would ask the user to re-install
 *     forever;
 *   - *keep the declared set, and say out loud that it is not the whole set* — what this does.
 *     `derivedOutputs` is that signal, and it is on the title rather than buried here so a
 *     consumer asking "is this complete?" can see that completeness covers the DECLARED files
 *     only. Nothing in the app claims otherwise today, and a claim that would need the count
 *     now has the fact it is missing one.
 */
function outputFilenames(
  target: Target,
  tools: Map<string, PreparedTool>,
): { fixed: string[]; derived: number } {
  const fixed: string[] = [];
  let derived = 0;
  for (const use of target.uses ?? []) {
    const tool = tools.get(use.tool);
    if (!tool) continue;
    for (const id of use.outputs) {
      const spec = tool.outputs.find((o) => o.id === id);
      if (spec === undefined) continue;
      if (spec.filename !== undefined) fixed.push(spec.filename);
      else derived++;
    }
  }
  return { fixed, derived };
}

/** The first tool a target actually uses. The spec allows several; no publisher needs one yet. */
function primaryTool(target: Target, tools: Map<string, PreparedTool>): PreparedTool | undefined {
  for (const use of target.uses ?? []) {
    const tool = tools.get(use.tool);
    if (tool) return tool;
  }
  return undefined;
}

/**
 * Exported for `test/validate.mjs`. This is where the "is this a title at all?" rule lives —
 * including the one that decides whether a CORE with a converter gets a prepare button — and it
 * was unreachable from a test while it was module-private, so reverting that rule broke nothing
 * that anyone would notice. It is not part of the module's API; nothing else imports it.
 */
export function titlesFor(repo: string, manifest: Manifest): HomebrewTitle[] {
  // `prepareTool` is where the `processor` version gate fires. A tool this host cannot run is
  // dropped rather than thrown out of the whole catalogue — one unsupported converter in a
  // multi-target manifest must not make the other titles disappear.
  const tools = new Map<string, PreparedTool>();
  for (const tool of manifest.tools ?? []) {
    try {
      tools.set(tool.id, prepareTool(tool));
    } catch {
      /* unsupported or malformed tool: the targets that use it simply have none */
    }
  }

  const out: HomebrewTitle[] = [];
  for (const target of manifest.targets ?? []) {
    if (target.platform !== "game-and-watch") continue;

    const tool = primaryTool(target, tools);
    const isCore = isCoreKind(target.kind);
    // A CORE BELONGS IN THIS LIST TOO, WHEN IT CONVERTS SOMETHING.
    //
    // This list used to be homebrew-only, and that single line was why the owner reported
    // "neither is working": Doom's target is a CORE (it publishes `kind: "core"` since
    // v0.2.1; it was `"emulator"` before the spec rename, which is why `isCoreKind` accepts
    // both) shipping a core binary plus a `.wad` -> `.whd` converter. It produced no entry at
    // all — no prepare action, no `FilePromptModal`, and nothing for the Sources tab's
    // "Additional files" section to ask about, however conformant the manifest was.
    //
    // A core that declares a runnable converter has the same job HERE as a homebrew title: it
    // asks for a file and runs. What it does NOT share is where the result belongs — a
    // homebrew's output is a homebrew, a core's output is a GAME under its own console. That
    // difference is `isCore`, and `views/RomManagementTab.svelte` is what acts on it; nothing
    // in this module should branch on it.
    //
    // A core with NO converter is still not an entry: it has nothing to prepare and nothing to
    // ask for, and it is already listed as a source in its own right.
    if (!isCore && target.kind !== "homebrew") continue;
    if (isCore && tool === undefined) continue;

    const artifactNames = target.artifacts.map((a) => a.filename);
    const outputs = outputFilenames(target, tools);
    const deviceFiles = [...new Set([...artifactNames, ...outputs.fixed])];
    // A title with NO declarable file is still a title when it converts one: a converter whose
    // only output is derived (Doom's shape) declares no name at all, and dropping it here would
    // make it unreachable — the user could never run the conversion that produces its files.
    // A title with neither declared files nor a converter really has nothing to install.
    if (deviceFiles.length === 0 && outputs.derived === 0) continue;

    const bin = artifactNames.find((f) => f.toLowerCase().endsWith(".bin"));
    const displayName = (bin ?? deviceFiles[0] ?? target.id).replace(/\.[^/.]+$/, "");

    const need = inputNeed(tool?.inputs ?? []);
    // TWO DIFFERENT `required` FIELDS, AND THIS IS THE LINE THAT TELLS THEM APART.
    //
    // `need` reads `inputs[].required`: can the TOOL run without a file? Doom's cannot, so
    // `need` is "required" and this used to be the whole answer -- which made Doom demand a
    // WAD before it would install anything, even though it ships the shareware episode and
    // installs perfectly on its own. `uses[].required` answers the other question: does the
    // INSTALL need the tool at all? Doom publishes `false`, so the install needs nothing.
    //
    // `promptsForInput` deliberately stays driven by `need` alone. The converter is still
    // offered, a user who owns Doom II still supplies the WAD, and it still converts -- the
    // header comment above spells out why skipping the prompt would leave them no way to.
    const installNeedsFile = targetNeedsToolInput(target, [...tools.values()]);
    const sourceExtensions = [
      ...new Set(
        (tool?.inputs ?? []).flatMap((i) => i.extensions).map((e) => {
          const lower = e.toLowerCase();
          return lower.startsWith(".") ? lower : `.${lower}`;
        }),
      ),
    ];

    out.push({
      key: `${repo}#${target.id}`,
      repo,
      targetId: target.id,
      isCore,
      label: manifest.title,
      displayName,
      deviceFiles,
      derivedOutputs: outputs.derived,
      ...(target.dataDir ? { dataDir: target.dataDir } : {}),
      sourceExtensions,
      // Nothing user-supplied needed to INSTALL: no tool at all, a tool with no required
      // input, or -- Doom's case -- a tool the target does not require.
      selfContained: !installNeedsFile,
      promptsForInput: need !== "none",
      ...(tool ? { tool } : {}),
      // Top-level on the manifest, not per-target: it describes the work, not the platform
      // it was built for. Already pattern-checked by the client, so it is a single plain
      // segment or absent.
      ...(manifest.originalSystem ? { originalSystem: manifest.originalSystem } : {}),
      ...(manifest.originalName ? { originalName: manifest.originalName } : {}),
      target,
    });
  }
  return out;
}

class HomebrewCatalogue {
  /** Every title an ACTIVE source publishes. Empty until the user adds a homebrew source. */
  readonly titles: HomebrewTitle[] = $derived.by(() => {
    const out: HomebrewTitle[] = [];
    for (const row of sources.rows) {
      if (!row.active || !row.manifest) continue;
      try {
        out.push(...titlesFor(row.repo, row.manifest));
      } catch {
        /* a malformed manifest contributes no titles rather than breaking the list */
      }
    }
    return out.sort((a, b) => a.label.localeCompare(b.label));
  });

  /** Every filename we recognise as belonging to a homebrew title (under `roms/homebrew/`). */
  readonly deviceFiles: ReadonlySet<string> = $derived(
    new Set(this.titles.flatMap((t) => t.deviceFiles)),
  );

  /**
   * Extensions a folder file under `homebrew/` may have and still be a converter source.
   * Replaces the old exact-filename whitelist (`HOMEBREW_SOURCE_ROMS`): a manifest identifies
   * a user file by hash and extension, never by the name the user happened to give it.
   */
  readonly sourceExtensions: ReadonlySet<string> = $derived(
    new Set(this.titles.flatMap((t) => t.sourceExtensions)),
  );

  find(key: string): HomebrewTitle | undefined {
    return this.titles.find((t) => t.key === key);
  }

  /** The title a given on-device filename belongs to, if any. The rule is `homebrewOwner.ts`'s
   *  -- a pure module so a node suite can drive it without this store's dependencies. */
  owning(deviceFile: string): HomebrewTitle | undefined {
    return owningTitle(this.titles, deviceFile);
  }


  /**
   * True when every one of the title's DECLARED device files is present. A partial set is NOT
   * complete.
   *
   * "Declared" is load-bearing when `title.derivedOutputs > 0`: those files are named after
   * files the user supplies, so neither their names nor their number exist before a run and no
   * check here can cover them. See `outputFilenames` for why that is the only truthful answer.
   */
  isComplete(title: HomebrewTitle, present: Iterable<string>): boolean {
    const set = present instanceof Set ? present : new Set(present);
    return title.deviceFiles.length > 0 && title.deviceFiles.every((f) => set.has(f));
  }

  /** Completeness of each title, given the homebrew filenames actually present on the device. */
  status(presentDeviceFiles: Iterable<string>): {
    title: HomebrewTitle;
    present: number;
    complete: boolean;
  }[] {
    const present = new Set(presentDeviceFiles);
    return this.titles
      .map((title) => {
        const have = title.deviceFiles.filter((f) => present.has(f)).length;
        return { title, present: have, complete: have === title.deviceFiles.length && have > 0 };
      })
      .filter((s) => s.present > 0);
  }
}

export const homebrew = new HomebrewCatalogue();

/**
 * A folder path that could be a converter source for some active title. Used by the ROM scan,
 * which walks the folder before any title is selected and so cannot know which input it is for.
 */
export function isHomebrewSourceFile(name: string): boolean {
  const dot = name.lastIndexOf(".");
  if (dot < 0) return false;
  return homebrew.sourceExtensions.has(name.slice(dot).toLowerCase());
}
