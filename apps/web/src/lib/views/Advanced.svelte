<script lang="ts">
  import { untrack } from "svelte";
  import { device } from "../device.svelte.js";
  import DeviceInfoTab from "../advanced/DeviceInfoTab.svelte";
  import RetroGoTab from "../advanced/RetroGoTab.svelte";
  import RomManagementTab from "../advanced/RomManagementTab.svelte";
  import ExpertCorner from "../advanced/ExpertCorner.svelte";
  import Wizard from "./Wizard.svelte";

  // The Advanced shell (§2): tab strip + multi-open accordion. Persistent
  // DeviceHeader + DeviceOverview stay mounted in App.svelte above this.

  type Tab = "info" | "device" | "roms";

  // `initialTab` is set ONLY when the user just connected from the Connect homepage — we land on
  // Device Information then (so a stale persisted hash doesn't reopen Device Management mid-scan).
  // It's a one-shot: applied on mount, then cleared via onInitialApplied so later remounts (mode
  // toggles, reconnects) fall back to the hash/default. No forward on any other entry.
  let {
    initialTab,
    onInitialApplied,
    mode = $bindable("advanced"),
  }: { initialTab?: Tab; onInitialApplied?: () => void; mode?: "wizard" | "advanced" } = $props();

  // Which device-tab accordion (if any) to pre-open, from the scanned install state:
  //   • Retro-Go + LittleFS present  → fully installed → open NOTHING (they can still open
  //     "Backup & Patch" themselves to patch a different OFW over the current one).
  //   • Retro-Go intflash but NO LittleFS → broken install → pre-open "install" (repair).
  //   • Patched OFW (dual-boot) but no Retro-Go → pre-open "install".
  //   • Stock OFW (unpatched) → pre-open "ofw" (Backup & Patch — patch it first).
  //   • Unknown / pre-scan → "install" (the usual next action).
  function deviceDefaultId(): string | null {
    const banks = device.banks;
    const parts = device.partitions;
    const retroGo = banks.some((b) => !!b.retroGoVersion || /retro-go/i.test(b.type));
    const littlefs = parts.some((p) => p.fs === "littlefs");
    const patchedOfw = banks.some((b) => b.ofw?.patched);
    const stockOfw = banks.some((b) => b.ofw && !b.ofw.patched);
    if (retroGo) return littlefs ? null : "install";
    if (patchedOfw) return "install";
    if (stockOfw) return "ofw";
    return "install";
  }
  function deviceDefaultSet(): Set<string> {
    const id = deviceDefaultId();
    return new Set(id ? [id] : []);
  }

  let tab = $state<Tab>(untrack(() => initialTab) ?? "device"); // one-shot: see the mount effect
  // Open sections per tab (multi-open). Default-open one per tab (§2.2).
  let openByTab = $state<Record<Tab, Set<string>>>({
    info: new Set(),
    device: untrack(() => deviceDefaultSet()),
    roms: new Set(),
  });
  // While true, the device tab auto-tracks the firmware-appropriate default-open section. The
  // user's first manual toggle on the device tab (or a hash deep-link) flips it false so we stop.
  let deviceAutoDefault = $state(true);
  // Sections whose op is running — these cannot be collapsed (§2.4).
  let runningSections = $state(new Set<string>());

  // Reactively keep the device tab's default-open synced to the scanned install state (banks +
  // partitions are empty at mount → "install", then resolve once the scan lands — possibly to
  // "nothing open" for a fully-installed device). deviceDefaultSet() is read in the TRACKED scope
  // so this effect depends on device.banks/partitions + deviceAutoDefault; the openByTab write is
  // untracked so it never depends on its own output — no reactive loop.
  $effect(() => {
    if (!deviceAutoDefault) return;
    const next = deviceDefaultSet();
    untrack(() => {
      openByTab = { ...openByTab, device: next };
    });
  });

  // Expert corner: reached only via the #expert hash (§2.1.1).
  let expert = $state(false);

  // ---- hash deep-link: #advanced/<tab>/<sec,sec> | #expert (§2.3) ----
  function readHash() {
    const h = location.hash.replace(/^#/, "");
    if (h === "expert") {
      expert = true;
      return;
    }
    expert = false;
    const m = h.match(/^advanced\/(info|device|roms)(?:\/(.*))?$/);
    if (!m) return;
    tab = m[1] as Tab;
    if (m[2]) {
      const ids = m[2].split(",").filter(Boolean);
      const next = { ...openByTab };
      next[tab] = new Set(ids);
      openByTab = next;
      if (tab === "device") deviceAutoDefault = false; // a hash deep-link wins over the auto-default
    }
  }

  $effect(() => {
    // Initial read must NOT be tracked: readHash() writes tab/openByTab, and a
    // hash with open sections also reads them — tracking that here would make the
    // write retrigger this effect forever (page freeze). The hashchange listener
    // runs in an event callback, which is already outside reactive tracking.
    untrack(() => {
      if (initialTab) {
        // Connected from the homepage: land on the requested tab, ignore any stale hash, and
        // write the clean hash. The device tab's auto-default resolves later if they go there.
        tab = initialTab;
        syncHash();
        onInitialApplied?.();
      } else {
        readHash();
      }
    });
    const on = () => readHash();
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  });

  function syncHash() {
    const open = [...openByTab[tab]].join(",");
    const next = `#advanced/${tab}${open ? "/" + open : ""}`;
    if (location.hash !== next) history.replaceState(null, "", next);
  }

  function toggle(id: string) {
    if (runningSections.has(id)) return; // running can't collapse (§2.4)
    if (tab === "device") deviceAutoDefault = false; // user took control of the device tab
    const cur = openByTab[tab];
    const next = new Set(cur);
    next.has(id) ? next.delete(id) : next.add(id);
    openByTab = { ...openByTab, [tab]: next };
    syncHash();
  }


  function onRunning(id: string, running: boolean) {
    const next = new Set(runningSections);
    running ? next.add(id) : next.delete(id);
    runningSections = next;
  }

  function selectTab(t: Tab) {
    tab = t;
    syncHash();
  }

  // Tab strip keyboard: Left/Right moves between tabs (§2.4).
  const TABS: Tab[] = ["info", "device", "roms"];
  function onTabKey(e: KeyboardEvent) {
    const i = TABS.indexOf(tab);
    if (e.key === "ArrowRight") selectTab(TABS[(i + 1) % TABS.length]);
    else if (e.key === "ArrowLeft") selectTab(TABS[(i - 1 + TABS.length) % TABS.length]);
  }
</script>

{#if expert}
  <div class="shell">
    <div class="exphead">
      <h2>Expert</h2>
      <button class="quiet" onclick={() => { location.hash = "#advanced/device"; }}>← Back to Advanced</button>
    </div>
    <ExpertCorner />
  </div>
{:else}
  <div class="shell" class:wide={tab === "roms"}>
    <div class="tabbar" role="tablist" aria-label="Advanced tools" tabindex={-1} onkeydown={onTabKey}>
      <button
        role="tab"
        class="tab"
        class:active={tab === "info"}
        aria-selected={tab === "info"}
        tabindex={tab === "info" ? 0 : -1}
        onclick={() => selectTab("info")}
      >Information</button>
      <button
        role="tab"
        class="tab"
        class:active={tab === "device"}
        aria-selected={tab === "device"}
        tabindex={tab === "device" ? 0 : -1}
        onclick={() => selectTab("device")}
      >Device/Retro-Go Setup</button>
      <button
        role="tab"
        class="tab"
        class:active={tab === "roms"}
        aria-selected={tab === "roms"}
        tabindex={tab === "roms" ? 0 : -1}
        onclick={() => selectTab("roms")}
      >ROMs</button>

    </div>

    {#if tab === "info"}
      <DeviceInfoTab />
    {:else if tab === "device"}
      <nav class="modeswitch-inline">
        <button class:active={mode === "wizard"} onclick={() => (mode = "wizard")}>Guided Setup</button>
        <button class:active={mode === "advanced"} onclick={() => (mode = "advanced")}>Advanced</button>
      </nav>
      {#if mode === "wizard"}
        <Wizard onComplete={() => selectTab("roms")} />
      {:else}
        <RetroGoTab openSet={openByTab.device} onToggle={toggle} {onRunning} />
      {/if}
    {:else}
      <RomManagementTab openSet={openByTab.roms} onToggle={toggle} {onRunning} />
    {/if}
  </div>
{/if}

<style>
  .shell {
    /* Centered content column within the wide frame — the block is centered, data inside
       stays left-aligned. (The future Games tab can break out to the full width.) */
    align-self: center;
    width: 100%;
    max-width: 900px;
    margin: 0 auto;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }
  .shell.wide {
    max-width: none;
    padding: 0 1rem;
  }
  /* Tab strip is square-cornered (data surface), distinct from the mode pill. */
  .tabbar {
    width: fit-content;
    margin: 0 auto;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.15rem;
    background: var(--surface-sunk);
    border-radius: var(--r-control);
    padding: 0.2rem;
  }
  .tab {
    font: inherit;
    font-size: var(--fs-caption);
    color: var(--ink-soft);
    background: transparent;
    border: none;
    border-bottom: 2px solid transparent;
    padding: 0.4rem 0.85rem;
    cursor: pointer;
  }
  .tab.active {
    background: var(--surface);
    color: var(--ink);
    font-weight: 600;
    border-bottom-color: var(--model-accent);
  }
  .tab:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  
  .modeswitch-inline {
    display: flex;
    gap: 0.2rem;
    align-self: center;
    background: var(--surface-sunk);
    border-radius: 999px;
    padding: 0.15rem;
    margin-bottom: 0.5rem;
  }
  .modeswitch-inline button {
    font: inherit;
    font-size: 0.8rem;
    border: none;
    background: transparent;
    color: var(--ink-soft);
    padding: 0.25rem 0.75rem;
    border-radius: 999px;
    cursor: pointer;
  }
  .modeswitch-inline button.active {
    background: var(--surface);
    color: var(--ink);
    font-weight: 600;
    box-shadow: var(--shadow-card);
  }

  .exphead {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .exphead h2 {
    font-size: var(--fs-lg);
    margin: 0;
  }
  .quiet {
    font: inherit;
    font-size: var(--fs-caption);
    color: var(--ink-soft);
    background: transparent;
    border: none;
    cursor: pointer;
    text-decoration: underline;
    text-underline-offset: 2px;
  }
</style>
