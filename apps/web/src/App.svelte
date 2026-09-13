<script lang="ts">
  import { device } from "./lib/device.svelte.js";
  import { sources } from "./lib/sources/store.svelte.js";
  import { library } from "./lib/library.svelte.js";
  import { deviceSafety } from "./lib/installProgress.svelte.js";
  import { lipProgress } from "./lib/lipProgress.svelte.js";
  import { runCacheMigrations } from "./lib/sources/cacheMigrations.js";
  import { locale } from "./lib/i18n/locale.svelte.js";
  import { applyDirection } from "./lib/direction.svelte.js";
  import { navigate } from "./lib/nav.js";
  import "./lib/i18n/registerLocales.js";
  import DeviceHeader from "./lib/ui/DeviceHeader.svelte";
  import Landing from "./lib/views/Landing.svelte";
  import Advanced from "./lib/views/Advanced.svelte";
  import StubLoadModal from "./lib/ui/StubLoadModal.svelte";
  import UnlockConfirmModal from "./lib/ui/UnlockConfirmModal.svelte";
  import FolderGateModal from "./lib/ui/FolderGateModal.svelte";
  import ConnectGateModal from "./lib/ui/ConnectGateModal.svelte";
  import InstallProgressModal from "./lib/ui/InstallProgressModal.svelte";

  // Sources must load at app start, not when the Sources tab is first opened.
  // Homebrew titles are derived from the ACTIVE sources (sources/homebrewTitles.svelte.ts), so
  // the Library tab lists nothing from a source until `rows` is populated — and this used to
  // be called ONLY from Sources.svelte and AddSourcesModal.svelte, i.e. a user who went
  // straight to the Library saw no homebrew at all until they happened to visit Sources, even
  // with nothing to add. Idempotent behind the store's own `loaded` guard, so the two existing
  // calls stay harmless.
  // The document's writing direction follows the locale, with no reload. An effect rather
  // than a call inside `locale.set()`: this tracks the VALUE, so any writer to
  // `locale.current` is covered, not just the one method that assigns it today.
  $effect(() => {
    applyDirection(locale.current);
  });

  sources.load();

  // Restore the user's registered ROM folders as soon as the source registry is ready, regardless
  // of which tab opens first. The Library used to own this effect, so starting on Overview or
  // Sources left every core at zero until the Library was visited. One registry signature covers
  // all active cores/homebrew; a source change schedules one merged scan after manifests settle.
  $effect(() => {
    library.romFolderSignature;
    // The landing chooser is the first-run wizard (Flash vs SD, Firmware vs Library). It must
    // not trigger a library walk before the user has chosen a destination.
    if (showLanding) return;
    // Guided Setup owns the device while it is open; defer the library walk until the wizard
    // switches back to the normal device/library UI. Reading firmwareMode keeps this effect
    // subscribed so closing the wizard starts the deferred scan automatically.
    if (device.firmwareMode === "wizard") return;
    // On a hard refresh Advanced has not applied the route to firmwareMode yet; the hash is
    // already authoritative, so use it to close that startup race.
    if (typeof window !== "undefined" && window.location.hash.startsWith("#guided")) return;
    if (library.sourcesResolving && !library.loaded) return;
    void library.sync();
  });

  // Point cover art at the OPFS blob cache and drain the two legacy IndexedDB byte stores onto
  // it. Returns immediately — the drain itself runs on an idle callback, in budgeted passes.
  // See `sources/cacheMigrations.ts`, including what deliberately does NOT move.
  runCacheMigrations();

  // Whether to show the initial Landing screen
  let showLanding = $state(true);
  // Set when the user connects FROM the landing homepage
  let entryTab = $state<"info" | "device" | "roms" | undefined>(undefined);

  // true only for "Manage Device" navigations (not "Advanced") — enables firmware-based auto-route.
  let autoRouteEnabled = $state(false);
  // True if the device was already connected when the user clicked "Manage Device".
  // In that case skip auto-route: Overview tab shows current state and no redirect is needed.
  // Only route when a *fresh* connection + scan happens during this session.
  let deviceAlreadyConnected = $state(false);
  // Cleared on disconnect so each new connection re-evaluates.
  let autoRouted = $state(false);

  // Watches firmware after the scan completes — NOT at connection time.
  // `device.firmware` is now a pure derived getter off `deviceClass`, which is only ever
  // populated by _doScan()'s bank scan — so there's no more "premature stock-ofw" race to
  // guard against from a connect-time info read. Still guard on banks.length > 0 (banks are
  // only populated by _doScan()) so we route on real scan data, not the pre-scan default.
  $effect(() => {
    if (!device.isConnected) {
      autoRouted = false;
      return;
    }
    if (showLanding || autoRouted || !autoRouteEnabled || deviceAlreadyConnected) return;
    const fw = device.firmware;
    if (fw === "unknown" || device.scanning || device.banks.length === 0) return;
    autoRouted = true;
    if (fw !== "retro-go") {
      // The store field is the request; the hash segment just mirrors it (Advanced.svelte
      // owns the mapping). Setting only the hash was the old bug: "#firmware" alone lands on
      // whichever sub-mode happened to be selected, so Guided Setup was never guaranteed.
      device.firmwareMode = "wizard";
      // Derived from the scan, not from anything the user pressed — REPLACE, so the
      // auto-route does not plant a history entry the user has to press Back through.
      navigate("#guided", false);
    }
    // retro-go fully installed → stay on Overview tab
  });

  function handleNavigate(target: 'device' | 'device-advanced' | 'games', media: 'flash' | 'sd') {
    // Landing is a deliberate top-level re-entry point — re-arm auto-reconnect even if the
    // device was explicitly disconnected earlier this session (see allowAutoReconnect's doc
    // comment). Applies to both targets: 'device' connectSilent()s directly below, 'games'
    // (Flash mode) does it via RomManagementTab's own autoProbeRoms() on mount.
    device.allowAutoReconnect();
    device.targetMedia = media;
    device.firmwareMode = 'advanced';
    autoRouted = false;
    if (target === 'games') {
      entryTab = 'roms';
      autoRouteEnabled = false;
    } else {
      // 'device' → Overview tab; auto-route to Guided Setup after scan if firmware needs setup.
      // 'device-advanced' → Firmware Setup tab directly; no auto-route (user asked explicitly).
      entryTab = target === 'device-advanced' ? 'device' : 'info';
      autoRouteEnabled = target === 'device';
      // Snapshot connection state NOW: if already connected, the firmware value is stale/known
      // and we should not auto-route on this navigation.
      deviceAlreadyConnected = device.isConnected;
      void device.connectSilent();
    }
    showLanding = false;
  }
</script>

<div class="app" data-model={device.accent ?? undefined}>
  <StubLoadModal />
  <UnlockConfirmModal />
  <FolderGateModal />
  <ConnectGateModal />
  <InstallProgressModal />
  <header class="app-header">
    <DeviceHeader showConnectButton={!showLanding} onNavigateHome={() => showLanding = true} />

    <!-- The face-plate lip: ONE 3px strip as the LAST child of the header band, never a gold
         background. See docs/design/mockups/README.md ("Gold is a 3px face-plate lip, not a
         band") and every artboard's header.

         The busy state SWAPS this row's fill rather than adding a second strip (the Main and
         HeaderBusy artboards put the lip in the same 3px row in both states). The row lives
         here, in the sticky header that owns it, because a lip split across two components
         coordinates by luck; DeviceHeader is a pure consumer of deviceSafety and renders no
         lip of its own. This element is a pure presentation mirror of deviceSafety
         (installProgress.svelte.ts) — it decides nothing about when a write is in flight. -->
    <div
      class="lip"
      role={deviceSafety.unsafe ? "alert" : undefined}
      aria-label={deviceSafety.unsafe ? locale.t.deviceHeader.unsafeAria : undefined}
      aria-hidden={deviceSafety.unsafe ? undefined : "true"}
    >
      <!-- The FILL, not a second strip: the row stays 3px and only the fill's extent and
           paint change, which is what GF3 records ("3px constant height, fill-swap only").
           At rest the fill is the full width, so the lip is byte-for-byte the gold band the
           boards draw; during a bulk SWD transfer it is that transfer's own proportion, over
           the --surface-sunk track this project already uses behind a fill (--seg-free). -->
      <div
        class="lip-fill"
        class:hazard={deviceSafety.unsafe}
        style={lipProgress.active ? `width: ${lipProgress.percent}%` : undefined}
      ></div>
    </div>
  </header>
  <main class="page">
    {#if showLanding}
      <!-- Landing1/Landing2 are the `padding: 0 40px; align-content: center` family, so the
           landing screen still gets the capped `.body` container. Advanced does NOT: it owns
           two full-bleed regions (the nav band, the Firmware rail) and applies `.body` to the
           panes that are gridded, one at a time. -->
      <div class="page-body landing">
        <Landing onNavigate={handleNavigate} />
      </div>
    {:else}
      <Advanced initialTab={entryTab} onInitialApplied={() => (entryTab = undefined)} />
    {/if}
  </main>
</div>

<style>
  /* The re-synced Library artboards (Roms.dc.html:17 / RomsOptions.dc.html:17) make the page
     frame FIXED to the viewport — `height: 100vh; min-height: 0; overflow: hidden` — with the
     content region, not the document, doing the scrolling
     (`flex: 1 1 auto; min-height: 0; overflow-y: auto`, Roms.dc.html:89). That is what lets a
     tab pin a footer bar (the Library dock, the Sources bar) instead of letting it drift down
     the page. OverviewTab / RomManagementTab / Sources already claim their half of that chain;
     this is its root. Every `.tabpane` variant below carries `overflow-y: auto`, so nothing
     can be silently clipped by this `overflow: hidden`. */
  .app {
    height: 100vh;
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }
  .app-header {
    position: sticky;
    top: 0;
    z-index: var(--z-sticky);
    display: flex;
    flex-direction: column;
    background: var(--surface);
    /* NO bottom border. No board draws one here: on a tabbed screen the only hairline in this
       region is the tab band's own `border-bottom` (Main.dc.html:65), which sits BELOW the tab
       labels — a border here put a second line directly above them. On Landing (Landing1/2)
       there is no line under the header at all. Artboard wins on pure paint. */
  }
  /* Exactly one lip, always 3px: only the fill changes between states, so there is no layout
     shift when a write starts or ends. */
  .lip {
    height: 3px;
    /* The track behind the fill. Only visible while a transfer is short of 100%. */
    background: var(--surface-sunk);
    flex-shrink: 0;
  }
  .lip-fill {
    height: 100%;
    width: 100%;
    background: var(--grad-gold);
    /* The transport reports a chunk at a time; without this the fill steps visibly. Kept
       short so the bar is never meaningfully behind the device. */
    transition: width 120ms linear;
  }
  .lip-fill.hazard {
    background: var(--grad-hazard);
    background-size: 62px 100%;
    animation: lip-crawl 1.1s linear infinite;
  }
  @keyframes lip-crawl {
    from { background-position: 0 0; }
    to { background-position: 62px 0; }
  }
  /* Reduced motion keeps the hazard stripe (it is the state signal) but stops the crawl. */
  @media (prefers-reduced-motion: reduce) {
    .lip-fill.hazard {
      animation: none;
    }
    /* The width still tells the truth; only the movement to it is dropped. */
    .lip-fill {
      transition: none;
    }
  }
  /* The page column is now full width and UNPADDED: the artboards' 40px sides and
     the --maxw cap belong to `.page-body` (global.css), which is applied per screen —
     Main.dc.html's nav band and Firmware.dc.html's 244px rail are both full-bleed
     and must reach the page edge, which they cannot do from inside a padded,
     capped wrapper. VERTICAL padding stays per-screen too (four families across
     the artboards); Advanced.svelte's `.tabpane` applies it per tab. */
  .page {
    flex: 1;
    /* Without this the flex item refuses to shrink below its content, the column grows past
       100vh and `.app`'s `overflow: hidden` clips it with no scrollbar anywhere. */
    min-height: 0;
    display: flex;
    flex-direction: column;
  }
  /* Landing1/Landing2: `padding: 0 40px` with the content vertically centred. */
  .landing {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    /* `safe` so a short viewport scrolls from the TOP instead of centring the content and
       putting its head above the scroll origin, where it cannot be reached. */
    justify-content: safe center;
    overflow-y: auto;
    gap: 1.25rem;
  }
</style>
