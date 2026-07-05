<script lang="ts">
  import { untrack } from "svelte";
  import { device } from "../device.svelte.js";
  import { locale } from "../i18n/locale.svelte.js";
  import OverviewTab from "./OverviewTab.svelte";
  import RetroGoTab from "../advanced/RetroGoTab.svelte";
  import RomManagementTab from "./RomManagementTab.svelte";
  import ExpertCorner from "../advanced/ExpertCorner.svelte";
  import Wizard from "./Wizard.svelte";

  // The Advanced shell (§2): tab strip + multi-open accordion. Persistent
  // DeviceHeader + DeviceOverview stay mounted in App.svelte above this.

  type Tab = "info" | "device" | "roms";

  // `initialTab` is set ONLY when the user just connected from the Connect homepage — we land on
  // Overview then (so a stale persisted hash doesn't reopen Device Management mid-scan).
  // It's a one-shot: applied on mount, then cleared via onInitialApplied so later remounts (mode
  // toggles, reconnects) fall back to the hash/default. No forward on any other entry.
  let {
    initialTab,
    onInitialApplied,
    mode = $bindable("advanced"),
  }: { initialTab?: Tab; onInitialApplied?: () => void; mode?: "wizard" | "advanced" } = $props();

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
    roms: new Set(),
  });
  // Sections whose op is running — these cannot be collapsed (§2.4).
  let runningSections = $state(new Set<string>());

  // Expert corner: reached only via the #expert hash (§2.1.1).
  let expert = $state(false);

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
      .catch(() => untrack(() => selectTab("info")))
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
      .catch(() => untrack(() => (mode = "advanced")))
      .finally(() => (stubGateActive = false));
  });

  // ---- hash deep-link: #<tab>/<sec,sec> | #expert (§2.3) ----
  // URL segment names reflect the actual (flat, non-"advanced") tab structure: "info" and
  // "roms" match their Tab value directly; the "device" Tab value (internal name, unchanged
  // per the file-structure flattening) surfaces in the URL as "firmware" (the tab is labeled
  // "Firmware Setup" in the UI) since "device" alone reads as unrelated to "advanced/device".
  const HASH_SEGMENT: Record<Tab, string> = { info: "info", device: "firmware", roms: "roms" };
  function readHash() {
    const h = location.hash.replace(/^#/, "");
    if (h === "expert") {
      expert = true;
      return;
    }
    expert = false;
    const m = h.match(/^(info|firmware|roms)(?:\/(.*))?$/);
    if (!m) return;
    tab = (m[1] === "firmware" ? "device" : m[1]) as Tab;
    if (m[2]) {
      const ids = m[2].split(",").filter(Boolean);
      const next = { ...openByTab };
      next[tab] = new Set(ids);
      openByTab = next;
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
        // write the clean hash.
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
    const next = `#${HASH_SEGMENT[tab]}${open ? "/" + open : ""}`;
    if (location.hash !== next) history.replaceState(null, "", next);
  }

  function toggle(id: string) {
    if (runningSections.has(id)) return; // running can't collapse (§2.4)
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
      <h2>{locale.t.advanced.expertHeading}</h2>
      <button class="quiet" onclick={() => { location.hash = "#firmware"; }}>{locale.t.advanced.backToAdvanced}</button>
    </div>
    <ExpertCorner />
  </div>
{:else}
  <div class="shell" class:wide={tab === "roms"} class:narrow={tab === "info"}>
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
        class:active={tab === "roms"}
        aria-selected={tab === "roms"}
        tabindex={tab === "roms" ? 0 : -1}
        onclick={() => selectTab("roms")}
      >{locale.t.advanced.tabRoms}</button>

    </div>

    {#if tab === "info"}
      <OverviewTab openSet={openByTab.info} />
    {:else if tab === "device"}
      {#if !device.isConnected}
        <p class="connecting-placeholder">{locale.t.advanced.waitingForDevice}</p>
      {:else}
        <nav class="modeswitch-inline">
          <button class:active={mode === "wizard"} onclick={() => (mode = "wizard")}>{locale.t.advanced.modeGuidedSetup}</button>
          <button class:active={mode === "advanced"} onclick={() => (mode = "advanced")}>{locale.t.advanced.modeAdvanced}</button>
        </nav>
        {#if mode === "wizard"}
          <Wizard onComplete={() => selectTab("roms")} />
        {:else}
          <RetroGoTab openSet={openByTab.device} onToggle={toggle} {onRunning} />
        {/if}
      {/if}
    {:else}
      <RomManagementTab openSet={openByTab.roms} onToggle={toggle} {onRunning} />
    {/if}
  </div>
{/if}

<style>
  .connecting-placeholder {
    margin: 2rem auto;
    font-size: var(--fs-caption);
    color: var(--ink-soft);
    text-align: center;
  }
  .shell {
    /* Centered content column within the wide frame — the block is centered, data inside
       stays left-aligned. (The future Games tab can break out to the full width.) */
    width: 100%;
    flex: 1;
    max-width: 1000px;
    margin: 0 auto;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }
  .shell.narrow {
    max-width: 900px;
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
