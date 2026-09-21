<script lang="ts" module>
  // The pane ids and the tab's URL grammar live in lib/sourcesRoute.ts — a rune-free module,
  // so the routing decision is testable (nothing in this repo's node suites can observe a
  // Svelte effect). Re-exported here because every existing importer names this file.
  export type { SourcePaneId } from "../sourcesRoute.js";
</script>

<script lang="ts">
  // Sources tab. Lists the content sources the user has added: cores on the left,
  // homebrew on the right, one row per project. Reading only — this phase ends at "the app
  // knows about a source and whether it is active". Nothing here downloads an artifact, runs
  // a converter, or touches the device, so the tab renders fine with nothing connected.
  //
  // Every string that comes out of a fetched manifest (title, console names, extensions) is
  // untrusted third-party text. It is interpolated with `{...}`, which is textContent
  // semantics — never {@html}.
  import { locale } from "../i18n/locale.svelte.js";
  import { rawManifestFromCard, sources, sourceDisplayName, type SourceRow } from "../sources/store.svelte.js";
  import { library } from "../library.svelte.js";
  import { device } from "../device.svelte.js";
  import { abiSatisfies } from "../engine/firmwareAbi.js";
  import Button from "../ui/Button.svelte";
  import AdditionalFiles from "../ui/AdditionalFiles.svelte";
  import SourceFolders from "../ui/SourceFolders.svelte";
  import LocalFolders from "../ui/LocalFolders.svelte";
  import CachePane from "../ui/CachePane.svelte";
  import AddLocalFolder from "../ui/AddLocalFolder.svelte";
  import StatPanel, { type StatRow } from "../ui/StatPanel.svelte";
  import AddSource from "../ui/AddSource.svelte";
  import { biosState } from "../sources/biosState.svelte.js";
  import { metaSegments } from "../sources/metaLine.js";
  import { metaFacts as chooseMetaFacts } from "../sources/metaFacts.js";
  import { errorText } from "../sources/errorText.js";
  import { localFolders } from "../sources/localFolders.svelte.js";
  import SdCardPane from "../ui/SdCardPane.svelte";
  import { sdStorage } from "../sdStorage.svelte.js";
  import { loadStatedCard, saveStatedCard, type StatedCard } from "../sdCapacity.js";
  import type { Target } from "../sources/types.js";
  import { isCoreKind } from "../sources/types.js";
  import { prepareState } from "../sources/prepareState.svelte.js";
  import { biosRequired } from "../sources/fileRows.js";
  import { prepareTool } from "../sources/converter.js";
  import { composeInstallRows, installTotal } from "../sources/installRows.js";
  import { formatSize } from "../util.js";
  import { untrack } from "svelte";
  import {
    DEFAULT_SOURCE_PANE,
    parseSourcesRoute,
    serializeSourcesRoute,
    type SourcePaneId,
    isRemotePane,
    type SourcesRoute,
  } from "../sourcesRoute.js";

  // `route` is this tab's slice of the URL (everything after "#sources/"), owned by
  // Advanced.svelte because it owns the hash. It is a one-directional pair: the prop is
  // "someone changed the URL, apply it", `onRoute` is "the user changed the view, write it".
  // The echo is broken by `lastRoute` below, not by suppressing either direction.
  let { route = "", onRoute }: { route?: string; onRoute?: (r: string, push: boolean) => void } =
    $props();

  const t = $derived(locale.t.sources);

  let addOpen = $state(false);
  // The add view's confirming action lives in the page's ONE footer bar (ReposAdd), so the
  // bar needs both halves of it: whether there is anything to add, and how to do it.
  let addRef = $state<AddSource | null>(null);
  let addCanAdd = $state(false);
  let detailsOpen = $state(false);
  // SourcesRail.dc.html — the tab's left rail. Exactly one pane is mounted at a time, the
  // same model FirmwareRail uses.
  let pane = $state<SourcePaneId>(DEFAULT_SOURCE_PANE);
  /** The one local FOLDER pane. Directories have no kind; see localFolders.svelte.ts. */
  const isLocal = $derived(pane === "local-directories");
  /** The Cache pane (SourcesCache.dc.html). Local, but not a folder list — it shares none of
      the folder panes' add/remove/configure machinery, so it gets its own flag rather than
      widening `isLocal`. */
  const isCache = $derived(pane === "local-cache");
  const isSd = $derived(pane === "local-sd");
  /** Whether this pane lists a remote catalogue -- the one fact the page chrome should ask.
      See `isRemotePane`: guarding on `!isLocal && !isCache` let `local-sd` fall through to
      the remote branch and inherit its title, its buttons and its kind. */
  const isRemote = $derived(isRemotePane(pane));

  // The SD card's stated size. Held here rather than in the pane so the pane stays pure props:
  // it renders in a test with no storage and no reactive graph. Re-read on every change rather
  // than cached, because the record is keyed by folder name and the card can be swapped.
  let statedCard = $state<StatedCard | null>(null);
  function reloadStated(): void {
    const st = sdStorage.state;
    const name = st.kind === "ready" ? st.folderName : st.kind === "unreadable" ? st.folderName : null;
    statedCard = loadStatedCard(name);
  }
  function setStated(next: StatedCard | null): void {
    saveStatedCard(next);
    statedCard = next;
  }

  /**
   * Walk the card the app already holds.
   *
   * `inSdMode` is passed TRUE unconditionally here, and that is a decision rather than a
   * shortcut. The store's second argument exists for the Overview, where the question is "is
   * this device's target the card"; on the Sources tab the card is a SOURCE the user picked, and
   * what is on it does not depend on which medium the device happens to be installing to. A
   * `false` here would report `unavailable` -- "no card chosen" -- for a card that is plainly
   * chosen, which is the one thing the unselected state must not say wrongly.
   *
   * With no handle the store reports `unavailable` on its own, which IS the unselected state.
   */
  async function rescanSdCard(): Promise<void> {
    const { device } = await import("../device.svelte.js");
    // The remembered card arrives from IndexedDB, so on a fresh load it is not here yet.
    // Refreshing without this reads a null handle and reports `unavailable` -- the card page
    // drawing "no card chosen" for a card we do hold.
    await device.whenSdRestored();
    await sdStorage.refresh(device.sdHandle ?? null, true);
    reloadStated();
  }

  /**
   * Read the card once, if it has not been read yet.
   *
   * `refresh()` is a full walk, so this deliberately does NOT run on every visit. "Not read
   * yet" is the two states that describe no reading of a card rather than a card:
   *
   *   unknown      the store as constructed, which is what a FRESH PAGE is in
   *   unavailable  asked, and there was no handle to walk
   *
   * `unknown` is the load-bearing half and it was missing: the guard admitted `unavailable`
   * alone, so on the one case this exists for -- a reload, with a card restored from IndexedDB
   * -- the store was still at its constructed `unknown`, the reader returned early, and the
   * page showed nothing while the Library showed the card.
   *
   * `unreadable` is deliberately NOT here: a walk that failed is an answer, and retrying it on
   * every visit would re-walk a card we already know we cannot read. Rescan is for that.
   */
  async function readSdCardIfUnread(): Promise<void> {
    await device.whenSdRestored();
    const unread = sdStorage.state.kind === "unknown" || sdStorage.state.kind === "unavailable";
    if (!unread || !device.sdHandle) return;
    await rescanSdCard();
  }

  /** Pick a different card. The same picker the folder gate raises, so nobody is asked twice. */
  async function pickSdCard(): Promise<void> {
    const { pickSdCardFolder } = await import("../romScan.js");
    await pickSdCardFolder();
    await rescanSdCard();
  }
  /** The pane's own instance, so the ONE footer bar can fire its "Empty cache". */
  let cacheRef = $state<CachePane | null>(null);
  let localSelected = $state<string | null>(null);
  // The add-a-folder PAGE (SourcesAddRoms / SourcesAddHomebrewDir). Same shape as `addOpen`
  // above: a full page replacing the list, confirmed from the one footer bar.
  let folderAddOpen = $state(false);
  /** Non-null while the SAME page is open in configure mode, for that folder. */
  let folderEditId = $state<string | null>(null);
  let folderAddRef = $state<AddLocalFolder | null>(null);
  let folderCanAdd = $state(false);

  // Idempotent by contract (the store's own `loaded` guard), so an effect is the right shape.
  $effect(() => {
    void localFolders.load();
  });

  const localRows = $derived(localFolders.folders);


  async function removeLocalFolder(): Promise<void> {
    const id = localSelected;
    if (!id) return;
    localSelected = null;
    await localFolders.remove(id);
  }
  /** The catalogue a REMOTE pane lists, or null off one. It used to be a two-way ternary
      whose else-branch answered "core" for every non-remote pane, which is what `Update all`
      would have refreshed from the SD card page. Null forces a reader to say what it means. */
  const remoteKind = $derived<"core" | "homebrew" | null>(
    !isRemotePane(pane) ? null : pane === "remote-homebrew" ? "homebrew" : "core",
  );
  let bulkSelected = $state<Set<string>>(new Set());
  const remoteRows = $derived(
    remoteKind === "core" ? sources.byKind.core : remoteKind === "homebrew" ? sources.byKind.homebrew : [],
  );
  const allBulkSelected = $derived(remoteRows.length > 0 && remoteRows.every((row) => bulkSelected.has(row.repo)));

  function toggleBulk(repo: string): void {
    const next = new Set(bulkSelected);
    if (next.has(repo)) next.delete(repo);
    else next.add(repo);
    bulkSelected = next;
  }

  function toggleAllBulk(): void {
    bulkSelected = allBulkSelected ? new Set() : new Set(remoteRows.map((row) => row.repo));
  }

  /** True only while a version SWITCH is in flight — not while a background refresh runs. */
  let switching = $state(false);

  sources.load();

  const selected = $derived(sources.selected ? sources.get(sources.selected) : undefined);

  // ---- URL route (see lib/sourcesRoute.ts) --------------------------------------------------
  /** This view's state, as a route. The single source of truth for what the URL should say. */
  const currentRoute = $derived.by<SourcesRoute>(() => {
    if (pane === "local-cache" || pane === "local-sd") return { pane, selected: null, page: "none" };
    if (isLocal) {
      if (folderAddOpen)
        return folderEditId !== null
          ? { pane, selected: folderEditId, page: "config" }
          : { pane, selected: null, page: "add" };
      return { pane, selected: localSelected, page: "none" };
    }
    if (addOpen) return { pane, selected: null, page: "add" };
    return { pane, selected: sources.selected, page: detailsOpen ? "config" : "none" };
  });

  /** The route last written to, or read from, the URL — the echo guard for both directions. */
  let lastRoute = "";
  /** Cleared after the first report: that one is where the tab happened to open, not a click. */
  let firstReport = true;

  function applyRoute(raw: string): void {
    const r = parseSourcesRoute(raw);
    const canonical = serializeSourcesRoute(r);
    if (canonical === lastRoute) return; // our own write coming back — not a navigation
    lastRoute = canonical;
    // "#sources" with no sub-route is a real address (the tab strip writes it), but it is not
    // where we end up: canonicalize it in place so Back from the first pane click has a
    // sensible entry to return to, and so the URL never disagrees with the view. REPLACE —
    // the user navigated to the tab, not to this pane.
    if (raw.replace(/^\/+|\/+$/g, "") !== canonical) {
      firstReport = false;
      onRoute?.(canonical, false);
    }
    // A deep link to the card's pane on a Flash target has no rail row to return from, and the
    // card is not part of that build's content at all. Send it to Directories rather than
    // drawing a pane the rail does not offer.
    if (r.pane === "local-sd" && device.targetMedia !== "sd") {
      pane = "local-directories";
      addOpen = detailsOpen = false;
      onRoute?.("#sources/local-directories", false);
      return;
    }
    pane = r.pane;
    if (r.pane === "local-cache" || r.pane === "local-sd") {
      addOpen = detailsOpen = folderAddOpen = false;
      folderEditId = null;
      if (r.pane === "local-sd") reloadStated();
      return;
    }
    if (r.pane === "local-directories") {
      addOpen = detailsOpen = false;
      localSelected = r.page === "add" ? null : r.selected;
      folderAddOpen = r.page !== "none";
      folderEditId = r.page === "config" ? r.selected : null;
      return;
    }
    folderAddOpen = false;
    folderEditId = null;
    addOpen = r.page === "add";
    sources.selected = r.page === "add" ? null : r.selected;
    detailsOpen = r.page === "config";
  }

  // Apply an incoming route. Tracks the PROP only; the body is untracked so the state it
  // writes cannot retrigger it (the page-freeze shape Advanced.svelte's mount effect warns
  // about). Also runs at mount, which is what makes "#sources/<pane>/<repo>/config" a real
  // deep link into a source's configure page.
  $effect(() => {
    const r = route;
    untrack(() => applyRoute(r));
  });

  /**
   * THE CARD PAGE FOLLOWS THE HANDLE, NOT THE NAVIGATION THAT MOUNTED IT.
   *
   * The read used to hang off `applyRoute`, which is a ONE-SHOT: it fires per distinct route
   * and never again. That is the wrong trigger for content derived from a value that arrives
   * asynchronously -- the handle is read back from IndexedDB, so a pane already on screen when
   * the restore lands had nothing left to tell it to look.
   *
   * `device.sdHandle` is the tracked read, so this runs at mount (null, nothing to do) and
   * again the moment the restore or a pick assigns one. The body is untracked: `rescanSdCard`
   * writes `sdStorage.state` and `statedCard`, and reading either here would make this effect
   * retrigger itself.
   */
  $effect(() => {
    const handle = device.sdHandle;
    untrack(() => {
      if (handle) void readSdCardIfUnread();
    });
  });

  // Report an outgoing route. `currentRoute` is derived from this view's own state, so this
  // fires for a rail click, a row selection, opening or closing add/configure — every way the
  // user can move within the tab — and for nothing else.
  $effect(() => {
    const next = serializeSourcesRoute(currentRoute);
    untrack(() => {
      if (next === lastRoute) return;
      lastRoute = next;
      // The first report is the pane the tab opened on, derived from nothing the user did:
      // replace, or entering the tab would cost a dead Back press.
      onRoute?.(next, !firstReport);
      firstReport = false;
    });
  });

  /** Lowercased extensions of every file in the picked ROM folder, or null if none picked. */
  const folderExtensions = $derived.by(() => {
    const scan = library.scan;
    if (!scan) return null;
    const out: string[] = [];
    for (const path of scan.userRoms.keys()) {
      const dot = path.lastIndexOf(".");
      if (dot >= 0) out.push(path.slice(dot).toLowerCase());
    }
    return out;
  });

  /** How many files in the picked folder a source's systems could actually list. */
  function romsMatched(row: SourceRow): number | null {
    const exts = row.card?.extensions;
    if (!exts || exts.length === 0) return null;
    const found = folderExtensions;
    if (!found) return null;
    const want = new Set(exts);
    let n = 0;
    for (const e of found) if (want.has(e)) n++;
    return n;
  }

  /**
   * Can the connected device's firmware load this source's build?
   *
   * Three-valued ON PURPOSE. `null` is "we do not know" — nothing connected, no scan yet, or
   * a firmware that publishes no ABI table (stock OFW, a pre-ABI Retro-Go). Unknown must
   * render as NO CLAIM AT ALL, the same rule cover scraping follows when a homebrew omits
   * `originalSystem`: no data, no assertion. Only a device that told us its ABI can make a
   * row say it needs newer firmware.
   */
  function abiCompatible(row: SourceRow): boolean | null {
    const abi = device.firmwareAbi;
    const card = row.card;
    if (!abi || !card) return null;
    return abiSatisfies(abi, { version: card.abiVersion, minSize: card.abiMinSize ?? 0 });
  }

  /**
   * The meta line: short factual notes about this source, joined with a middot.
   *
   * The PRECEDENCE rule — which fact wins, and in particular that a build the device cannot
   * load says so INSTEAD OF counting ROMs — lives in `sources/metaFacts.ts` so it can be
   * tested. This function only resolves the raw inputs and maps each returned token to its
   * localised string.
   */
  /** Whether a source still has a mandatory file that the user must provide.
   *
   * The card flag is a manifest summary and remains true after the BIOS or converter input has
   * been found. Resolve it against the live status instead, so a satisfied source does not keep
   * advertising a requirement it no longer has. A persisted card without its manifest stays
   * conservative until the manifest is restored.
   */
  function hasOutstandingUserFiles(row: SourceRow): boolean {
    if (!row.card?.needsUserFiles) return false;
    const bios = biosState.all.filter((b) => b.repo === row.repo && biosRequired(b.need));
    if (bios.length > 0 && bios.some((b) => !b.present || b.blocked)) return true;

    const target = row.manifest?.targets?.find((t2) => t2.platform === "game-and-watch") ?? row.manifest?.targets?.[0];
    const tools = row.manifest?.tools ?? [];
    const requiredTools = new Set((target?.uses ?? []).filter((u) => u.required).map((u) => u.tool));
    let inspectedInput = false;
    for (const tool of tools) {
      if (!requiredTools.has(tool.id)) continue;
      let prepared;
      try {
        prepared = prepareTool(tool);
      } catch {
        return true;
      }
      for (const input of prepared.inputs) {
        if (!input.required) continue;
        inspectedInput = true;
        if (!prepareState.isSatisfied(row.repo, input.id)) return true;
      }
    }
    if (bios.length > 0 || inspectedInput) return false;
    return true;
  }

  function factTexts(row: SourceRow): string[] {
    const card = row.card;
    const facts = chooseMetaFacts({
      loading: row.status === "loading",
      error: row.status === "error",
      hasCard: !!card,
      isCore: isCoreKind(card?.kind),
      abiCompatible: abiCompatible(row),
      romsMatched: romsMatched(row),
      hasRomFolder: folderExtensions !== null,
      needsUserFiles: hasOutstandingUserFiles(row),
      prerelease: !!card?.prerelease,
    });
    return facts.map((f) => {
      switch (f.kind) {
        case "loading":
          return t.loading;
        case "error":
          return errorText(t, row.errorCode, row.errorDetail);
        // The artboard's incompatible core row (Repos.dc.html, "Neo Geo Pocket") carries this
        // INSTEAD of a ROM count, in the same plain meta text as every other fact — it is a
        // statement about the device, not a warning, and it is styled like one.
        case "needs-newer-firmware":
          return t.needsNewerFirmware;
        case "no-rom-folder":
          return t.noRomFolder;
        case "no-roms":
          return t.noRoms;
        case "one-rom-matched":
          return t.oneRomMatched;
        case "roms-matched":
          return t.romsMatched(f.count);
        case "needs-user-files":
          return t.needsUserFiles;
        case "prerelease":
          return t.prerelease;
      }
    });
  }

  /**
   * The one meta line under a row's repo slug, as segments joined by a light divider — the
   * Repos artboard’s `WonderSwan, WS Color · .ws .wsc | 4 ROMs matched`.
   *
   * The composition rule itself — what segment 0 says, and that a row never counts titles —
   * lives in `sources/metaLine.ts` so it can be tested. This function only resolves the
   * localised parts and hands them over.
   */
  function metaLine(row: SourceRow): string[] {
    // A bundle row restoring its kept zip is neither yet: it is not usable, but it is also not
    // asking for a file. Say nothing and let `factTexts` show "loading" — the alternative is a
    // line that tells the user to re-import while we are busy proving they do not have to.
    const originNote =
      row.origin === "bundle" && row.status !== "loading"
        ? row.manifest
          ? t.bundleUnverified
          : t.bundleReimport
        : undefined;
    return metaSegments(row.card, originNote, factTexts(row));
  }

  // The "Additional files" section (ui/AdditionalFiles.svelte) reads `biosState`, so the
  // refresh that populates it has to run here: the component only mounts once there are rows,
  // and an effect inside it would never get the chance to fire.
  $effect(() => {
    void biosState.sourceRefs;
    void biosState.games;
    void biosState.candidates;
    void biosState.refresh();
  });

  // The detail is a VIEW, not an expansion: when it is open the list is replaced, which is
  // what makes "Back to sources" mean anything. Local tab state, no router.
  const detail = $derived(selected && detailsOpen ? selected : undefined);

  /**
   * A published date as the artboard writes it ("12 Aug 2026").
   *
   * `publishedAt` is untrusted third-party text, so it is only reformatted when it actually
   * parses as a date; anything else is rendered verbatim as the text it is.
   */
  function published(raw: string): string {
    const ms = Date.parse(raw);
    if (Number.isNaN(ms)) return raw;
    return new Date(ms).toLocaleDateString(locale.current, {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  }

  /** This device family's target, the same pick `store.svelte.ts`'s `toCard` makes. */
  // Raw CORE rows can predate manifest persistence, and a restored row may therefore have
  // only its card. Reconstruct the same synthetic manifest used by the store so the detail
  // page still has an artifact list instead of showing release metadata with no install rows.
  const effectiveManifest = $derived.by(() =>
    detail?.manifest ?? (detail?.origin === "raw" && detail.card ? rawManifestFromCard(detail.card) : undefined),
  );

  const target = $derived.by<Target | undefined>(() => {
    const targets = effectiveManifest?.targets;
    if (!targets || targets.length === 0) return undefined;
    return targets.find((t2) => t2.platform === "game-and-watch") ?? targets[0];
  });

  /**
   * "What gets installed" (ReposDetailReady.dc.html) — the built-state list.
   *
   * The rule is `sources/installRows.ts`, pure so a node test can pin it; this only resolves
   * the stores. `prepareState.get()` is what turns a `built` row from "not built yet" into a
   * real size, which is exactly the ReposDetail -> ReposDetailReady difference.
   *
   * Manifest-only, and the manifest is IN MEMORY ONLY (store.svelte.ts's `SourceRow.manifest`):
   * a reload has the card but not this, so the section reports that it is still loading rather
   * than rendering rows of blanks.
   */
  const installRows = $derived.by(() =>
    composeInstallRows(
      target && detail?.origin === "raw" && target.artifacts.length === 0 && detail.card?.rawArtifacts
        ? { ...target, artifacts: detail.card.rawArtifacts }
        : target,
      effectiveManifest,
      (filename) => prepareState.get(filename)?.length,
      // A derived output is named by its run, never by the manifest, so its rows come from the
      // run's provenance. Without this the page listed a source's shipped binary and dropped
      // every converted file: OpenLara read 136.62 KB, its `.PKD` levels uncounted.
      () => (detail && target ? prepareState.preparedOutputsFor(`${detail.repo}#${target.id}`) : []),
    ),
  );

  const installsTotal = $derived(installTotal(installRows));

  /**
   * The RELEASE panel (SourcesHomebrewConfig / SourcesCoreConfig artboards).
   *
   * MANIFEST-BACKED, ROW BY ROW. Every row here is one declared field and nothing else:
   * `tag`/`publishedAt` and `needsUserFiles` from the resolved versions entry (flattened onto
   * the card), `requiresAbi` from the same, `storage` from the manifest, and — cores only
   * — `systems[].longName` / `systems[].extensions[]`. A field the publisher did not state
   * drops its row rather than showing a guess: `storage` is optional in the schema, and
   * "not stated" is not "neither".
   *
   * The ABI row is TONED, not re-ruled: `abiCompatible()` above is the single caller of
   * `abiSatisfies` (engine/firmwareAbi.ts), and an unknown device ABI makes no claim at all.
   */
  const releaseRows = $derived.by<StatRow[]>(() => {
    const card = detail?.card;
    if (!card) return [];
    const abiOk = detail ? abiCompatible(detail) : null;
    const rows: StatRow[] = [
      { label: t.detail.version, value: card.tag },
      { label: t.detail.published, value: published(card.publishedAt) },
      {
        label: t.release.needsUserFiles,
        value: card.needsUserFiles ? t.release.yes : t.release.no,
      },
      {
        label: t.release.requiresAbi,
        value: t.release.abiOrNewer(card.abiVersion),
        ...(abiOk === null ? {} : { tone: abiOk ? ("ok" as const) : ("warn" as const) }),
      },
    ];
    const storage = detail?.manifest?.storage;
    if (storage && storage.length > 0) {
      rows.push({
        label: t.release.validTargets,
        value: storage
          .map((m) => (m === "sd" ? t.release.storageSd : t.release.storageFlash))
          .join(", "),
      });
    }
    // Core-only rows. `systems` is empty for a homebrew by construction (spec/07 forbids
    // `systems[]` there), so this is a presence test, not a kind test.
    if (card.systems.length > 0) {
      rows.push({
        label: t.release.systems,
        value: card.systems.map((sys) => sys.longName).join(", "),
      });
      const exts = [...new Set(card.systems.flatMap((sys) => sys.extensions))];
      if (exts.length > 0) rows.push({ label: t.release.fileTypes, value: exts.join(" ") });
    }
    return rows;
  });

  // The rail's two groups. Every entry carries its own count, as SourcesRail.dc.html draws
  // it: the remote source lists, and the registered folders of each local kind.
  const railGroups = $derived([
    {
      heading: t.railLocal,
      items: [
        // FIRST, above Directories, and NO second line. The entry used to carry the card's name
        // beneath its label because it holds one thing rather than a list; the owner ruled that
        // out, and it is the same thought as putting the picker on the page: THE RAIL SAYS WHICH
        // SOURCE IS SELECTED, THE PAGE SAYS WHAT THE CARD IS.
        //
        // No count badge either, for the reason Cache has none: a one-of source has nothing to
        // count, and "1" would be a tally of a thing whose presence the row already states.
        // SD ONLY. The card is a source of the SD build's content; on Flash there is no card in
        // play, so the entry is absent rather than present-and-empty. `applyRoute` redirects a
        // deep link to it for the same reason, so the pane cannot be reached with the rail row
        // gone.
        ...(device.targetMedia === "sd"
          ? [{
              id: "local-sd" as SourcePaneId,
              label: t.sd.heading,
              count: null as number | null,
            }]
          : []),
        {
          id: "local-directories" as SourcePaneId,
          label: t.railDirectories,
          count: localFolders.folders.length as number | null,
        },
        // SourcesCache.dc.html draws this entry with NO count badge, unlike its two siblings.
        {
          id: "local-cache" as SourcePaneId,
          label: t.cache.heading,
          count: null as number | null,
        },
      ],
    },
    {
      heading: t.railRemote,
      items: [
        {
          id: "remote-cores" as SourcePaneId,
          label: t.colCores,
          count: sources.byKind.core.length as number | null,
        },
        {
          id: "remote-homebrew" as SourcePaneId,
          label: t.colHomebrew,
          count: sources.byKind.homebrew.length as number | null,
        },
      ],
    },
  ]);

  /**
   * The page's title is the RAIL'S OWN LABEL for the mounted pane.
   *
   * It used to be a second table: a ternary chain over four ids whose final else was
   * `t.colHomebrew`. That made `Homebrew` the title of anything the chain did not name, which
   * is exactly what the SD card page drew. Reading the rail instead means the two can never
   * disagree, and a pane with no entry has no title rather than inheriting the last one.
   */
  const paneTitle = $derived(
    railGroups.flatMap((g) => g.items).find((i) => i.id === pane)?.label ?? "",
  );
  /** The page's own title — the four the artboards state, verbatim. Add or configure. */
  const folderAddTitle = $derived(
    folderEditId !== null ? t.folders.configureDirectoryTitle : t.folders.addDirectoryTitle,
  );
  /** Close the add/configure page, whichever mode it was in. */
  function closeFolderPage(refresh = false): void {
    folderAddOpen = false;
    folderEditId = null;
    if (refresh) void library.refresh();
  }
  // Every pane but the cache states a subtitle, and each is its artboard's line verbatim —
  // a plausible-sounding sentence written here would be invented UI. Remote Cores stated none
  // until the Emulator/Core rename, because no board drew one; SourcesUpdateAll.dc.html now
  // does, and that line is the one place the UI says what a "core" is (sources.ts).
  const paneSubtitle = $derived(
    folderAddOpen
      ? null
      : pane === "remote-cores"
        ? t.coresSubtitle
        : pane === "remote-homebrew"
        ? t.homebrewSubtitle
        : pane === "local-directories"
          ? t.folders.subtitleDirectories
          : null,
  );

  function select(repo: string) {
    sources.selected = sources.selected === repo ? null : repo;
    detailsOpen = false;
  }
</script>

<section class="split">
  <!-- SourcesRail.dc.html:72 — the same full-bleed `244px minmax(0, 1fr)` grid the Firmware
       tab draws (lib/advanced/FirmwareRail.svelte), so the rail's border-right is the region
       edge and runs the full height. Both columns own their own padding. -->
  <nav class="rail" aria-label={t.heading}>
    {#each railGroups as g (g.heading)}
      <div class="group">
        <h3 class="railhead">{g.heading}</h3>
        {#each g.items as it (it.id)}
          <button
            class="item"
            class:selected={pane === it.id}
            aria-current={pane === it.id ? "true" : undefined}
            onclick={() => {
              pane = it.id;
              bulkSelected = new Set();
              detailsOpen = false;
              addOpen = false;
              folderAddOpen = false;
            }}
            ><span>{it.label}</span>{#if it.count !== null}<span class="count">{it.count}</span
              >{/if}</button
          >
        {/each}
      </div>
    {/each}
  </nav>

  <div class="sources">
  <!-- The capped body column. SourcesRail.dc.html draws the footer bar as a SIBLING of the
       padded body div, so the cap and the 40px sides belong to THIS wrapper, not to the
       column — a bar nested inside the cap can cancel the padding with a negative margin
       but never the cap itself. -->
  <div class="pagecol">
  {#if detail}
    <!-- ReposDetail.dc.html caps the detail BODY (header + panels, not the footer bar) at
         `max-width: 900px` with `gap: 30px`. Scoped to this view on purpose: the global
         page cap is `--maxw` and must never be narrowed for one tab (CLAUDE.md). -->
    <div class="dbody">
      <header class="dhead">
        <div class="dident">
          <h2 class="dtitle">{detail.card?.title ?? detail.repo}</h2>
          <div class="dmeta">
            <span class="repo">{sourceDisplayName(detail)}</span>
            <span class="kind"
              >{isCoreKind(detail.card?.kind) ? t.colCores : t.colHomebrew}</span
            >
          </div>
        </div>
        <button class="back" type="button" onclick={() => (detailsOpen = false)}
          >&#8592; {t.backToSources}</button
        >
      </header>

      <!-- RELEASE (SourcesHomebrewConfig / SourcesCoreConfig). A two-column definition
           grid: StatPanel's "defs" variant, the shared label/value list. Every row is a
           declared manifest field — see `releaseRows`. -->
      {#if detail.card}
        {@const card = detail.card}
        <!-- The version list the picker offers. Empty for a bundle row and for a card written
             before the list was retained, in which case no control is drawn at all — and empty
             at ONE entry too, because there is then no older version to get. Every label here is
             untrusted manifest text and is interpolated as text; an <option> renders it with
             textContent semantics like everything else. -->
        {@const versions = detail.origin === "bundle" ? [] : (card.versions ?? [])}
        <div class="section">
          <div class="cap">{t.release.heading}</div>
          <div class="panel boxed">
            <StatPanel variant="defs" rows={releaseRows} />
            {#if versions.length > 1}
              <!-- The Version ROW is text, so the picker is its own affordance under the
                   grid: the artboards draw a plain value there, and getting an older
                   release is an action, not a definition. The control is the existing
                   transparent-<select>-over-a-drawn-box (ReposDetailReady) — only the
                   native control keeps the platform dropdown, keyboard behaviour and the
                   accessible name. -->
              <div class="vrow">
                <div class="vbox">
                  <span class="version-val">
                    <span class="tag">{card.tag}</span>
                    <span class="when">{published(card.publishedAt)}</span>
                  </span>
                  <svg
                    class="chev"
                    width="12"
                    height="12"
                    viewBox="0 0 20 20"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="1.8"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    aria-hidden="true"><path d="M5 8l5 5 5-5" /></svg
                  >
                  <select
                    class="vpick"
                    aria-label={t.detail.version}
                    disabled={switching}
                    value={card.tag}
                    onchange={(e) => {
                      const tag = e.currentTarget.value;
                      switching = true;
                      void sources.selectVersion(detail.repo, tag).finally(() => (switching = false));
                    }}
                  >
                    {#each versions as v (v.tag)}
                      <option value={v.tag}
                        >{v.tag} — {published(v.publishedAt)}{v.prerelease
                          ? ` (${t.prerelease})`
                          : ""}</option
                      >
                    {/each}
                  </select>
                </div>
                {#if switching}
                  <span class="when">{t.loading}</span>
                {:else}
                  <span class="older">{t.detail.getOlderVersion}</span>
                {/if}
              </div>
            {/if}
          </div>
        </div>
      {/if}

      <AdditionalFiles source={detail} />

      <!-- WHAT GETS INSTALLED (ReposDetailReady.dc.html): a type chip, the mono filename and
           its size, with a Total once every row has one. Restored — a redesign pass dropped it
           on the grounds that the two Config boards do not draw it, but ReposDetailReady does
           and it is the only place the user is told what an install actually writes. -->
      {#if installRows.length > 0}
        <div class="section">
          <div class="cap">{t.detail.installs}</div>
          <div class="panel">
            {#each installRows as row (row.key)}
              <div class="irow">
                <span class="itype" class:built={row.type === "built"}
                  >{row.type === "binary"
                    ? t.detail.typeBinary
                    : row.type === "data"
                      ? t.detail.typeData
                      : t.detail.typeBuilt}</span
                >
                <span class="iname">{row.filename}</span>
                {#if row.bytes === undefined}
                  <span class="isize pending">{t.detail.notBuiltYet}</span>
                {:else}
                  <span class="isize" class:strong={row.type === "built"}
                    >{formatSize(row.bytes)}</span
                  >
                {/if}
              </div>
            {/each}
            {#if installsTotal !== null}
              <div class="irow total">
                <span class="tlabel">{t.detail.total}</span>
                <span class="tval">{formatSize(installsTotal)}</span>
              </div>
            {/if}
          </div>
        </div>
      {:else if detail.status === "loading"}
        <div class="section">
          <div class="cap">{t.detail.installs}</div>
          <p class="empty">{t.loading}</p>
        </div>
      {/if}

      <!-- SOURCES: the local folders this source draws user files from. `target` is the
           manifest target this device family gets (the same pick store.svelte.ts makes), and
           with the repo it forms the association key the folder model uses. -->
      {#if target}
        <SourceFolders repo={detail.repo} targetId={target.id} />
      {/if}

      <div class="dactions">
        <Button variant="destructive" onclick={() => sources.remove(detail.repo)}
          >{t.remove}</Button
        >
      </div>
    </div>
  {:else if addOpen}
    <!-- ReposAdd is a full page that REPLACES the list, with its own back affordance and
         its Add in the footer bar — not a panel wedged between the header and the columns. -->
    <header class="dhead">
      <div class="dident">
        <h2 class="dtitle">{t.addTitle}</h2>
      </div>
      <button
        class="back"
        type="button"
        onclick={() => {
          addOpen = false;
          sources.addError = null;
        }}>&#8592; {t.backToSources}</button
      >
    </header>

    <div class="panebody">
    <AddSource
      bind:this={addRef}
      bind:canAdd={addCanAdd}
      onDone={() => {
        addOpen = false;
      }}
    />
    </div>
  {:else}
    <header class="head">
      <div class="pagehead">
        <h2>{folderAddOpen ? folderAddTitle : paneTitle}</h2>
        {#if paneSubtitle}<p class="pagesub">{paneSubtitle}</p>{/if}
      </div>
      <!-- Repos.dc.html draws Add as a bare green affordance — a 15px plus glyph and the word
           `Add` at 14px/600 #3e9e4e, no box. The accessible name keeps the longer `Add source`
           so the control still reads unambiguously out of context. -->
      {#if isRemote && remoteKind}
      <div class="headacts">
      <!-- SourcesUpdateAll.dc.html: the pane's bulk refresh, drawn in the same bare green
           idiom as Add (no box, 14px/600) with a circular-arrow glyph instead of the plus.
           While it runs it drops to --ink-soft and is disabled; the rows themselves going to
           their loading state are the progress, which is why no busy STRING was invented. -->
      <button
        class="addlink"
        class:busy={sources.updating === remoteKind}
        type="button"
        disabled={sources.updating === remoteKind}
        onclick={() => void sources.updateAll(remoteKind)}
      >
        <svg
          width="15"
          height="15"
          viewBox="0 0 20 20"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
          ><path d="M16.5 8A7 7 0 1 0 17 11" /><path d="M17 4v4h-4" /></svg
        >
        <span>{t.updateAll}</span>
      </button>
      <button
        class="addlink"
        type="button"
        aria-label={t.addSource}
        onclick={() => {
          addOpen = true;
          sources.addError = null;
        }}
      >
        <svg
          width="15"
          height="15"
          viewBox="0 0 20 20"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          aria-hidden="true"><path d="M10 4v12M4 10h12" /></svg
        >
        <span>{t.add}</span>
      </button>
      </div>
      {/if}
    </header>

    {#if isLocal && folderAddOpen}
      <div class="panebody">
      {#key folderEditId}
        <AddLocalFolder
          bind:this={folderAddRef}
          bind:canAdd={folderCanAdd}
          editId={folderEditId}
          onDone={() => closeFolderPage(true)}
        />
      {/key}
      </div>
    {:else if isSd}
      <div class="panebody">
        <SdCardPane
          state={sdStorage.state}
          stated={statedCard}
          onChoose={() => void pickSdCard()}
          onRescan={() => void rescanSdCard()}
          onState={setStated}
        />
      </div>
    {:else if isCache}
      <div class="panebody"><CachePane bind:this={cacheRef} /></div>
    {:else if isLocal}
      <!-- SourcesRomFolders / SourcesLocalHomebrew, now one list. Neither artboard draws an
           empty state, so a pane with no folders is blank rather than carrying invented copy. -->
      <div class="panebody">
      <LocalFolders
        bind:selectedId={localSelected}
        onConfigure={(id) => {
          folderEditId = id;
          folderAddOpen = true;
        }}
      />
      </div>
    <!-- The remote catalogue list, and the ONLY branch that reads `remoteKind`. Testing the kind
         itself rather than closing with a bare `{:else}` is what keeps a pane with no catalogue
         out of here: that else-branch is where `local-sd` used to land. -->
    {:else if remoteKind}
      {@const rows = remoteKind === "core" ? sources.byKind.core : sources.byKind.homebrew}
      <div class="listregion">
      {#if rows.length > 0}
        <div class="bulkbar">
          <label class="bulkselect">
            <input type="checkbox" checked={allBulkSelected} onchange={toggleAllBulk} />
            <span>{allBulkSelected ? t.clearSelection : t.selectAllSources}</span>
          </label>
        </div>
      {/if}
      <div class="list">
        {#if rows.length === 0}
          <p class="empty">{t.emptyColumn}</p>
        {:else}
          {#each rows as row (row.repo)}
            {@const segments = metaLine(row)}
            <div
              class="row"
              class:sel={sources.selected === row.repo}
              role="button"
              tabindex="0"
              onclick={() => select(row.repo)}
              onkeydown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  select(row.repo);
                }
              }}
            >
              <input
                class="rowcheck"
                type="checkbox"
                checked={bulkSelected.has(row.repo)}
                aria-label={row.card?.title ?? row.repo}
                onclick={(e) => e.stopPropagation()}
                onchange={() => toggleBulk(row.repo)}
              />
              <div class="main">
                <div class="identity">
                  <div class="name">{row.card?.title ?? row.repo}</div>
                  <div class="repo">{sourceDisplayName(row)}</div>
                </div>
                {#if segments.length > 0}
                  <div class="meta" class:bad={row.status === "error"}>
                    {#each segments as segment, i (i)}{#if i > 0}<span class="sep">|</span
                      >{/if}{segment}{/each}
                  </div>
                {/if}
              </div>
              <div class="side">
                <div class="version">{row.card?.tag ?? ""}</div>
                <span class="pill" class:on={row.active}>{row.active ? t.active : t.inactive}</span>
              </div>
            </div>
          {/each}
        {/if}
      </div>
      </div>
      <!-- SourcesCuratedUnreadable.dc.html: curated entries whose own versions.json could not
           be read are never rows (a row with no card would park in the wrong rail, and an
           offline first visit would draw ~22 of them). One quiet note per section instead, on
           the ground with no border, naming them on a single ellipsised mono line. Rail counts
           are untouched: a failed entry is not a source you have. -->
      {@const failed = sources.curatedFailuresByKind[remoteKind]}
      {#if failed.length > 0}
        <div class="curatedfail">
          <div class="curatedfailhead">
            <span class="curatedfailmsg">{t.curatedUnreadable(failed.length)}</span>
            <button
              type="button"
              class="curatedfailretry"
              onclick={() => void sources.retryCurated(remoteKind)}>{t.retry}</button
            >
          </div>
          <span class="curatedfailnames">{failed.map((f) => f.title).join(", ")}</span>
        </div>
      {/if}
    {/if}
  {/if}
  </div>

  <footer class="bar">
    <span class="barname" class:strong={isRemote && !detail && !addOpen && !!selected}
      >{#if isCache || isSd}{""}{:else if isLocal && folderAddOpen}{""}{:else if isLocal}{t.folders.count(localRows.length)}{:else if detail}{detail.active
          ? t.activeHint
          : t.notActiveHint}{:else if addOpen}{""}{:else}{selected
          ? (selected.card?.title ?? selected.repo)
          : t.noSelection}{/if}</span
    >
    <div class="baracts">
      {#if isSd}
        <!-- Nothing. The page reads a card it must never modify, so the bar has no action to
             offer; the picker that changes the card lives on the page itself. -->
      {:else if isCache}
        <!-- SourcesCache.dc.html's one footer action: the outlined dark cap. -->
        <Button variant="ink" onclick={() => void cacheRef?.emptyAll()}>{t.cache.empty}</Button>
      {:else if isLocal && folderAddOpen}
        <!-- SourcesAddRoms / SourcesAddHomebrewDir: Cancel, then the green "Add source". -->
        <Button variant="default" onclick={closeFolderPage}
          >{locale.t.shared.common.cancel}</Button
        >
        <Button
          variant="action"
          disabled={!folderCanAdd}
          onclick={() => void folderAddRef?.submit()}
          >{folderEditId !== null ? t.folders.save : t.addSource}</Button
        >
      {:else if isLocal}
        <!-- Both local artboards put BOTH actions in the bar: Remove (acting on the selected
             card) and the plus + "Add source". -->
        <Button variant="default" disabled={!localSelected} onclick={() => void removeLocalFolder()}
          >{t.remove}</Button
        >
        <Button variant="default" onclick={() => (folderAddOpen = true)}>
          <svg
            class="plus"
            width="13"
            height="13"
            viewBox="0 0 20 20"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            aria-hidden="true"><path d="M10 4v12M4 10h12" /></svg
          >{t.addSource}</Button
        >
      {:else if addOpen}
        <Button
          variant="action"
          disabled={!addCanAdd}
          onclick={() => void addRef?.submit()}>{sources.adding ? t.adding : t.add}</Button
        >
      {:else if isRemote && !detail && bulkSelected.size > 0}
        <Button variant="ink-solid" onclick={() => {
          for (const row of remoteRows) if (bulkSelected.has(row.repo)) sources.setActive(row.repo, true);
          bulkSelected = new Set();
        }}>{t.activate}</Button>
        <Button variant="ink-solid" onclick={() => {
          for (const row of remoteRows) if (bulkSelected.has(row.repo)) sources.setActive(row.repo, false);
          bulkSelected = new Set();
        }}>{t.deactivate}</Button>
      {:else if selected}
        {#if selected.status === "error"}
          <Button variant="default" onclick={() => void sources.refresh(selected.repo)}
            >{t.retry}</Button
          >
        {/if}
        {#if !detail && bulkSelected.size === 0}
          <Button variant="default" onclick={() => (detailsOpen = true)}>{t.configure}</Button>
        {/if}
        <!-- ReposDetail.dc.html fills this cap (`#1b1b1b`/white, inset lip). Two artboards
             disagree on the DEACTIVATE state — Repos.dc.html outlines it, ReposDetailReady
             draws bare red text — so both states take the filled cap: the owner's
             install-confirm ruling (the fill won) applies to the same footer-primary slot,
             and one chrome across both states keeps the bar from reflowing on toggle. -->
        <Button
          variant="ink-solid"
          onclick={() => sources.setActive(selected.repo, !selected.active)}
          >{selected.active ? t.deactivate : t.activate}</Button
        >
      {/if}
    </div>
  </footer>
  </div>
</section>

<style>
  /* The Add-source cap in the local panes' footer bar carries the artboard's plus glyph
     inline before its word (`.btn` is not a flex box, so the icon just sits in the text
     flow with the artboard's 7px gap after it). */
  .plus {
    vertical-align: -1px;
    margin-inline-end: 7px;
  }
  /* SourcesRail.dc.html:72 — the same full-bleed grid FirmwareRail.svelte draws, for the same
     reason: the rail's border-right is the region edge, so it must reach the page edge on the
     left and run the region's full height. `.tabpane.bleed` (Advanced.svelte) drops the cap
     and the side/vertical padding for this pane; both columns own their padding here. */
  .split {
    display: grid;
    grid-template-columns: 244px minmax(0, 1fr);
    gap: 0;
    align-items: stretch;
    flex: 1;
    width: 100%;
    min-height: 0;
  }
  .rail {
    border-inline-end: 1px solid var(--hairline);
    /* LOGICAL, not `padding: 32px 20px 40px var(--page-pad-x)`. The rail is the grid's leading
       column and `border-inline-end` beside it already mirrors, so the page gutter has to as
       well. Physically pinned to the left it stayed there when the grid mirrored under
       `dir=rtl`, moving the 40px page gutter to the rail's INNER edge and leaving the page
       edge with the 20px meant for the inside. Artboard: `padding: 32px 20px 40px 40px`. */
    padding-block: 32px 40px;
    padding-inline: var(--page-pad-x) 20px;
    display: flex;
    flex-direction: column;
    gap: 26px;
  }
  .group {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .railhead {
    margin: 0;
    padding-bottom: 6px;
    font-size: var(--fs-label);
    font-weight: 700;
    letter-spacing: var(--label-track);
    text-transform: uppercase;
    color: var(--ink-soft);
  }
  .item {
    font: inherit;
    font-size: 14px;
    text-align: start;
    background: transparent;
    border: none;
    color: var(--ink);
    padding: 7px 0;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
  }
  .item .count {
    font-size: var(--fs-micro);
    color: var(--ink-soft);
  }
  .item.selected {
    font-weight: 600;
    /* The marker sits on the rail's own edge, not inset. */
    box-shadow: inset 2px 0 0 var(--zelda-green);
    padding-inline-start: 14px;
    margin-inline-start: -14px;
  }
  /* The pane column: the artboards' `flex-column; justify-content: space-between` wrapper
     holding the padded body and the full-column-width footer bar. */
  /* Full-bleed now: the cap and the side padding moved down to `.pagecol` (Advanced.svelte's
     `.tabpane.docked` no longer applies `.page-body` to this pane) so `.bar` can run edge to
     edge at every viewport width, exactly as Repos.dc.html:76 draws it. */
  .pagecol {
    display: flex;
    flex-direction: column;
    /* Artboard: `padding: 32px 40px 40px; gap: 32px; max-width: 720px`. `.page-body` no
       longer applies here (the pane is full-bleed), so the cap and sides live on this
       wrapper — which keeps the footer bar below a full-width sibling. */
    padding: 32px var(--page-pad-x) 40px;
    max-width: 720px;
    box-sizing: border-box;
    min-width: 0;
    /* The 28px header-to-body gap the artboards draw; it used to live on `.sources`, where it
       also fell between the body and the footer bar. */
    gap: 28px;
    flex: 1 1 auto;
    min-height: 0;
  }
  .sources {
    display: flex;
    flex-direction: column;
    min-width: 0;
    /* Repos.dc.html:72 and ReposAdd.dc.html:72 both draw the page body as
       `display: flex; flex-direction: column; gap: 28px`. This is the header-to-body
       gap on the list and add views. The footer bar is a child here rather than a
       sibling of the body (see `.bar`), so the same gap also lands above it — the
       artboard's equivalent there is the body's own 40px bottom padding, and at any
       viewport tall enough for `margin-top: auto` to bite the difference is invisible. */
    /* Gap moved to `.pagecol`: with the bar a sibling of the capped column, a gap here would
       add 28px above the footer that the artboard does not draw. */
    gap: 0;
    /* Grow to fill App.svelte's `.body` (itself `flex: 1` in a `min-height: 100vh`
       column) so `.bar`'s `margin-top: auto` has slack to push against. */
    flex: 1;
    min-height: 0;
  }
  /* ReposDetail.dc.html's body div: `gap: 30px; max-width: 900px`. The footer bar is
     OUTSIDE it and stays full-bleed, which is why this is a wrapper and not a cap on
     `.sources`. */
  .dbody {
    display: flex;
    flex-direction: column;
    gap: 30px;
    max-width: 900px;
    width: 100%;
    /* Same growth chain the Library dock got (0ebbe67): `.sources` already grows inside
       `.tabpane`, but nothing INSIDE it claimed the height, so the content shrink-wrapped.
       `align-items` stays at its default on the children, so no panel is stretched — the
       white surfaces still hug their rows exactly as the artboards draw them; only the
       scroll container grows. `min-height: 0` is what lets it actually shrink once the
       queued `overflow: hidden` root lands, and `overflow-y: auto` turns page growth into
       internal scroll at that point. Until then the page keeps its own scrollbar. */
    flex: 1 1 auto;
    min-height: 0;
    overflow-y: auto;
  }
  /* Floor, added after the fixed-viewport root landed (5567424). `.sources` is
     `flex: 1; min-height: 0` inside the `.tabpane` scroller, and `.bar` is `flex: 0 0 auto`,
     so EVERY pixel the window loses comes out of this region — with no floor it reaches zero
     height at about a 283px window, and a zero-height `overflow-y: auto` box has no usable
     scrollbar, i.e. the detail view becomes genuinely unreachable. The floor is derived from
     the smallest useful detail viewport: `.dhead` (24px title + 18px meta line + gaps, ~56px)
     + the body's own 30px gap + one panel row (~48px) = 134px. Below that `.sources`
     (overflow visible, no clip) hands the excess up to `.tabpane`, which scrolls it —
     the bar unpins and scrolls with it, which is the correct trade against losing the content.
     It bites only under a ~417px window, so at every real viewport (700px, 600px and well
     below) the artboard's pinned bar and single internal scroller are unchanged. */
  .dbody {
    min-height: 134px;
  }
  .head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 1rem;
  }
  /* Artboard pane heading: 24px/600/-0.015em title over a 14px soft subtitle, 6px apart —
     the same shape FirmwareRail's `.pagehead` draws. */
  .pagehead {
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-width: 0;
  }
  .pagesub {
    margin: 0;
    font-size: var(--fs-caption);
    color: var(--ink-soft);
  }
  /* The three panes that had NO scroll region of their own: the folder list, the add/edit
     folder form and the cache pane. `.dbody` and `.listregion` each claim the pane's slack
     height and scroll internally; these three were plain blocks rendered straight into
     `.pagecol`, which is `flex: 1 1 auto; min-height: 0` and so refuses to grow past the
     viewport. Their content therefore spilled out of `.pagecol` with `overflow: visible` and
     `.bar` -- a later sibling carrying an opaque `background: var(--surface)` -- painted over
     it. That is what made the footer bar cover the open "Used by" menu, and it covered a long
     folder list just as readily with no menu involved.

     Same shape as `.listregion`, and the same 104px floor for the same reason (one caption
     plus one 40px field and its gaps): below that a zero-height `overflow-y: auto` box has no
     usable scrollbar. NOT an overflow rule on `.tabpane`, `.shell` or `.page` -- this is a
     region INSIDE the pane, exactly like the two that already existed, so the tab itself
     still scrolls and cannot be clipped. */
  .panebody {
    flex: 1 1 auto;
    min-height: 104px;
    overflow-y: auto;
  }
  /* The single remote list takes the pane's slack height; same floor and same reason as
     `.dbody` (one caption + one two-line row). The white panel stays a child so a selected
     row's -18px bleed is not clipped by the scroller. */
  .listregion {
    flex: 1 1 auto;
    min-height: 104px;
    overflow-y: auto;
  }
  h2 {
    margin: 0;
    font-size: var(--fs-display);
    font-weight: 600;
    letter-spacing: -0.015em;
  }
  /* Repos.dc.html: `display:flex; align-items:center; gap:8px`, green, no chrome. */
  .addlink {
    display: flex;
    align-items: center;
    gap: 8px;
    appearance: none;
    border: 0;
    background: none;
    padding: 0;
    font: inherit;
    font-size: var(--fs-btn);
    font-weight: 600;
    color: var(--zelda-green);
    cursor: pointer;
  }
  .addlink:hover span {
    text-decoration: underline;
  }
  .headacts {
    display: flex;
    align-items: center;
    gap: 22px;
  }
  /* Running: the control stops offering itself. No spinner — the rows carry the progress. */
  .addlink.busy {
    color: var(--ink-soft);
    cursor: default;
  }
  .addlink.busy:hover span {
    text-decoration: none;
  }
  /* No border to carry a focus ring, so it gets its own. */
  .addlink:focus-visible {
    outline: 2px solid var(--zelda-green);
    outline-offset: 3px;
    border-radius: var(--r-control);
  }

  /* SourcesCuratedUnreadable.dc.html: a failure is not an object, so this note gets no
     border and no surface — it sits on the page ground under the list. */
  .curatedfail {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 18px 0 0;
  }
  .curatedfailhead {
    display: flex;
    align-items: baseline;
    gap: 14px;
  }
  .curatedfailmsg {
    font-size: var(--fs-btn);
    color: var(--ink-soft);
  }
  .curatedfailretry {
    appearance: none;
    border: 0;
    background: none;
    padding: 0;
    font: inherit;
    font-size: var(--fs-btn-sm);
    font-weight: 500;
    color: var(--zelda-green);
    cursor: pointer;
  }
  .curatedfailretry:hover {
    text-decoration: underline;
  }
  .curatedfailretry:focus-visible {
    outline: 2px solid var(--zelda-green);
    outline-offset: 3px;
    border-radius: var(--r-control);
  }
  /* One line, ellipsised — this is what keeps the all-failing case from being a wall. */
  .curatedfailnames {
    max-width: 420px;
    font-size: var(--fs-btn-sm);
    color: var(--ink-soft);
    font-family: var(--font-mono);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* Repos draws this as a borderless white panel on the grey ground: the surface is what
     holds the rules apart, and `--hairline` is reserved for region edges (audit 2.6). The
     horizontal 18px stays so a selected row's -18px bleed still lands on the panel's edge. */
  .list {
    background: var(--surface);
    border-radius: var(--r-card);
    padding: 2px 18px;
  }
  .bulkbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    min-height: 42px;
    padding: 0 2px 10px;
  }
  .bulkselect {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    color: var(--ink-soft);
    font-size: var(--fs-btn-sm);
    cursor: pointer;
  }
  .bulkselect input,
  .rowcheck {
    width: 16px;
    height: 16px;
    accent-color: var(--zelda-green);
    cursor: pointer;
  }
  .bulkselect input:focus-visible,
  .rowcheck:focus-visible {
    outline: 2px solid var(--zelda-green);
    outline-offset: 2px;
  }
  .empty {
    margin: 0;
    color: var(--ink-soft);
    font-size: var(--fs-caption);
  }

  .row {
    display: flex;
    align-items: center;
    /* Repos.dc.html:74: the row's name block and its version/state column are 20px apart. */
    gap: 14px;
    padding: 11px 0;
    cursor: pointer;
    box-sizing: border-box;
  }
  .rowcheck {
    flex: none;
    margin-block: 0;
    margin-inline: 0 2px;
  }
  .row + .row {
    border-top: 1px solid var(--rule);
  }
  /* Selection bleeds past the card's own padding so the green marker sits on its edge. */
  .row.sel {
    background: var(--tint-select);
    box-shadow: inset 2px 0 0 var(--zelda-green);
    margin: 0 -18px;
    padding: 11px 18px;
    width: calc(100% + 36px);
  }
  /* Repos.dc.html:74: `display: flex; flex-direction: column; gap: 3px; flex-grow: 1;
     min-width: 0`. As a plain block the three lines stacked flush; only `.meta` had any
     separation (its own 3px padding-top, which the artboard keeps ON TOP of the gap). */
  .main {
    display: flex;
    flex-direction: column;
    gap: 3px;
    flex: 1;
    min-width: 0;
  }
  .identity {
    display: flex;
    align-items: baseline;
    gap: 12px;
    min-width: 0;
  }
  .name {
    flex: 0 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-weight: 600;
    /* Repos.dc.html: `font-size: 15px; font-weight: 600`. */
    font-size: var(--fs-lede);
  }
  .repo {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-family: var(--font-mono);
    font-size: var(--fs-micro);
    color: var(--ink-soft);
  }
  .meta {
    /* Repos.dc.html: 13px. --fs-btn-sm is the project's only 13px token. */
    font-size: var(--fs-btn-sm);
    color: var(--ink-soft);
    padding-top: 3px;
  }
  .sep {
    color: var(--ink-faint);
    margin: 0 8px;
  }
  .meta.bad {
    color: var(--danger);
  }

  .side {
    width: 104px;
    flex: 0 0 104px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
  }
  /* Repos.dc.html draws the version as `font-size: 13px; font-weight: 600; color: #1b1b1b;
     white-space: nowrap` — proportional and full-strength, NOT the mono/soft treatment the
     row's `.repo` slug uses. */
  .version {
    font-size: var(--fs-btn-sm);
    font-weight: 600;
    color: var(--ink);
    white-space: nowrap;
  }
  /* Repos.dc.html outlines the inactive pill instead of filling it: white surface,
     1px #c8c8c8 (--ink-faint), 3px 12px. Active stays the filled green pill, with a
     border of its own colour so the two read at the same size (audit 2.8). */
  .pill {
    font-size: var(--fs-chip);
    font-weight: 600;
    padding: 3px 12px;
    border-radius: 999px;
    background: var(--surface);
    border: 1px solid var(--ink-faint);
    color: var(--ink-soft);
  }
  .pill.on {
    background: var(--zelda-green);
    border-color: var(--zelda-green);
    color: #ffffff;
    box-shadow: var(--chip-inset);
  }

  /* Same anchored footer as the Advanced panes' `.panefoot` (lib/advanced/FirmwareRail.svelte)
     and the Library dock's `.bar`: 72px minimum, own surface, hairline top edge, its OWN
     `--page-pad-x` sides. `margin-top: auto` inside `.sources` (which is `flex: 1` in
     App.svelte's flex-column `.body`) is what makes it the LAST thing in the column and keeps
     it on the bottom edge when the page is shorter than the viewport.

     Repos.dc.html:76 draws the bar as a SIBLING of the padded body div (`padding: 36px 40px
     40px`), carrying `padding: 0 40px` itself — i.e. full-bleed, caption at 40px from the page
     edge, rule running the whole width. Here the bar lives INSIDE `.tabpane.page-body`, which
     already applies `--page-pad-x` and `--page-pad-bottom`, so it would otherwise sit at 80px
     with a short rule and a 40px gutter beneath it. The three negative margins cancel exactly
     those three values, putting the bar back where the artboard draws it. Same shape as
     `.tabpane.bleed` giving FirmwareRail's footer the full column — done locally because the
     cap and padding are correct for every other part of this view. */
  .bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    min-height: 72px;
    max-height: 88px;
    box-sizing: border-box;
    /* Pinned, never squeezed: the growth above is what moves, the dock does not. */
    flex: 0 0 auto;
    margin-top: auto;
    /* No negative margins any more: the bar is a SIBLING of the capped `.pagecol`, so it is
       already full-bleed and already flush with the pane's bottom edge
       (`.tabpane.docked { padding-bottom: 0 }`). It carries only its own 40px sides. */
    padding: 0 var(--page-pad-x);
    background: var(--surface);
    border-top: 1px solid var(--hairline);
  }
  .barname {
    font-size: var(--fs-btn-sm);
    color: var(--ink-soft);
  }
  /* Repos.dc.html's bar carries the SELECTED SOURCE'S NAME at 13px/600 #1b1b1b; the detail
     artboards' bar carries a sentence, and draw that one 13px soft. Same slot, two weights. */
  .barname.strong {
    font-weight: 600;
    color: var(--ink);
  }
  /* Repos.dc.html:76 spaces the two footer actions 12px apart. */
  .baracts {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  /* Detail-view header (ReposDetail artboard): 24px title, mono slug + kind chip,
     back control right-aligned on the same baseline. */
  .dhead {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: 1rem;
  }
  .dident {
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-width: 0;
  }
  .dtitle {
    margin: 0;
    font-size: var(--fs-display);
    letter-spacing: -0.015em;
  }
  .dmeta {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .kind {
    /* ReposDetail.dc.html: 10px, tracked 0.06em — a badge, not a --label-track caption. */
    font-size: var(--fs-badge);
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--ink-soft);
    background: var(--chip-fill);
    border-radius: 2px;
    padding: 3px 6px;
    white-space: nowrap;
  }
  .back {
    flex-shrink: 0;
    appearance: none;
    border: 0;
    background: none;
    padding: 0;
    font: inherit;
    font-size: var(--fs-btn);
    font-weight: 500;
    color: var(--ink-soft);
    cursor: pointer;
  }
  .back:hover {
    color: var(--ink);
  }

  /* Detail body (ReposDetail / ReposDetailReady). The de-boxed language: an uppercase
     caption over a borderless white panel whose rows are separated by --rule. No cards. */
  .cap {
    font-size: var(--fs-label);
    font-weight: 700;
    letter-spacing: var(--label-track);
    text-transform: uppercase;
    color: var(--ink-soft);
  }
  .section {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }
  .panel {
    background: var(--surface);
    border-radius: var(--r-card);
    padding: 2px 18px;
  }
  /* SourcesHomebrewConfig.dc.html draws the config page's panels as bordered white cards with
     even 18px padding — the one place the de-boxed language is deliberately not applied, and
     the artboards are explicit about it on both boards. */
  .panel.boxed {
    border: 1px solid var(--hairline);
    padding: 18px;
  }

  /* The version picker's own row: the drawn box plus its caption, under the Release grid. */
  .vrow {
    display: flex;
    align-items: center;
    gap: 1rem;
    margin-top: 14px;
  }
  .version-val {
    display: flex;
    align-items: baseline;
    gap: 10px;
    font-family: var(--font-mono);
    font-size: var(--fs-btn);
    min-width: 0;
  }
  .version-val .when {
    color: var(--ink-soft);
  }
  /* The box the artboard draws: always present, never revealed by a click. The <select>
     covers it invisibly, so every visible pixel here is ours. */
  .vbox {
    position: relative;
    height: 40px;
    min-width: 230px;
    max-width: 100%;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    padding: 0 12px;
    background: var(--surface);
    border: 1px solid var(--hairline);
    border-radius: var(--r-btn);
  }
  .chev {
    flex: none;
    color: var(--ink-soft);
  }
  /* `opacity: 0` hides the CONTROL, not the popup it opens — and the popup is UA-painted from
     the select's own computed colours. With none declared it inherited `color: var(--ink)`
     (#ececec in dark) onto Chromium's light popup ground. Both are stated explicitly here so
     the list tracks the theme; neither is visible on the closed control, which stays fully
     transparent. */
  .vpick {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    appearance: none;
    opacity: 0;
    font: inherit;
    cursor: pointer;
    background: var(--surface);
    color: var(--ink);
  }
  .vpick option {
    background: var(--surface);
    color: var(--ink);
  }
  .vpick:disabled {
    cursor: default;
  }
  .vpick:focus-visible {
    outline: none;
  }
  .vbox:has(.vpick:focus-visible) {
    outline: 2px solid var(--zelda-green);
    outline-offset: 1px;
  }
  .vbox:has(.vpick:disabled) .version-val {
    color: var(--ink-soft);
  }
  /* "Get older version": the artboard's green text affordance, not a button shape. */
  /* "Get older version": the artboard's green text affordance. It LABELS the box beside it
     (the native <select> is the control), so it is a caption, not a second button. */
  .older {
    font-size: var(--fs-btn-sm);
    font-weight: 600;
    color: var(--zelda-green);
  }

  /* Remove has no place in either artboard (their only action is the footer bar's
     Activate/Deactivate), but it is a real capability, so it trails the body rather than
     competing with the bar. */
  /* "What gets installed": type chip, mono filename, size (ReposDetailReady.dc.html). */
  .irow {
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 10px 0;
  }
  .irow + .irow {
    border-top: 1px solid var(--rule);
  }
  .itype {
    flex-shrink: 0;
    min-width: 46px;
    text-align: center;
    /* ReposDetail.dc.html: 10px/0.06em, matching `.kind`. */
    font-size: var(--fs-badge);
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--ink-soft);
    background: var(--chip-fill);
    border-radius: 2px;
    padding: 3px 6px;
    white-space: nowrap;
  }
  /* A built file is the one this tab can actually produce, so it is the one marked. */
  .itype.built {
    color: var(--zelda-green);
    background: var(--tint-success);
  }
  .iname {
    flex: 1;
    min-width: 0;
    font-family: var(--font-mono);
    font-size: var(--fs-btn);
    overflow-wrap: anywhere;
  }
  .isize {
    flex-shrink: 0;
    font-family: var(--font-mono);
    font-size: var(--fs-chip);
    color: var(--ink-soft);
  }
  .isize.strong {
    color: var(--ink);
    font-weight: 600;
  }
  .isize.pending {
    color: var(--ink-dim);
  }
  .irow.total {
    justify-content: space-between;
    padding: 11px 0;
    border-top: 1px solid var(--hairline);
  }
  .tlabel {
    font-size: var(--fs-btn-sm);
    font-weight: 600;
  }
  .tval {
    font-family: var(--font-mono);
    font-size: var(--fs-btn-sm);
    font-weight: 700;
  }

  .dactions {
    display: flex;
  }

</style>
