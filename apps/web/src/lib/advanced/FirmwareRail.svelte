<script lang="ts" module>
  // Phase 4 — the Firmware tab's left rail. This replaced the multi-open accordion stack:
  // exactly one section is mounted at a time, chosen from the rail. The section components
  // themselves render only their own body — the rail supplies the heading and the selection.
  export type RailId = "ofw" | "install" | "lfs" | "flash-image" | "dump" | "erase-flash";
  export const RAIL_IDS: RailId[] = ["ofw", "install", "lfs", "flash-image", "dump", "erase-flash"];
</script>

<script lang="ts">
  import { device } from "../device.svelte.js";
  import Button from "../ui/Button.svelte";
  import RetroGoTab from "./RetroGoTab.svelte";
  import DumpSection from "./DumpSection.svelte";
  import FlashSection from "./FlashSection.svelte";
  import EraseSection from "./EraseSection.svelte";
  import OfficialFirmwareSection from "./OfficialFirmwareSection.svelte";
  import FileBrowserSection from "./FileBrowserSection.svelte";
  import { locale } from "../i18n/locale.svelte.js";
  import { createPaneFooterSlot } from "./paneFooter.svelte.js";
  import { listVersions, type FirmwareVersion } from "../artifacts.js";
  import { installTitleState } from "../firmwareDist/compare.js";

  // The anchored footer bar every Advanced artboard ends with (audit 5.1). Sections declare
  // their own bar with <PaneFooter>; it is drawn here, as the pane column's second child.
  const footer = createPaneFooterSlot();

  let {
    selected,
    onSelect,
    onRunning,
  }: {
    selected: RailId;
    onSelect: (id: RailId) => void;
    onRunning: (id: string, running: boolean) => void;
  } = $props();

  // File-manager device-FS items need a modded (retro-go) device to be meaningful.
  const gated = $derived(device.deviceClass?.kind !== "retrogo-sd" && device.deviceClass?.kind !== "retrogo-old");

  // Install / Reinstall / UPGRADE. This was `retroGoInstalledAnywhere ? reinstall : install` —
  // a binary "is anything installed" with no version awareness at all, so a device on a build
  // the index no longer retains read "Reinstall" here while the guided Wizard correctly said
  // "Upgrade". The rule is shared now (`firmwareDist/compare.ts`'s `installTitleState`), which
  // is the only thing that stops the two surfaces diverging again.
  //
  // `listVersions()` goes through `firmwareDist/memo.ts`, so this second caller costs no extra
  // fetch — the Wizard, RomSection and the curated walk already share that one request.
  let versions = $state<FirmwareVersion[]>([]);
  $effect(() => {
    listVersions().then((v) => { versions = v; }).catch(() => {});
  });
  const orderedGitTags = $derived(versions.map((v) => v.gitTag));

  // One `find` for both the title and the subtitle: `rgBank?.retroGoVersion` being truthy IS
  // "something is installed", which is the test the binary label made with `.some()`.
  const rgBank = $derived(device.banks.find((b) => b.retroGoVersion));
  const titleState = $derived(
    installTitleState(rgBank?.retroGoVersion, versions[0]?.gitTag, orderedGitTags),
  );
  const installLabel = $derived(
    titleState === "upgrade"
      ? locale.t.retroGoTab.upgradeRetroGoTitle
      : titleState === "reinstall"
        ? locale.t.retroGoTab.reinstallRetroGoTitle
        : locale.t.retroGoTab.installRetroGoTitle,
  );

  // The rail pane's page title + subtitle (audit 5.8). Every Advanced artboard opens with a
  // `24px/600/-0.015em` title and a `14px #5c5c5c` subtitle; the sections rendered only their
  // intro paragraph. The copy is artboard-verbatim (BackupPatch/Firmware/FileBrowser/Write/
  // Dump/Erase .dc.html); the Install pane's subtitle is device-derived, so it is a function
  // key and is omitted entirely when Retro-Go is not installed (no artboard shows one).
  const pagehead = $derived.by((): { title: string; subtitle: string | null } => {
    switch (selected) {
      case "ofw":
        return { title: locale.t.retroGoTab.backupAndPatchTitle, subtitle: locale.t.officialFirmware.pageSubtitle };
      case "install":
        return {
          title: installLabel,
          subtitle: rgBank?.retroGoVersion
            ? locale.t.retroGoTab.currentlyOnBank(String(rgBank.index), rgBank.retroGoVersion)
            : null,
        };
      case "lfs":
        return { title: locale.t.retroGoTab.fileBrowserTitle, subtitle: locale.t.fileBrowserSection.intro };
      case "flash-image":
        return { title: locale.t.retroGoTab.railWriteImage, subtitle: locale.t.flashSection.intro };
      case "dump":
        return { title: locale.t.retroGoTab.railDump, subtitle: locale.t.dumpSection.intro };
      default:
        return { title: locale.t.retroGoTab.railErase, subtitle: locale.t.eraseSection.intro };
    }
  });

  const groups = $derived([
    {
      heading: locale.t.retroGoTab.firmwareManagementHeading,
      items: [
        { id: "ofw" as RailId, label: locale.t.retroGoTab.backupAndPatchTitle },
        { id: "install" as RailId, label: installLabel },
      ],
    },
    {
      heading: locale.t.retroGoTab.flashManagementHeading,
      items: [
        { id: "lfs" as RailId, label: locale.t.retroGoTab.fileBrowserTitle },
        { id: "flash-image" as RailId, label: locale.t.retroGoTab.railWriteImage },
        { id: "dump" as RailId, label: locale.t.retroGoTab.railDump },
        { id: "erase-flash" as RailId, label: locale.t.retroGoTab.railErase },
      ],
    },
  ]);

</script>

<div class="split">
  <nav class="rail" aria-label={locale.t.advanced.tabFirmwareSetup}>
    {#each groups as g (g.heading)}
      <div class="group">
        <h3 class="railhead">{g.heading}</h3>
        {#each g.items as it (it.id)}
          <button
            class="item"
            class:selected={selected === it.id}
            aria-current={selected === it.id ? "true" : undefined}
            onclick={() => onSelect(it.id)}>{it.label}</button
          >
        {/each}
      </div>
    {/each}
  </nav>

  <div class="pane" class:narrow={selected === "install"}>
    {#key selected}
      <div class="panebody">
      <header class="pagehead">
        <h2 class="pagetitle">{pagehead.title}</h2>
        {#if pagehead.subtitle}<p class="pagesub">{pagehead.subtitle}</p>{/if}
      </header>
      {#if selected === "ofw"}
        <OfficialFirmwareSection />
      {:else if selected === "install"}
        <RetroGoTab onRunning={(r: boolean) => onRunning("install", r)} />
      {:else if selected === "lfs"}
        <div class:disabled={gated} aria-disabled={gated}>
          {#if device.utilLoaded}
            <FileBrowserSection />
          {:else}
            <Button variant="action" onclick={() => void device.startRecoveryMode()}>{locale.t.retroGoTab.enterRecoveryMode}</Button>
          {/if}
        </div>
      {:else if selected === "flash-image"}
        <FlashSection onRunning={(r: boolean) => onRunning("flash-image", r)} />
      {:else if selected === "dump"}
        <DumpSection onRunning={(r: boolean) => onRunning("dump", r)} />
      {:else}
        <EraseSection onRunning={(r: boolean) => onRunning("erase-flash", r)} />
      {/if}
      </div>
      {#if footer.content || footer.summary}
        <div class="panefoot">
          <span class="sum">{footer.summary ?? ""}</span>
          {#if footer.content}<div class="actions">{@render footer.content()}</div>{/if}
        </div>
      {/if}
    {/key}
  </div>
</div>

<style>
  /* Firmware.dc.html:76 — a FULL-BLEED `244px minmax(0, 1fr)` grid with `gap: 0` and
     `flex-grow: 1`, so the rail's border-right is the region edge: it reaches the page edge
     on the left (Advanced.svelte's `.tabpane.bleed` drops `.body`'s cap and side padding)
     and runs the full height of the region rather than stopping at content height. Both
     columns own their own padding here — that is why the pane is not inside `.page-body`. */
  .split {
    display: grid;
    grid-template-columns: 244px minmax(0, 1fr);
    gap: 0;
    align-items: stretch;
    flex: 1;
    width: 100%;
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
  }
  .item.selected {
    font-weight: 600;
    color: var(--ink);
    /* The marker sits on the rail's own edge, not inset. */
    box-shadow: inset 2px 0 0 var(--zelda-green);
    padding-inline-start: 14px;
    margin-inline-start: -14px;
  }
  /* Artboard: `padding: 32px 40px 40px; gap: 28px; max-width: 880px` — the Install pane is
     `gap: 32px; max-width: 720px` instead (Firmware.dc.html:80). */
  /* The column itself carries no padding: it is the artboards' `flex-column;
     justify-content: space-between` wrapper holding the padded body and the full-width
     footer bar (Write.dc.html:99 — the same shape in every Advanced artboard). */
  .pane {
    min-width: 0;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
  }
  .panebody {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 28px;
    padding: 32px var(--page-pad-x) 40px;
    max-width: 880px;
  }
  .pane.narrow .panebody {
    gap: 32px;
    max-width: 720px;
  }
  /* Artboard: `border-top: 1px solid #d8d8d8; background: #ffffff; padding: 0 40px;
     min-height: 72px; justify-content: space-between` — identical in Write/Dump/Erase/
     FileBrowser/BackupPatch*. It spans the whole column, not the capped body. */
  .panefoot {
    border-top: 1px solid var(--hairline);
    background: var(--surface);
    padding: 0 var(--page-pad-x);
    min-height: 72px;
    box-sizing: border-box;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
  }
  /* 13px: the artboards' footer caption size. No 13px type token exists (--fs-caption is
     14px), and the surrounding chrome already uses the literal. */
  .sum {
    font-size: var(--fs-btn-sm);
    color: var(--ink-soft);
  }
  /* `margin-left: auto` is the artboards' own declaration on this group (Firmware.dc.html:151,
     and the equivalent action element in Write/Dump/Erase/FileBrowser/BackupPatch*): the action
     stays hard right even when the summary is absent or wraps. */
  .actions {
    display: flex;
    align-items: center;
    gap: 14px;
    flex: none;
    margin-inline-start: auto;
  }
  .pagehead {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .pagetitle {
    margin: 0;
    font-size: 24px;
    font-weight: 600;
    letter-spacing: -0.015em;
  }
  .pagesub {
    margin: 0;
    font-size: var(--fs-caption);
    color: var(--ink-soft);
  }
  .disabled {
    opacity: 0.6;
  }
</style>
