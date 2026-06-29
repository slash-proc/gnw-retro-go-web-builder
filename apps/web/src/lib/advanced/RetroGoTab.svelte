<script lang="ts">
  import { device } from "../device.svelte.js";
  import { roms } from "../roms.svelte.js";
  import { loadSel, saveSel } from "../persist.js";
  import DeferredSection from "./DeferredSection.svelte";
  import AccordionSection from "./AccordionSection.svelte";
  import RomSection from "./RomSection.svelte";
  import DumpSection from "./DumpSection.svelte";
  import FlashSection from "./FlashSection.svelte";
  import EraseSection from "./EraseSection.svelte";
  import OfficialFirmwareSection from "./OfficialFirmwareSection.svelte";
  import FileBrowserSection from "./FileBrowserSection.svelte";

  // Tab: Device / Retro-Go Management. Three groups, top → bottom:
  //   1. Official Firmware — Backup → Patch-for-Dualboot (accordion).
  //   2. Retro-Go — Install/Repair the base (Flash = RomSection; SD = deferred) · File Browser
  //      (LFS default, FrogFS/SD selectable) · Screenshots (deferred). ROMs come after, in ROM
  //      Management. (The FrogFS installed-games scan lives on the ROM-Management side later.)
  //   3. Flash management (dump / flash arbitrary images) — live
  let {
    openSet,
    onToggle,
    onRunning,
  }: {
    openSet: Set<string>;
    onToggle: (id: string) => void;
    onRunning: (id: string, running: boolean) => void;
  } = $props();

  // File-manager device-FS items need a modded (retro-go) device to be meaningful.
  const gated = $derived(device.deviceClass?.kind !== "retrogo-sd" && device.deviceClass?.kind !== "retrogo-old");

  // Install target: flash (default) or SD — both ALWAYS selectable (someone installing the SD
  // build is hunting for that button; SD detection can't cover every mod). Remembered per visit.
  let installMode = $state<"flash" | "sd">(loadSel("installMode", "flash"));
  $effect(() => saveSel("installMode", installMode));
</script>

<div class="stack">
  <!-- 1. Official Firmware — staged backup → patch flow, in the shared accordion style. Default-
       opened by Advanced.svelte when stock firmware is detected. -->
  <div class="group">
    <h3 class="subhead">Official Firmware</h3>
    <AccordionSection id="ofw" title="Backup & Patch" open={openSet.has("ofw")} {onToggle}>
      <OfficialFirmwareSection />
    </AccordionSection>
  </div>

  <!-- 2. Retro-Go — Install/Repair the base, plus the device-FS tools (File Browser, Screenshots).
       Flash (default) vs SD via the switch — both always selectable. RomSection renders inside.
       The FS tools need a modded (retro-go) device, so they gate on that. -->
  <div class="group">
    <h3 class="subhead">Retro-Go</h3>
    <AccordionSection id="install" title="Install / Repair" open={openSet.has("install")} {onToggle}>
      <div class="install">
        <div class="seg" role="group" aria-label="Install target">
          <button class="opt" class:active={installMode === "flash"} onclick={() => (installMode = "flash")}>
            Flash
          </button>
          <button class="opt" class:active={installMode === "sd"} onclick={() => (installMode = "sd")}>
            SD
          </button>
        </div>

        <RomSection {installMode} onRunning={(r) => onRunning("install", r)} />
      </div>
    </AccordionSection>

    <div class="sections" class:disabled={gated} aria-disabled={gated}>
      <AccordionSection
        id="lfs"
        title="File Browser"
        open={openSet.has("lfs")}
        {onToggle}
      >
        <FileBrowserSection />
      </AccordionSection>
      <DeferredSection
        id="screenshots"
        title="Screenshots"
        open={openSet.has("screenshots")}
        {onToggle}
        chipText="none found"
        will="List and download screenshots Retro-Go saved on the device (LittleFS flash or SD FatFS) — mostly useful for LittleFS users; shows none when the filesystem has no screenshots."
        needs="the same device FS read bindings as the File Browser (sdListDir / sdRead). No separate screenshot() op."
        control="Load screenshots"
      />
    </div>
  </div>

  <!-- 4. Flash management — dump / flash arbitrary images at offsets. -->
  <div class="group">
    <h3 class="subhead">Flash management</h3>
    <DumpSection open={openSet.has("dump")} {onToggle} onRunning={(r) => onRunning("dump", r)} />
    <FlashSection
      open={openSet.has("flash-image")}
      {onToggle}
      onRunning={(r) => onRunning("flash-image", r)}
    />
    <EraseSection
      open={openSet.has("erase-flash")}
      {onToggle}
      onRunning={(r) => onRunning("erase-flash", r)}
    />
  </div>
</div>

<style>
  .stack {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }
  .install {
    display: flex;
    flex-direction: column;
    gap: 0.85rem;
  }
  /* [Flash | SD] segmented switch. */
  .seg {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
  }
  .seg .opt {
    font: inherit;
    font-size: var(--fs-caption);
    font-weight: 600;
    color: var(--ink-soft);
    background: var(--surface-sunk);
    border: 1px solid var(--hairline);
    padding: 0.25rem 0.95rem;
    cursor: pointer;
  }
  .seg .opt:first-of-type {
    border-radius: var(--r-control) 0 0 var(--r-control);
  }
  .seg .opt:last-of-type {
    border-radius: 0 var(--r-control) var(--r-control) 0;
    border-left: none;
  }
  .seg .opt.active {
    background: var(--surface);
    color: var(--ink);
    border-color: var(--model-accent);
  }
  .seg .opt:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }
  .sections {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }
  .sections.disabled {
    opacity: 0.6;
  }
  /* Each top-level section group is set off by a divider + subheading. */
  .group {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    margin-top: 0.5rem;
    padding-top: 0.75rem;
    border-top: 1px solid var(--surface-sunk);
  }
  .subhead {
    margin: 0;
    font-size: var(--fs-caption);
    font-weight: 600;
    color: var(--ink-soft);
  }
</style>
