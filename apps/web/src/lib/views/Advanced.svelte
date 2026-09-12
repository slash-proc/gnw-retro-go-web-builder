<script lang="ts">
  import { untrack } from "svelte";
  import { device } from "../device.svelte.js";
  import { navigate, onRoute } from "../nav.js";
  import { locale } from "../i18n/locale.svelte.js";
  import OverviewTab from "./OverviewTab.svelte";
  import FirmwareRail, { RAIL_IDS, type RailId } from "../advanced/FirmwareRail.svelte";
import { OVERVIEW_RAIL_IDS, type OverviewRailId } from "./OverviewRail.svelte";
  import RomManagementTab from "./RomManagementTab.svelte";
  import Sources from "./Sources.svelte";
  import Wizard from "./Wizard.svelte";

  // The Advanced shell (§2): tab strip + multi-open accordion. Persistent
  // DeviceHeader + DeviceOverview stay mounted in App.svelte above this.

  type Tab = "info" | "device" | "sources" | "roms";

  // `initialTab` is set ONLY when the user just connected from the Connect homepage — we land on
  // Overview then (so a stale persisted hash doesn't reopen Device Management mid-scan).
  // It's a one-shot: applied on mount, then cleared via onInitialApplied so later remounts (mode
  // toggles, reconnects) fall back to the hash/default. No forward on any other entry.
  let {
    initialTab,
    onInitialApplied,
  }: { initialTab?: Tab; onInitialApplied?: () => void } = $props();

  // The Firmware Setup sub-mode lives on the device store, not here: callers outside this
  // subtree (OverviewTab's setup prompt, App.svelte's post-scan auto-route) need to REQUEST
  // Guided Setup, and a component-local `$state` bound up through App gave them no handle on
  // it. `mode` is just a local alias for readability.
  const mode = $derived(device.firmwareMode);

  let tab = $state<Tab>(untrack(() => initialTab) ?? "device"); // one-shot: see the mount effect
  // Open sections per tab (multi-open). All tabs start fully closed — the device tab used to
  // auto-open a "next action" section from the scanned install state, but that state resolves
  // asynchronously (banks/partitions are empty at mount, then settle after the scan), so the
  // section would pop open pre-scan, re-target itself (bank1 → bank2) as the scan progressed,
  // then sometimes auto-close once "fully installed" resolved — all out from under the user.
  // Every section now opens only on an explicit click (or a hash deep-link).
  let openByTab = $state<Record<Tab, Set<string>>>({
    info: new Set(),
    device: new Set(),
    sources: new Set(),
    roms: new Set(),
  });
  // Sections whose op is running — these cannot be collapsed (§2.4).
  let runningSections = $state(new Set<string>());

  // Firmware tab left rail (Phase 4): exactly one section is mounted at a time. The id doubles
  // as the hash sub-segment, so the old `#firmware/<id>` deep links keep working.
  let railSelected = $state<RailId>("ofw");
  // Overview is a rail now too (docs/design/proposals/overview-v2). Its own selection, kept
  // separate from the Firmware rail's: the two tabs have different item sets and a shared
  // variable would make switching tabs land on an id the other rail has never heard of.
  let overviewRail = $state<OverviewRailId>("status");
  // The Sources tab's sub-route (everything after "#sources/") — owned by Sources.svelte,
  // carried here because this component owns the hash. See lib/sourcesRoute.ts for why the
  // Sources tab needed a route of its own at all.
  let sourcesRoute = $state("");

  // Firmware.dc.html:76 is a full-bleed `244px minmax(0, 1fr)` grid, NOT a 12-column body:
  // the rail's border-right is the region edge and has to reach the page edge (audit 5.12).
  // So this one pane opts out of `.page-body`'s cap and side padding; other panes keep them.
  // Overview is a rail unconditionally: its rail is drawn with no device too, because Activity
  // has to stay reachable when the audit log is filling up from Sources and the Library.
  const railBleed = $derived(
    tab === "sources" ||
      tab === "info" ||
      (tab === "device" && device.isConnected && mode === "advanced"),
  );
  // The two screens whose artboards draw a FULL-BLEED footer as a SIBLING of the padded body:
  // Roms.dc.html:89 (the Library dock) and Repos.dc.html:76 (the Sources bar). `.page-body`'s
  // --maxw cap lives on `.tabpane` for every other tab, and a descendant cannot cancel a cap it
  // is nested inside — only its padding — so above a 1440px viewport (1360 + 2x40) those two
  // bars stopped at the capped column while the artboards run them to the page edge. These
  // panes therefore drop `.page-body`; the components below re-apply the cap to their own body
  // region, leaving the bar full-bleed. See `.tabpane.docked`.
  // Sources moved to the Firmware tab's rail shape (SourcesRail.dc.html), so it is `.bleed`
  // now, not `.docked`: its rail owns all four sides of both columns.
  const docked = $derived(tab === "roms");

  // Firmware Setup requires a basic connection for ANYTHING on it — both Guided and Advanced
  // sub-modes. Surface the shared connect gate the instant the tab is viewed while disconnected
  // (mirrors OverviewTab's gate; single check at the tab level, not per-section/per-mode).
  // Cancelling sends the user back to the Overview tab, matching the old modal's "Back" behavior.
  let connectGateActive = false;
  $effect(() => {
    if (tab !== "device" || device.isConnected) return;
    if (connectGateActive) return;
    connectGateActive = true;
    device.ensureConnectGate()
      .catch(() => untrack(() => selectTab("info", false))) // gate cancelled: derived, replace
      .finally(() => (connectGateActive = false));
  });

  // Guided Setup (the Wizard) additionally requires Recovery Mode (the stub) — a layer below the
  // basic connection gate above. Fires once per entry into wizard mode while connected+not booted;
  // if the user cancels the confirm, route them to the Advanced sub-view instead of leaving them stuck.
  let stubGateActive = false;
  $effect(() => {
    if (tab !== "device" || mode !== "wizard" || !device.isConnected || device.utilLoaded) return;
    if (stubGateActive) return;
    stubGateActive = true;
    device.ensureStub()
      .catch(() => untrack(() => selectMode("advanced", false))) // gate cancelled: derived, replace
      .finally(() => (stubGateActive = false));
  });

  // ---- hash deep-link: #<tab>/<sec,sec> (§2.3) ----
  // URL segment names reflect the actual (flat, non-"advanced") tab structure: "info" and
  // "roms" match their Tab value directly; the "device" Tab value (internal name, unchanged
  // per the file-structure flattening) surfaces in the URL as "firmware" (the tab is labeled
  // "Firmware" in the UI) since "device" alone reads as unrelated to "advanced/device".
  // The Firmware tab has TWO segments, one per sub-mode: "#guided" is Guided Setup, and
  // "#firmware" is the Advanced rail. The rail keeps the existing segment because it is the
  // one that takes "/section" deep-links (e.g. "#firmware/ofw"); Guided Setup has no sections.
  const HASH_SEGMENT: Record<Tab, string> = { info: "info", device: "firmware", sources: "sources", roms: "roms" };
  const GUIDED_SEGMENT = "guided";
  function readHash() {
    const h = location.hash.replace(/^#/, "");
    if (h === GUIDED_SEGMENT) {
      tab = "device";
      device.firmwareMode = "wizard";
      return;
    }
    const m = h.match(/^(info|firmware|sources|roms)(?:\/(.*))?$/);
    if (!m) return;
    tab = (m[1] === "firmware" ? "device" : m[1]) as Tab;
    // Arriving by the rail segment selects the rail — "#firmware/ofw" means a specific
    // Advanced section, never the wizard.
    if (tab === "device") device.firmwareMode = "advanced";
    if (tab === "sources") {
      // The Sources sub-route is a PATH, not the comma-set the accordion tabs use, and its
      // ids contain slashes ("owner/name"). Hand it over verbatim; Sources.svelte parses it.
      sourcesRoute = m[2] ?? "";
      return;
    }
    if (m[2]) {
      const ids = m[2].split(",").filter(Boolean);
      const next = { ...openByTab };
      next[tab] = new Set(ids);
      openByTab = next;
      // The Firmware tab is a single-select rail, not a multi-open accordion: take the first
      // recognised id as the selection. `#firmware` with no sub-segment lands on the first item.
      if (tab === "device") {
        const hit = ids.find((id): id is RailId => (RAIL_IDS as string[]).includes(id));
        railSelected = hit ?? "ofw";
      }
      // Overview's rail takes the same single-select deep link ("#info/details"). The old
      // accordion ids are gone, so an unrecognised segment falls back to Status rather than
      // leaving the pane on whatever was last shown.
      if (tab === "info") {
        const hit = ids.find((id): id is OverviewRailId => (OVERVIEW_RAIL_IDS as string[]).includes(id));
        overviewRail = hit ?? "status";
      }
    } else if (tab === "device") {
      railSelected = "ofw";
    } else if (tab === "info") {
      overviewRail = "status";
    }
  }

  $effect(() => {
    // Initial read must NOT be tracked: readHash() writes tab/openByTab, and a
    // hash with open sections also reads them — tracking that here would make the
    // write retrigger this effect forever (page freeze). nav.ts's subscriber runs in an
    // event callback, which is already outside reactive tracking.
    untrack(() => {
      if (initialTab) {
        // Connected from the homepage: land on the requested tab, ignore any stale hash, and
        // write the clean hash. DERIVED, not user-initiated — replace, so the landing page's
        // own entry stays the one Back returns to.
        tab = initialTab;
        syncHash(false);
        onInitialApplied?.();
      } else {
        readHash();
      }
    });
    // nav.ts owns the listeners. The subscriber READS the URL and never writes it back — that
    // one-directionality is what keeps the loop the comment above describes broken.
    return onRoute(readHash);
  });

  /**
   * Write the hash for the current state.
   *
   * `push` is the whole back-button contract: true when the USER navigated (tab strip, rail,
   * accordion, sub-mode), false when the app derived the position (mount, a gate cancel
   * routing out of a tab the user cannot use). Every call site below states which it is.
   */
  function syncHash(push: boolean) {
    if (tab === "device" && mode === "wizard") {
      navigate(`#${GUIDED_SEGMENT}`, push);
      return;
    }
    const open =
      tab === "device"
        ? railSelected
        : tab === "info"
          ? overviewRail
          : tab === "sources"
            ? sourcesRoute
            : [...openByTab[tab]].join(",");
    navigate(`#${HASH_SEGMENT[tab]}${open ? "/" + open : ""}`, push);
  }

  /**
   * The Sources tab reporting its own sub-route. `push` comes from the child: its first
   * report after mounting is the pane it happens to be showing (derived — replace), every
   * later one is a click (push).
   */
  function onSourcesRoute(next: string, push: boolean) {
    sourcesRoute = next;
    if (tab === "sources") syncHash(push);
  }

  function toggle(id: string) {
    if (runningSections.has(id)) return; // running can't collapse (§2.4)
    const cur = openByTab[tab];
    const next = new Set(cur);
    next.has(id) ? next.delete(id) : next.add(id);
    openByTab = { ...openByTab, [tab]: next };
    syncHash(true); // user opened/closed a section
  }


  function onRunning(id: string, running: boolean) {
    const next = new Set(runningSections);
    running ? next.add(id) : next.delete(id);
    runningSections = next;
  }

  function selectRail(id: RailId) {
    railSelected = id;
    syncHash(true); // user picked a rail section
  }

  function selectOverviewRail(id: OverviewRailId) {
    overviewRail = id;
    syncHash(true); // user picked an Overview pane
  }

  function selectMode(m: "wizard" | "advanced", push = true) {
    device.firmwareMode = m;
    syncHash(push);
  }

  function selectTab(t: Tab, push = true) {
    tab = t;
    syncHash(push);
  }

  // Tab strip keyboard: Left/Right moves between tabs (§2.4).
  const TABS: Tab[] = ["info", "device", "sources", "roms"];
  function onTabKey(e: KeyboardEvent) {
    const i = TABS.indexOf(tab);
    if (e.key === "ArrowRight") selectTab(TABS[(i + 1) % TABS.length]);
    else if (e.key === "ArrowLeft") selectTab(TABS[(i - 1 + TABS.length) % TABS.length]);
  }
</script>

<div class="shell">
  <!-- The nav band (audit 5.11). Main.dc.html:65 / Guided.dc.html:65: a FULL-BLEED white
       strip with `padding: 0 40px` and a `border-bottom: 1px solid #d8d8d8` that runs the
       whole page width — so it sits outside `.page-body` (which the panes below apply
       individually), not inside it. The Guided/Advanced switch rides the SAME line,
       right-aligned; it is plain text with an underline on the active word, not a pill. -->
  <div class="navband">
    <div class="tabbar" role="tablist" aria-label={locale.t.advanced.tabbarLabel} tabindex={-1} onkeydown={onTabKey}>
      <button
        role="tab"
        class="tab"
        class:active={tab === "info"}
        aria-selected={tab === "info"}
        tabindex={tab === "info" ? 0 : -1}
        onclick={() => selectTab("info")}
      >{locale.t.advanced.tabOverview}</button>
      <button
        role="tab"
        class="tab"
        class:active={tab === "device"}
        aria-selected={tab === "device"}
        tabindex={tab === "device" ? 0 : -1}
        onclick={() => selectTab("device")}
      >{locale.t.advanced.tabFirmwareSetup}</button>
      <button
        role="tab"
        class="tab"
        class:active={tab === "sources"}
        aria-selected={tab === "sources"}
        tabindex={tab === "sources" ? 0 : -1}
        onclick={() => selectTab("sources")}
      >{locale.t.sources.tab}</button>
      <button
        role="tab"
        class="tab"
        class:active={tab === "roms"}
        aria-selected={tab === "roms"}
        tabindex={tab === "roms" ? 0 : -1}
        onclick={() => selectTab("roms")}
      >{locale.t.advanced.tabRoms}</button>

    </div>
    {#if tab === "device" && device.isConnected}
      <nav class="modeswitch" aria-label={locale.t.advanced.tabFirmwareSetup}>
        <button class:active={mode === "wizard"} onclick={() => selectMode("wizard")}
          >{locale.t.advanced.modeGuidedSetup}</button
        >
        <button class:active={mode === "advanced"} onclick={() => selectMode("advanced")}
          >{locale.t.advanced.modeAdvanced}</button
        >
      </nav>
    {/if}
  </div>

    <!-- Per-screen VERTICAL page padding (audit S0.2). The artboards have four
         families and one `.body` cannot carry all four, so the family is chosen
         here, per tab. This is the `.shell.wide`/`.narrow` mechanism reinstated
         for padding ONLY — the per-tab width caps it also used to carry are gone
         for good (Main/Roms/Repos all share one body width). -->
    <div
      class="tabpane"
      class:page-body={!railBleed && !docked}
      class:bleed={railBleed}
      class:docked
      class:library={tab === "roms"}
      class:guided={tab === "device" && device.isConnected && mode === "wizard"}
    >
    {#if tab === "info"}
      <OverviewTab selected={overviewRail} onSelect={selectOverviewRail} />
    {:else if tab === "device"}
      {#if !device.isConnected}
        <p class="connecting-placeholder">{locale.t.advanced.waitingForDevice}</p>
      {:else}
        {#if mode === "wizard"}
          <Wizard
            onComplete={() => selectTab("roms")}
            onSources={() => selectTab("sources")}
          />
        {:else}
          <FirmwareRail selected={railSelected} onSelect={selectRail} {onRunning} />
        {/if}
      {/if}
    {:else if tab === "sources"}
      <Sources route={sourcesRoute} onRoute={onSourcesRoute} />
    {:else}
      <RomManagementTab openSet={openByTab.roms} onToggle={toggle} {onRunning} />
    {/if}
    </div>
</div>

<style>
  .connecting-placeholder {
    margin: 2rem auto;
    font-size: var(--fs-caption);
    color: var(--ink-soft);
    text-align: center;
  }
  /* Audit S0.2. The per-tab width modifiers (`.wide` 'none' / default 1000px /
     `.narrow` 900px) are gone: every 12-column artboard body — Main.dc.html
     (Overview), Roms.dc.html (Library), Repos.dc.html (Sources) — uses the SAME
     full body width with `padding: … 40px …`, so a per-tab cap is exactly the
     "each screen invents its own width" failure the grid rule exists to prevent.
     Width now comes from `.page-body` (global.css: --maxw + --page-pad-x), applied
     per pane below, and the column ratio from `.grid12`. */
  .shell {
    width: 100%;
    flex: 1;
    /* App.svelte's `.app` is now a fixed 100vh column with `overflow: hidden`; without this
       the shell refuses to shrink below its content and the panes below are clipped. */
    min-height: 0;
    max-width: none;
    margin: 0 auto;
    display: flex;
    flex-direction: column;
    /* No gap: the nav band sits directly on the body in every artboard, and
       `.tabpane` owns the space below it via the family's top padding. */
    gap: 0;
  }
  /* Main.dc.html:72 `padding: 36px 40px 40px`, Repos.dc.html:72 likewise — the
     default. Roms.dc.html:89 (and every other Library artboard) `22px 40px 32px`.
     Guided is NOT in this family any more — its boards centre the pane vertically and the
     old `64px 40px 40px` was retired with `--page-pad-top-guided`/`-bottom-guided`; see
     `.tabpane.guided` below. Sides come from `.page-body` (global.css), so only the vertical
     values live here. */
  /* THE app's only general scroll container, since `5567424` made `.app`
     `height: 100vh; overflow: hidden`. Every tab reaches its overflowing content through
     this one `overflow-y: auto` and nothing else: Overview's `.info` refuses to shrink and
     overflows into it, Library's `.two-pane` stops at its 500px floor and overflows into it,
     Sources' regions stop at their own floors and overflow into it. Adding `overflow: hidden`
     here — or to `.shell` or `App.svelte`'s `.page` — turns all three of those from
     "scrollable" into "clipped, with no way to reach the content", and NO gate in this repo
     can detect that: svelte-check, vite build and every suite pass on a clipped page. The
     Guided pane's `justify-content: safe center` depends on this too; plain `center` would put
     an overlong wizard's top above the scroll origin. */
  .tabpane {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-width: 0;
    /* Roms.dc.html:89 puts `flex: 1 1 auto; min-height: 0; overflow-y: auto` on exactly this
       element — the padded body region. It is the app's ONLY page-level scroller now, so it
       must stay on every modifier below (`.library`, `.guided`, `.bleed`), or that tab's
       overflow is eaten by `.app { overflow: hidden }` with no scrollbar to recover it. */
    min-height: 0;
    overflow-y: auto;
    padding-top: var(--page-pad-top);
    padding-bottom: var(--page-pad-bottom);
  }
  .tabpane.library {
    padding-top: var(--page-pad-top-library);
    padding-bottom: var(--page-pad-bottom-library);
  }
  /* Guided Setup is NOT a padded body: all six Guided artboards draw the pane as
     `flex: 1; display: flex; align-items: center; justify-content: center; padding: 0 40px`
     (Guided.dc.html:76 and GuidedLayout / GuidedLayoutStock / GuidedRetroGoOnly /
     GuidedStockOnly / GuidedSkipBackup, all identical) — the wizard column is CENTRED in the
     viewport, not pushed down by a top pad. The old `--page-pad-top-guided` (64px) /
     `--page-pad-bottom-guided` (40px) came from a superseded generation of Guided.dc.html and
     have been retired from tokens.css along with this rule; `.tabpane` was their only consumer.
     The sides still come from `.page-body` (`--page-pad-x` = the artboards' 40px).
     Direction differs from the artboard on purpose: `.tabpane` is a flex COLUMN, so vertical
     centring is `justify-content`; Wizard.svelte already centres itself horizontally with
     `margin: 0 auto` on its 470px column. `safe` keeps a tall wizard scrollable from the top. */
  .tabpane.guided {
    padding-top: 0;
    padding-bottom: 0;
    justify-content: safe center;
  }
  /* Audit 5.12. The Firmware rail pane is the one screen that is NOT a 12-column body:
     Firmware.dc.html:76 is a full-bleed `244px minmax(0, 1fr)` grid whose rail carries its
     own `padding: 32px 20px 40px 40px` and a full-height border-right. It therefore drops
     `.page-body` (no --maxw cap, no --page-pad-x) AND the vertical family — FirmwareRail.svelte
     owns all four sides on both columns. Structural, so --maxw is untouched. */
  .tabpane.bleed {
    padding: 0;
  }
  /* The docked screens (Library, Sources). They keep their vertical family's TOP padding and
     the `overflow-y: auto` from the base rule — only the sides and the bottom move: the sides
     go to the components' own capped body wrappers (`.pagecol` in RomManagementTab.svelte /
     Sources.svelte) so the dock can be a full-bleed sibling of the cap rather than a child of
     it, and the bottom goes to zero because the dock sits flush on the page's bottom edge
     (it used to cancel that pad with a negative margin). NOT `.bleed`: that one also zeroes
     the top pad, and the Firmware pane must stay pixel-identical. */
  .tabpane.docked {
    padding-bottom: 0;
  }
  /* The nav band (Main.dc.html:65 / Guided.dc.html:65). Full-bleed, so it carries the page
     side padding itself; the bottom rule is the region edge and runs edge to edge. */
  .navband {
    background: var(--surface);
    border-bottom: 1px solid var(--hairline);
    padding: 0 var(--page-pad-x);
    display: flex;
    align-items: stretch;
    justify-content: space-between;
  }
  /* Left-aligned words on the band, not a centred pill on --surface-sunk. */
  /* Tab type is unanimous across all 42 artboards that draw the band (verified 2026-09-08
     after the mockups were re-synced in 31cc2f7): four tabs, 46px, 14px/700 active on
     `inset 0 -3px 0 #3e9e4e` and 14px/600 `#6e6e6e` idle, `0.02em`, `gap: 34px`,
     `padding: 0 2px`. Any artboard is a valid reference now; the earlier
     "Main/Roms are an older three-tab generation" caveat described stale committed copies
     and no longer applies. */
  .tabbar {
    display: flex;
    align-items: stretch;
    gap: 34px;
  }
  .tab {
    font: inherit;
    height: 46px;
    padding: 0 2px;
    font-size: 14px;
    font-weight: 600;
    letter-spacing: 0.02em;
    color: var(--ink-mute);
    background: transparent;
    border: none;
    /* Transparent 3px rule on inactive tabs so activating one shifts nothing by a pixel. */
    box-shadow: inset 0 -3px 0 transparent;
    cursor: pointer;
  }
  .tab.active {
    font-weight: 700;
    color: var(--ink);
    box-shadow: inset 0 -3px 0 var(--zelda-green);
  }
  .tab:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  /* Guided / Advanced: same row, right-aligned, plain words with an underline on the
     active one — 13px, `padding: 4px 0`, `inset 0 -2px 0 #3e9e4e`. */
  .modeswitch {
    display: flex;
    align-items: center;
    gap: 18px;
  }
  .modeswitch button {
    font: inherit;
    font-size: var(--fs-btn-sm);
    font-weight: 500;
    /* `--ink-soft` #5c5c5c, not the tab bar's `--ink-mute` #6e6e6e. All 24 boards that draw
       this switch use #5c5c5c for the idle word, byte-identically; the tab strip above it is
       the one that uses #6e6e6e, and the token was reused one rule too far. */
    color: var(--ink-soft);
    background: transparent;
    border: none;
    border-radius: 0;
    padding: 4px 0;
    box-shadow: inset 0 -2px 0 transparent;
    cursor: pointer;
  }
  .modeswitch button.active {
    font-weight: 600;
    color: var(--ink);
    box-shadow: inset 0 -2px 0 var(--zelda-green);
  }

</style>
