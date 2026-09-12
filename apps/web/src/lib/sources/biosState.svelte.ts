/**
 * Reactive glue for `bios.ts`: watches the active sources, the ROM folder and the device, and
 * keeps a resolved BIOS status list. All the logic lives in `bios.ts` (pure, and tested by
 * `sources/test/validate.mjs`); this file only decides WHAT to feed it and when.
 *
 * Three inputs, and each is there for a reason:
 *
 *   - Active core sources, from their IN-MEMORY manifests. The persisted `SourceCard`
 *     deliberately does not carry `bios[]` (it is a small summary for instant rendering), and
 *     a BIOS check run against a stale manifest would be checking stale hashes. So a source
 *     that has not resolved yet simply contributes nothing until it has.
 *   - The user's games, folder ∪ device. `requiredFor` is narrower than a system, and a game
 *     already installed needs its BIOS whether or not it is in the folder today.
 *   - Candidate files, from the folder scan plus whichever side the app is actually targeting:
 *     the device's FrogFS listing in Flash mode, the card's `bios/` tree in SD mode. The two
 *     are never both consulted — a device being connected while the user manages SD content
 *     does not make its FrogFS the truth about what Retro-Go will read (CLAUDE.md).
 *
 * The resolve is async (it hashes), so it runs in an effect and lands in `$state` rather than
 * being a `$derived`. `seq` guards against an out-of-order landing when the inputs change
 * mid-hash.
 */
import { device } from "../device.svelte.js";
import { library } from "../library.svelte.js";
import { romSelection } from "../romSelection.svelte.js";
import { sources } from "./store.svelte.js";
import { scanSdBios } from "./sdBios.js";
import { dbg } from "../debug.js";
import {
  applyBiosPolicy,
  biosDestKey,
  biosAllowedFilenames,
  biosOmittedFilenames,
  collectBiosNeeds,
  installsBios,
  isBiosFolderKey,
  outstanding,
  resolveBiosStatus,
  sortForDisplay,
  type BiosCandidate,
  type BiosMedium,
  type BiosNeedEntry,
  type BiosSourceRef,
  type BiosStatus,
  type GameRef,
} from "./bios.js";

/** Folder keys that hold BIOS assets rather than games — `bios/…` or `<system>_bios/…`, the
 *  two shapes `flashImage.ts`'s `userDest` accepts. Lives in `bios.ts` so the install-policy
 *  filter there and this scan agree on what counts as a BIOS asset by construction. */
const isFolderBiosKey = isBiosFolderKey;

class BiosState {
  /** Every declared slot, resolved. Empty until the first resolve lands. */
  all = $state<BiosStatus[]>([]);
  /** True while a resolve is in flight. */
  checking = $state(false);

  private seq = 0;

  /** Active sources whose fresh manifest we hold. */
  readonly sourceRefs: BiosSourceRef[] = $derived.by(() =>
    sources.rows
      .filter((r) => r.active && r.manifest !== undefined)
      .map((r) => ({ repo: r.repo, manifest: r.manifest! })),
  );

  /** Games the user has, from either side. Drives DISCOVERY — which slots exist and whether a
   *  `requiredFor` slot is live — so it is the whole library, not the selection. */
  readonly games: GameRef[] = $derived.by(() =>
    romSelection.games.map((g) => ({ system: g.system, name: g.name })),
  );

  /**
   * Games the install will actually WRITE. Drives POLICY, and the distinction is the bug.
   *
   * `games` above is the union of the folder and the device, so a library holding 196 ROMs made
   * every system look present and every declared slot look wanted — even with nothing selected.
   * The owner's rule is that a BIOS is brought in by a core that needs it, and on Flash the
   * thing that makes a core needed is having a game for it in this install. Selecting nothing
   * therefore installs no BIOS, which is what he expected and not what he got.
   *
   * `selectedKeys` already counts a game already on the device as selected by default, so a
   * BIOS keeps its seat for a console whose games are being preserved rather than added.
   */
  readonly installingGames: GameRef[] = $derived.by(() =>
    romSelection.games
      .filter((g) => romSelection.selectedKeys.has(g.key))
      .map((g) => ({ system: g.system, name: g.name })),
  );

  /** The SD card's `bios/` tree, from the last scan. Empty in Flash mode and until one lands. */
  private sdFiles = $state<BiosCandidate[]>([]);
  /** The handle `sdFiles` was scanned from, so a re-`refresh()` does not re-walk the card. */
  private sdScanned: unknown = null;

  /** Files that could fill a slot: the target medium's own `bios/` tree, plus the folder's. */
  readonly candidates: BiosCandidate[] = $derived.by(() => {
    const out: BiosCandidate[] = [];
    if (device.targetMedia === "sd") {
      // Read the handle so a newly-picked card re-runs the consuming effect, which is what
      // drives `refresh()` and therefore the scan below.
      void device.sdHandle;
      out.push(...this.sdFiles);
    } else {
      for (const f of device.installedFrogfs?.files ?? []) {
        if (f.path.startsWith("bios/")) out.push({ where: "device", path: f.path, size: f.dataSize });
      }
    }
    for (const [path, data] of library.scan?.userRoms ?? []) {
      if (isFolderBiosKey(path))
        out.push({ where: "folder", path, bytes: data, size: data.length });
    }
    // Supplied this session. Deduplicated against the scan above, which `mirror()` may already
    // have written them into — the same file reported twice would read as two candidates.
    for (const [path, data] of this.userAdded) {
      if (!out.some((c) => c.path === path)) out.push({ where: "folder", path, bytes: data, size: data.length });
    }
    return out;
  });

  /**
   * Files the user supplied through the prompt this session, keyed by the folder-scan key
   * `biosDestKey` chose for them.
   *
   * They live here as well as in `library.scan.userRoms` for two reasons: the scan's `Map` is a
   * plain one inside a `$state` object, so mutating it notifies nobody (this `$state` field is
   * what re-runs `candidates`), and a file can be accepted before a folder has been picked at
   * all — `mirror()` re-applies those once one is.
   */
  private userAdded = $state(new Map<string, Uint8Array>());

  /**
   * Copy anything supplied this session into the folder-scan map, which is what every install
   * path actually reads (`romSelection.selectedFolderRoms()` in Flash mode, `changedSdUserRoms`
   * in SD mode — both already treat a `bios/` key as content to write).
   *
   * Idempotent, and safe to call before a folder exists: it simply does nothing until one does.
   */
  private mirror(): void {
    const folder = library.scan?.userRoms;
    if (!folder) return;
    for (const [key, bytes] of this.userAdded) {
      if (folder.get(key) === bytes) continue;
      folder.set(key, bytes);
      // SD mode syncs the CHANGED subset only; without this the file is stored and never written.
      library.markDirty(key);
    }
  }

  /**
   * Accept gated files for one slot and install them with the rest of the library.
   *
   * The bytes have already been through `inputGate.ts` (the caller runs the prompt); nothing is
   * re-checked here. `biosDestKey` decides the path — see its comment for why the manifest's
   * spelling of the filename wins over the user's.
   */
  addUserFiles(need: BiosNeedEntry, files: readonly { filename: string; bytes: Uint8Array }[]): void {
    if (files.length === 0) return;
    const next = new Map(this.userAdded);
    for (const f of files) next.set(biosDestKey(need, f.filename), f.bytes);
    this.userAdded = next;
    this.mirror();
  }

  /**
   * Did the user hand this slot a file THIS SESSION? Only such a file can be taken back out
   * from here — a candidate the folder scan or the device reported is a file on a real
   * filesystem, and "Remove" on the row must never read as "delete the user's disk copy".
   */
  hasUserFiles(need: Pick<BiosNeedEntry, "biosDir" | "filenames">): boolean {
    return need.filenames.some((f) => this.userAdded.has(biosDestKey(need, f)));
  }

  /**
   * The inverse of `addUserFiles`: drop the file the user supplied for one slot.
   *
   * It has to come out of BOTH places `addUserFiles`/`mirror` put it — this store's own map
   * (what `candidates` reads, so the row goes back to "add") and the folder-scan map (what an
   * install actually packs, so the bytes are not written anyway). `markDirty` is called for the
   * same reason it is on the way in: SD mode syncs the changed subset, and a key that is gone
   * has to be in that subset for the sync to notice.
   */
  removeUserFiles(need: Pick<BiosNeedEntry, "biosDir" | "filenames">): void {
    const keys = need.filenames.map((f) => biosDestKey(need, f)).filter((k) => this.userAdded.has(k));
    if (keys.length === 0) return;
    const next = new Map(this.userAdded);
    const folder = library.scan?.userRoms;
    for (const key of keys) {
      next.delete(key);
      if (folder?.delete(key)) library.markDirty(key);
    }
    this.userAdded = next;
  }

  /** The medium an install would write to. */
  readonly medium: BiosMedium = $derived(device.targetMedia === "sd" ? "sd" : "flash");

  /**
   * The slots an install on the current medium would actually WRITE a file for — see
   * `installsBios` for why SD and Flash disagree. Flash drops a slot whose system has no games
   * IN THIS INSTALL (and a `conditional-idle` one regardless); SD keeps every slot an active
   * source declares. Reading `installingGames` rather than `games` is what stops the Library
   * asking for a BIOS it has already decided not to write.
   */
  readonly installable: BiosStatus[] = $derived.by(() => {
    const has = new Set(this.installingGames.map((g) => g.system));
    const medium = this.medium;
    return this.all.filter((s) => installsBios(s.need, medium, has.has(s.systemId)));
  });

  /** Slots needed now that are absent, or present but refused by `strict` — restricted to the
   *  ones this medium would actually write (`installable`), so Flash does not ask the user for a
   *  file it has already decided not to install. */
  readonly outstanding: BiosStatus[] = $derived(outstanding(this.installable));

  /** Display order: what is wrong first. */
  readonly sorted: BiosStatus[] = $derived(sortForDisplay(this.all));

  /**
   * Slots an install would WRITE: satisfied, but only by a file that is not on the target
   * medium yet. Both media install every `bios/` key the folder holds (Flash via
   * `selectedFolderRoms()`, SD via the changed-file sync), so a folder-only candidate is a
   * pending write whether the user supplied it just now or it was already sitting in the
   * folder. A slot already filled on the device contributes nothing — nothing changes for it.
   */
  readonly pendingWrites: number = $derived(
    this.installable.filter(
      (s) => s.present && !s.blocked && !s.found.some((c) => c.where === "device"),
    ).length,
  );

  /** Lowercased filenames an install on the current medium must not write. Empty in SD mode. */
  readonly omittedFilenames: Set<string> = $derived(
    biosOmittedFilenames(this.all, this.installingGames, this.medium),
  );

  /** Lowercased filenames some active source declares at all. Anything else in the user's
   *  `bios/` folder is a file no core on this device can open, and is never written. */
  readonly allowedFilenames: Set<string> = $derived(biosAllowedFilenames(this.all));

  /**
   * Strip the BIOS files this medium should not write from a userRoms map, on the way into an
   * install. `romSelection.selectedFolderRoms()` deliberately includes every `bios/` asset the
   * folder holds regardless of selection — that is the right default (a BIOS is not a game the
   * user picks), and this is where the medium's policy is applied to it.
   */
  filterInstall<T>(userRoms: Map<string, T>): Map<string, T> {
    return applyBiosPolicy(userRoms, this.omittedFilenames, this.allowedFilenames);
  }

  /** True when this medium would write any BIOS at all — the UI renders nothing otherwise. A
   *  row reporting on slots the install has excluded would be reporting on nothing. */
  readonly any: boolean = $derived(this.installable.length > 0);

  /**
   * Walk the card's `bios/` tree once per picked handle, in SD mode only. Landing in `$state`
   * re-runs the caller's effect, which calls `refresh()` again with the candidates in hand.
   */
  private async scanSd(): Promise<void> {
    if (device.targetMedia !== "sd" || !device.sdHandle) {
      if (this.sdScanned !== null) {
        this.sdScanned = null;
        this.sdFiles = [];
      }
      return;
    }
    if (device.sdHandle === this.sdScanned) return;
    const handle = device.sdHandle;
    this.sdScanned = handle;
    try {
      const { getValidRoot } = await import("../romScan.js");
      const root = await getValidRoot(handle);
      const found = root ? await scanSdBios(root) : [];
      if (device.sdHandle === handle) this.sdFiles = found;
    } catch {
      // A revoked permission or an unreadable card is "no candidates", not an error state:
      // the slots simply report missing, which is what the user would see anyway.
      if (device.sdHandle === handle) this.sdFiles = [];
    }
  }

  /** Recompute. Call from an effect that reads `sourceRefs`, `games` and `candidates`. */
  async refresh(): Promise<void> {
    void this.scanSd();
    // A folder picked after a file was accepted still gets it (see `mirror`).
    this.mirror();
    const mine = ++this.seq;
    const needs = collectBiosNeeds(this.sourceRefs, this.games);
    if (needs.length === 0) {
      if (mine === this.seq) {
        this.all = [];
        this.checking = false;
      }
      return;
    }
    this.checking = true;
    try {
      const resolved = await resolveBiosStatus(needs, this.candidates);
      if (mine === this.seq) this.all = resolved;
      // WHY A SLOT IS EMPTY, in one line the owner can paste back. A BIOS that is plainly in a
      // folder and still reported missing has failed somewhere along a chain nothing narrates:
      // marked -> scanned -> placed under `bios/` -> recognised as a candidate -> matched to a
      // slot by name. Every link reads correctly on its own, so the only way to tell which one
      // broke is to print the state at the end of it. Runtime diagnostic text like the flasher's
      // device lines, so no string table entry.
      dbg("[bios]", JSON.stringify({
        needs: needs.map((n) => `${n.systemId}/${n.id}`),
        candidates: this.candidates.map((c) => `${c.where}:${c.path}`),
        filled: resolved.filter((r) => r.present).map((r) => `${r.systemId}/${r.id}`),
        empty: resolved.filter((r) => !r.present).map((r) => `${r.systemId}/${r.id}=${r.filenames.join("|")}`),
      }));
    } finally {
      if (mine === this.seq) this.checking = false;
    }
  }
}

export const biosState = new BiosState();
