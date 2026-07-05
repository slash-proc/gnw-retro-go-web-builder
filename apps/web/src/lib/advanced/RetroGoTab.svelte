<script lang="ts">
  import { device } from "../device.svelte.js";
  import AccordionSection from "./AccordionSection.svelte";
  import Button from "../ui/Button.svelte";
  import RomSection from "./RomSection.svelte";
  import DumpSection from "./DumpSection.svelte";
  import FlashSection from "./FlashSection.svelte";
  import EraseSection from "./EraseSection.svelte";
  import OfficialFirmwareSection from "./OfficialFirmwareSection.svelte";
  import FileBrowserSection from "./FileBrowserSection.svelte";
  import { locale } from "../i18n/locale.svelte.js";

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

  // Auto-naming: "Install" until Retro-Go is found anywhere on the device, then "Reinstall".
  const retroGoInstalledAnywhere = $derived(device.banks.some((b) => b.retroGoVersion));
  const installSectionTitle = $derived(
    retroGoInstalledAnywhere ? locale.t.retroGoTab.reinstallRetroGoTitle : locale.t.retroGoTab.installRetroGoTitle,
  );
</script>

<div class="stack">
  <!-- 1. Official Firmware — staged backup → patch flow, in the shared accordion style. Default-
       opened by Advanced.svelte when stock firmware is detected. -->
  <div class="group">
    <h3 class="subhead">{locale.t.retroGoTab.officialFirmwareHeading}</h3>
    <AccordionSection id="ofw" title={locale.t.retroGoTab.backupAndPatchTitle} open={openSet.has("ofw")} {onToggle}>
      <OfficialFirmwareSection />
    </AccordionSection>
  </div>

  <!-- 2. Retro-Go — Install/Repair the base, plus the device-FS tools (File Browser, Screenshots).
       Flash (default) vs SD via the switch — both always selectable. RomSection renders inside.
       The FS tools need a modded (retro-go) device, so they gate on that. -->
  <div class="group">
    <h3 class="subhead">{locale.t.retroGoTab.retroGoHeading}</h3>
    <AccordionSection id="install" title={installSectionTitle} open={openSet.has("install")} {onToggle}>
      <div class="install">
        {#if device.scanning}
          <!-- The bank inference (RomSection's `inferredBank`) and the "Install"/"Reinstall"
               title above both read device.banks, which is empty pre-scan and settles
               asynchronously — rendering the real content here mid-scan means showing a
               bank-1 default that then jumps to whatever the scan actually finds. Mask it
               behind a scanning placeholder instead, same idea as the Overview tab's external-
               flash panel. -->
          <div class="placeholder">{locale.t.retroGoTab.scanningDevice}</div>
        {:else if device.utilLoaded}
          <RomSection installMode={device.targetMedia} onRunning={(r) => onRunning("install", r)} />
        {:else}
          <Button variant="action" onclick={() => device.ensureStub()}>{locale.t.retroGoTab.enterRecoveryMode}</Button>
        {/if}
      </div>
    </AccordionSection>

    <div class="sections" class:disabled={gated} aria-disabled={gated}>
      <AccordionSection
        id="lfs"
        title={locale.t.retroGoTab.fileBrowserTitle}
        open={openSet.has("lfs")}
        {onToggle}
      >
        {#if device.utilLoaded}
          <FileBrowserSection />
        {:else}
          <Button variant="action" onclick={() => device.ensureStub()}>{locale.t.retroGoTab.enterRecoveryMode}</Button>
        {/if}
      </AccordionSection>
    </div>
  </div>

  <!-- 4. Flash management — dump / flash arbitrary images at offsets. -->
  <div class="group">
    <h3 class="subhead">{locale.t.retroGoTab.flashManagementHeading}</h3>
    <DumpSection open={openSet.has("dump")} {onToggle} onRunning={(r) => onRunning("dump", r)} />
    <FlashSection
      open={openSet.has("flash-image")}
      {onToggle}
      onRunning={(r) => onRunning("flash-image", r)}
    />
    <EraseSection
      open={openSet.has("erase-flash")}
      {onToggle}
      onRunning={(r: boolean) => onRunning("erase-flash", r)}
    />
  </div>
</div>

<style>
  .stack {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    max-width: 900px;
    margin: 0 auto;
    width: 100%;
  }
  .install {
    display: flex;
    flex-direction: column;
    gap: 0.85rem;
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
  .placeholder {
    margin: 0;
    font-size: var(--fs-caption);
    color: var(--ink-soft);
    opacity: 0.7;
  }
</style>
