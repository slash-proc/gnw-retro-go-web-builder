<script lang="ts">
  import { device } from "../device.svelte.js";
  import { pickAndScanRomFolder, folderPickerSupported, type RomScanResult } from "../romScan.js";
  import {
    buildFlashInstall,
    flashInstallToDevice,
    BudgetError,
    FLASH_REGIONS,
    type FlashInstall,
    type FlashRegion,
  } from "../engine/flashInstall.js";
  import { listVersions, fetchBundle } from "../artifacts.js";
  import { dumpRegion } from "../engine/flasher.js";
  import { readFrogfsState } from "../engine/fsscan.js";
  import { dbg as dbgLog } from "../debug.js";
  import { readGameData } from "../engine/frogfsDevice.js";
  import { ensureLfsTree, readLfsFile } from "../engine/lfsBrowser.js";
  import type { LittlefsTreeNode } from "@gnw/fs-builders";
  import { HOMEBREW_TITLES } from "../engine/homebrew.js";
  import { planFlashLayout } from "@gnw/fs-builders";
  import { locateSuperblock, readSuperblock, SUPERBLOCK_SIZE } from "@gnw/gnw-patch";
  import AccordionSection, { type ChipKind } from "./AccordionSection.svelte";
  import Button from "../ui/Button.svelte";
  import SplitButton from "../ui/SplitButton.svelte";
  import ConfirmModal from "../ui/ConfirmModal.svelte";
  import GeometryBar from "../ui/GeometryBar.svelte";
  import { extflashSegments, intflashSegments } from "../engine/classify.js";

  // Tab B.1 — ROM / homebrew management. Pick a folder → scan → build the FrogFS +
  // LittleFS images (with the bundled default content) → flash. Covers + cheats fold
  // in here later as more content under the same scan.
  let {
    installMode,
    onRunning,
  }: { installMode: "flash" | "sd"; onRunning?: (r: boolean) => void } = $props();

  import { roms } from "../roms.svelte.js";
  const scan = $derived(roms.scan);
  let bank = $state<1 | 2>(2); // default: keep stock in bank 1 (dual-boot)
  let preparing = $state(false);
  let install = $state<FlashInstall | null>(null);
  let flashing = $state(false);
  let result = $state<"success" | null>(null);
  let err = $state<string | null>(null);
  let modalOpen = $state(false);
  let flashTarget = $state<readonly FlashRegion[]>(FLASH_REGIONS); // which regions the modal will flash

  function openFlash(regions: readonly FlashRegion[]) {
    flashTarget = overwriteLfs ? regions : regions.filter(r => r !== "littlefs");
    modalOpen = true;
  }
  // Expert layout overrides (decision: "specify offset of frogfs and size of littlefs").
  let layoutOpen = $state(false);
  let frogfsOffsetStr = $state(""); // blank = auto
  let littlefsMiBStr = $state(""); // blank = auto

  let latestVersion = $state<string | null>(null);
  $effect(() => {
    listVersions().then((v) => {
      if (v.length > 0) latestVersion = v[0].tag;
    });
  });

  const retroGoBank = $derived(device.banks.find((b) => b.retroGoVersion));
  const installedVersion = $derived(retroGoBank?.retroGoVersion);

  function parseSha(v: string | null | undefined) {
    if (!v) return null;
    const m = v.match(/g?([0-9a-f]{7})[0-9a-f]*$/);
    return m ? m[1] : null;
  }

  const installedSha = $derived(parseSha(installedVersion));
  const latestSha = $derived(parseSha(latestVersion));
  const isSameVersion = $derived(installedSha !== null && latestSha !== null && installedSha === latestSha);

  let repairMode = $state<"repair" | "upgrade">("upgrade");
  let migrateGames = $state(false);
  let overwriteLfs = $state(false);

  function setRepairMode(mode: "repair" | "upgrade") {
    repairMode = mode;
    migrateGames = mode === "repair";
  }

  $effect(() => {
    if (isSameVersion && repairMode === "upgrade") {
      repairMode = "repair";
      migrateGames = true;
    }
  });

  const supported = folderPickerSupported();
  const EXTBASE = 0x90000000;
  const extBytes = $derived(device.info?.externalFlashSizeBytes ?? 0);
  const blockSize = $derived(device.info?.minEraseSizeBytes ?? 4096);
  const MiB = (n: number) => (n / 1048576).toFixed(2);
  const hex = (n: number) => "0x" + (n >>> 0).toString(16);

  // Current on-device flash layout (from the device scan) — drives the geometry aid below.
  const intSegs = $derived(intflashSegments(device.banks));
  const extSegs = $derived(extflashSegments(device.partitions, extBytes));
  const extEnd = $derived(EXTBASE + extBytes);
  const deviceScanned = $derived(device.banks.length > 0);

  const frogfsPart = $derived(device.partitions.find((p) => p.fs === "frogfs"));
  const reservedEnd = $derived(
    device.partitions
      .filter((p) => p.fs !== "littlefs" && p.fs !== "frogfs")
      .reduce((m, p) => Math.max(m, p.offset + p.size), 0),
  );
  const reservedEndAligned = $derived(Math.ceil(reservedEnd / blockSize) * blockSize);
  const defaultFrogfsOffset = $derived(
    frogfsPart && frogfsPart.offset % blockSize === 0 ? frogfsPart.offset : reservedEndAligned,
  );

  const frogfsOffset = $derived.by(() => {
    const s = frogfsOffsetStr.trim();
    if (!s) return defaultFrogfsOffset;
    const n = s.toLowerCase().startsWith("0x") ? parseInt(s, 16) : parseInt(s, 10);
    const parsed = Number.isFinite(n) && n >= 0 ? n : defaultFrogfsOffset;
    // The flasher hangs if the offset is not aligned to the device's erase block size.
    return Math.ceil(parsed / blockSize) * blockSize;
  });
  const littlefsOverride = $derived.by(() => {
    const s = littlefsMiBStr.trim();
    if (!s) return undefined;
    const n = parseFloat(s);
    return Number.isFinite(n) && n > 0 ? Math.round(n * 1048576) : undefined;
  });

  async function doPrepare() {
    err = null;
    result = null;
    preparing = true;
    install = null;
    try {
      // The layout needs the device's extflash + erase size, so the RAM util must be up.
      const flasher = await device.ensureStub();
      const targetVersion = (installedVersion && latestVersion && !isSameVersion && repairMode === "repair")
        ? installedVersion
        : (latestVersion ?? "");
      if (!targetVersion) throw new Error("No firmware versions are published yet.");
      
      const bundle = await fetchBundle(targetVersion);

      const userRoms = new Map<string, Uint8Array>();
      const read = (off: number, len: number) => dumpRegion(flasher, 0, off, len);
      
      const lfsData = new Map<string, Uint8Array>();
      let frogfsState;
      const isRetroGo = device.deviceClass?.kind === "retrogo-sd" || device.deviceClass?.kind === "retrogo-old";
      if (isRetroGo) {
        try {
          frogfsState = await readFrogfsState(read, defaultFrogfsOffset, extBytes - defaultFrogfsOffset);
          console.log("Read frogfsState:", frogfsState);
        } catch (e) {
          console.warn("Could not read previous FrogFS state:", e);
        }
        
        try {
          const lfsTree = await ensureLfsTree();
          async function extractLfs(node: LittlefsTreeNode, pathPrefix: string) {
            for (const child of node.children || []) {
              const fullPath = pathPrefix + child.name;
              if (child.isDirectory) {
                await extractLfs(child, fullPath + "/");
              } else {
                lfsData.set(fullPath, await readLfsFile(fullPath));
              }
            }
          }
          const dataDir = lfsTree.children?.find((c) => c.name === "data" && c.isDirectory);
          if (dataDir) await extractLfs(dataDir, "data/");
          const configFile = lfsTree.children?.find((c) => c.name === "CONFIG" && !c.isDirectory);
          if (configFile) lfsData.set("CONFIG", await readLfsFile("CONFIG"));
          console.log("Extracted LittleFS data for migration:", [...lfsData.keys()]);
        } catch (e) {
          console.warn("Could not extract LittleFS data for migration:", e);
        }
      }

      if (migrateGames && device.installedGames.length > 0) {
        for (const g of device.installedGames) {
          const path = `${g.system}/${g.name}`;
          if (!userRoms.has(path)) {
            userRoms.set(path, await readGameData(read, defaultFrogfsOffset, g));
          }
        }
      }

      // Build selectedHomebrew: Celeste is always included. For others, check if their
      // device files are present in the userRoms map (which includes migrated on-device games).
      const selectedHomebrew = new Set(["celeste"]);
      for (const hb of HOMEBREW_TITLES) {
        if (hb.key === "celeste") continue;
        // If the user's rom folder (or migrated device state) has ANY of the title's device files, keep it.
        const hasFiles = hb.deviceFiles.some((f) => userRoms.has(`homebrew/${f}`));
        if (hasFiles) selectedHomebrew.add(hb.key);
      }

      install = await buildFlashInstall({
        bundle,
        bank,
        extflashSize: extBytes,
        blockSize,
        userRoms,
        reservedOffset: frogfsOffset,
        frogfsState,
        littlefsLength: littlefsOverride,
        lfsData,
        opts: {
          selectedHomebrew,
          homebrewTitles: HOMEBREW_TITLES,
        },
      });
    } catch (e) {
      err = e instanceof BudgetError ? e.message : e instanceof Error ? e.message : String(e);
    } finally {
      preparing = false;
    }
  }

  // Two bars: main = overall (weighted by image bytes), sub = current image.
  async function run(
    report: (d: number, t: number, sub?: { value: number; max: number; label: string }) => void,
  ) {
    const inst = install!;
    const sizes: Record<string, number> = {
      intflash: inst.intflash.length,
      frogfs: inst.frogfs.length,
      littlefs: inst.littlefs.length,
    };
    
    // For SD mode, only flash the intflash region.
    const actualFlashTarget = installMode === "sd" 
      ? flashTarget.filter(r => r === "intflash")
      : flashTarget;

    if (actualFlashTarget.length === 0) return;

    if (installMode !== "sd") {
      // Defensive capacity guard: the external-flash payload (FrogFS + LittleFS) must fit the chip.
      const extPayload = inst.frogfs.length + inst.littlefs.length;
      if (!device.fitsExtFlash(extPayload)) {
        throw new Error(
          `External payload (${MiB(extPayload)} MB) exceeds this device's external flash ` +
            `(${MiB(extBytes)} MB) — can't flash.`,
        );
      }
    }

    const totalB = actualFlashTarget.reduce((n, r) => n + sizes[r], 0);
    const flasher = await device.ensureStub();
    await flashInstallToDevice(
      flasher,
      inst,
      (phase, d, t) => {
        let prior = 0;
        for (const r of actualFlashTarget) {
          if (r === phase) break;
          prior += sizes[r];
        }
        const overall = prior + sizes[phase] * (t ? d / t : 0);
        report(overall, totalB, { value: d, max: t, label: phase });
      },
      dbgLog,
      actualFlashTarget,
    );
  }

  // Confirm-modal copy adapts to the selected regions.
  const flashTitle = $derived(
    flashTarget.length === FLASH_REGIONS.length ? "Flash this install?" : `Flash ${flashTarget.join(" + ")}?`,
  );
  const flashBody = $derived.by(() => {
    if (!install) return "";
    const names: Record<FlashRegion, string> = {
      intflash: `intflash → bank ${install.bank}`,
      frogfs: `FrogFS → ext ${hex(EXTBASE + install.layout.frogfsOffset)}`,
      littlefs: `LittleFS → ext ${hex(EXTBASE + install.layout.littlefsOffset)}`,
    };
    return `Writes: ${flashTarget.map((r) => names[r]).join(", ")}. Don't unplug your device until it finishes.`;
  });

  // Debug: read the superblock back from flash and compare to the patched blob.
  let sbCheck = $state<string | null>(null);
  async function checkSuperblock() {
    sbCheck = "reading…";
    try {
      if (!install) return (sbCheck = "Build an install first.");
      if (!device.isConnected) return (sbCheck = "Connect first.");
      const flasher = await device.ensureStub();
      const off = locateSuperblock(install.intflash);
      const onDev = await dumpRegion(flasher, install.bank, off, SUPERBLOCK_SIZE);
      const exp = install.intflash.subarray(off, off + SUPERBLOCK_SIZE);
      const match = onDev.every((b, i) => b === exp[i]);
      const sb = readSuperblock(onDev, 0);
      sbCheck =
        `@bank${install.bank}+${hex(off)} flash==patched: ${match}\n` +
        `on-device: magic=${hex(sb.magic)} ver=${sb.version} sz=${sb.structSize} ` +
        `extsz=${sb.extflashSize} lfslen=${sb.littlefsLength} flags=${sb.flags} crc=${hex(sb.crc32)}`;
    } catch (e) {
      sbCheck = e instanceof Error ? e.message : String(e);
    }
  }

  // Start (jump to + run) the firmware in a bank — session-only boot for testing
  // (a cold power-cycle reverts to the default boot bank).
  let starting = $state(false);
  let startResult = $state<string | null>(null);
  async function startBank(b: number) {
    if (!device.isConnected) return (startResult = "Connect first.");
    starting = true;
    startResult = null;
    try {
      await (await device.ensureStub()).startBank(b);
      startResult = `Started bank ${b}. The device is now running that firmware — the stub is no longer active; reconnect or power-cycle to use the app again.`;
    } catch (e) {
      startResult = e instanceof Error ? e.message : String(e);
    } finally {
      starting = false;
    }
  }

  // Live layout preview — uses the built image sizes once available, else 0/floor, so
  // the configured FrogFS offset + LittleFS size update the bar as the user types.
  const coresBytes = $derived(
    install ? install.plan.coreFiles.reduce((n, f) => n + f.data.length, 0) : 0,
  );
  const frogBytes = $derived(install ? install.frogfs.length : 0);
  const previewLayout = $derived.by(() =>
    extBytes
      ? planFlashLayout({
          extflashSize: extBytes,
          frogfsLength: frogBytes,
          coresSize: coresBytes,
          blockSize,
          reservedOffset: frogfsOffset,
          littlefsLength: littlefsOverride,
        })
      : null,
  );
  const segs = $derived(
    previewLayout
      ? [
          { kind: "reserved", pct: (previewLayout.frogfsOffset / extBytes) * 100 },
          { kind: "frogfs", pct: (previewLayout.frogfsLength / extBytes) * 100 },
          { kind: "free", pct: (previewLayout.freeBytes / extBytes) * 100 },
          { kind: "littlefs", pct: (previewLayout.littlefsLength / extBytes) * 100 },
        ].filter((s) => s.pct > 0.01)
      : [],
  );
  // Absolute extflash addresses + end-of-device validation.
  const geom = $derived.by(() => {
    if (!previewLayout) return null;
    const L = previewLayout;
    const fEnd = L.frogfsOffset + L.frogfsLength;
    const lEnd = L.littlefsOffset + L.littlefsLength;
    return {
      fStart: EXTBASE + L.frogfsOffset,
      fEnd: EXTBASE + fEnd,
      lStart: EXTBASE + L.littlefsOffset,
      lEnd: EXTBASE + lEnd,
      devEnd: EXTBASE + L.deviceEndOffset,
      endsAtChip: lEnd === L.deviceEndOffset, // LittleFS ends exactly at the chip end
      noOverlap: fEnd <= L.littlefsOffset,
      aligned: L.aligned,
    };
  });

  const chipKind = $derived<ChipKind>(
    flashing ? "running" : result ? "success" : "idle",
  );
  const chipText = $derived(
    flashing ? "flashing" : result ? "✓ installed" : scan ? `${scan.summary.totalFiles} files` : "idle",
  );
</script>

<div class="stack">
    {#if installedVersion}
      <p class="muted">Version already installed: {installedVersion}</p>
    {/if}
    {#if latestVersion}
      <p class="muted">Version being installed: {repairMode === "repair" ? installedVersion : latestVersion}</p>
    {/if}

    {#if installedVersion && latestVersion && !isSameVersion}
      <label class="field"><span>Update mode</span>
        <select class="mono" bind:value={repairMode} onchange={(e) => setRepairMode(e.currentTarget.value as any)}>
          <option value="upgrade">Upgrade to latest ({latestVersion})</option>
          <option value="repair">Repair current ({installedVersion})</option>
        </select>
      </label>
    {/if}

    <div class="field" style="flex-direction: column; align-items: flex-start;">
      <label class="row" style="cursor: pointer;">
        <input type="checkbox" bind:checked={migrateGames} />
        <span>Migrate games (preserve existing on-device games)</span>
      </label>
      <label class="row" style="cursor: pointer;">
        <input type="checkbox" bind:checked={overwriteLfs} />
        <span>Overwrite saves and settings (LittleFS)</span>
      </label>
    </div>

    {#if installMode === "sd"}
      <p class="muted">
        Set up Retro-Go on an SD card. The intflash will be flashed to support SD, but FrogFS and LittleFS will not be written to the device.
      </p>
    {/if}


      <!-- Current on-device flash layout (from the scan). Grayed until a scan has run.
           LATER: project the install's resulting layout onto this bar to preview what an
           install would overwrite (conflict / clobber preview). -->
      <div class="devgeo" class:dim={!deviceScanned && !device.scanning}>
        <div class="devgeo-title mono">Device layout</div>
        {#if deviceScanned || device.scanning}
          {#if device.deviceClass}
            <div class="devclass {device.deviceClass.kind}">{device.deviceClass.label}</div>
          {/if}
          {#if device.banks.length}
            <GeometryBar segments={intSegs} title="internal flash" leftLabel={hex(0x08000000)} rightLabel={hex(0x08200000)} />
          {/if}
          {#if device.scanning}
            <div class="scanning mono">
              <div class="track"><div class="fill" style="width:{Math.round(device.scanProgress * 100)}%"></div></div>
              <span>Scanning… {Math.round(device.scanProgress * 100)}%</span>
            </div>
          {:else if device.scanError}
            <div class="scanerr mono">scan failed: {device.scanError}</div>
          {:else if extSegs.length}
            <GeometryBar segments={extSegs} title="external flash" leftLabel={hex(EXTBASE)} rightLabel={hex(extEnd)} />
          {/if}
        {:else}
          <p class="muted">Scan the device to see its current flash layout.</p>
        {/if}
      </div>

      <!-- Expert layout overrides: FrogFS base offset + LittleFS partition size. -->
      <div class="sub">
        <button class="sub-toggle" aria-expanded={layoutOpen} onclick={() => (layoutOpen = !layoutOpen)}>
          <span aria-hidden="true">{layoutOpen ? "▾" : "▸"}</span> Layout (advanced)
        </button>
        {#if layoutOpen}
          <div class="sub-body">
            <label class="field"><span>FrogFS offset <em>(bytes from 0x90000000; reserves the bottom)</em></span>
              <input class="mono" bind:value={frogfsOffsetStr} placeholder="auto ({hex(defaultFrogfsOffset)})" />
            </label>
            <label class="field"><span>LittleFS size <em>(MiB; blank = auto, ≥8)</em></span>
              <input class="mono" bind:value={littlefsMiBStr} placeholder="auto" />
            </label>
            <p class="muted">
              Default: FrogFS offset automatically reserves the bottom based on device layout. LittleFS auto-sized to the cores + saves
              headroom (≥8 MiB) at the top. Both round up to the {blockSize} B erase block.
            </p>

          </div>
        {/if}
      </div>

      <div class="grid">
        <label class="field"><span>Install to</span>
          <select class="mono" bind:value={bank} disabled={flashing}>
            <option value={2}>bank 2 — keep stock (dual-boot)</option>
            <option value={1}>bank 1 — overwrite stock</option>
          </select>
        </label>
        <div class="field"><span>&nbsp;</span>
          <Button variant="default" disabled={!device.isConnected || preparing || flashing} onclick={doPrepare}>
            {preparing ? "Building…" : "Build install"}
          </Button>
        </div>
      </div>

      {#if !device.isConnected}
        <p class="muted">Connect a device to size and flash the install.</p>
      {/if}

    {#if err}
      <p class="notice warn">{err}</p>
    {/if}

    {#if install && geom}
      <div class="well mono">
        <div>FrogFS&nbsp;&nbsp; {hex(geom.fStart)} – {hex(geom.fEnd)} · {MiB(install.frogfs.length)} MiB</div>
        <div>LittleFS {hex(geom.lStart)} – {hex(geom.lEnd)} · {MiB(install.littlefs.length)} MiB</div>
        <div>device end {hex(geom.devEnd)} · block {blockSize} B · free {MiB(install.layout.freeBytes)} MiB</div>
        <div class:bad={!(geom.endsAtChip && geom.noOverlap && geom.aligned)}>
          checks: ends-at-chip {geom.endsAtChip ? "✓" : "✗"} · no-overlap {geom.noOverlap ? "✓" : "✗"} · aligned {geom.aligned ? "✓" : "✗"}
        </div>
        <div>systems: {install.plan.systems.join(", ") || "(none)"}</div>
      </div>

      <div>
        <SplitButton
          label="Flash install…"
          disabled={flashing}
          onclick={() => openFlash(FLASH_REGIONS)}
          items={[
            { label: "Flash Intflash", onclick: () => openFlash(["intflash"]) },
            { label: "Flash FrogFS", onclick: () => openFlash(["frogfs"]) },
            { label: "Flash LittleFS", onclick: () => openFlash(["littlefs"]) },
          ]}
        />
      </div>

      {@const mainBank = install.bank}
      {@const otherBank = install.bank === 1 ? 2 : 1}
      <div>
        <SplitButton
          variant="default"
          label={`Start bank ${mainBank}`}
          disabled={starting || flashing || !device.isConnected}
          onclick={() => startBank(mainBank)}
          items={[{ label: `Start bank ${otherBank}`, onclick: () => startBank(otherBank) }]}
        />
        {#if startResult}<pre class="dbgout mono">{startResult}</pre>{/if}
      </div>

      <div>
        <button class="dbglink" onclick={checkSuperblock}>Read back superblock (debug)</button>
        {#if sbCheck}<pre class="dbgout mono">{sbCheck}</pre>{/if}
      </div>
    {/if}
  </div>

<ConfirmModal
  open={modalOpen}
  title={flashTitle}
  body={flashBody}
  danger
  confirmText="Flash"
  run={async (report) => {
    flashing = true;
    onRunning?.(true);
    try {
      await run(report);
      void device.runScan(); // big change → rescan the device geometry (docs/DEVICE_SCAN.md)
    } catch (e) {
      err = e instanceof Error ? e.message : String(e);
      throw e;
    } finally {
      flashing = false;
      onRunning?.(false);
    }
  }}
  onClose={() => (modalOpen = false)}
/>

<style>
  .stack {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }
  .muted {
    color: var(--ink-soft);
    font-size: var(--fs-caption);
    margin: 0;
  }
  .grid {
    display: grid;
    gap: 0.75rem;
    grid-template-columns: 1.6fr 1fr;
    align-items: end;
  }
  @media (max-width: 560px) {
    .grid {
      grid-template-columns: 1fr;
    }
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
    font-size: var(--fs-caption);
  }
  input,
  select {
    font: inherit;
    padding: 0.35rem 0.5rem;
    border: 1px solid var(--hairline);
    border-radius: var(--r-control);
    background: var(--surface);
    color: var(--ink);
  }
  .field em {
    color: var(--ink-soft);
    font-style: normal;
    font-size: var(--fs-micro);
  }
  .mono {
    font-family: var(--font-mono);
  }
  .sub {
    border: 1px solid var(--hairline);
    border-radius: var(--r-control);
  }
  .sub-toggle {
    width: 100%;
    text-align: left;
    font: inherit;
    font-size: var(--fs-caption);
    font-weight: 600;
    background: var(--surface-sunk);
    color: var(--ink);
    border: none;
    padding: 0.4rem 0.6rem;
    cursor: pointer;
  }
  .sub-body {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    padding: 0.6rem;
  }
  .well {
    background: var(--surface-sunk);
    padding: 0.55rem 0.7rem;
    font-size: var(--fs-micro);
    overflow-x: auto;
    white-space: nowrap;
  }
  .well > div {
    line-height: 1.5;
  }
  .notice {
    margin: 0;
    font-size: var(--fs-caption);
    color: var(--caution);
    background: var(--surface-sunk);
    border-radius: var(--r-control);
    padding: 0.5rem 0.65rem;
  }
  .warn {
    color: var(--caution);
  }
  .extbar {
    display: flex;
    height: 1.4rem;
    border: 1px solid var(--hairline);
    border-radius: var(--r-control);
    overflow: hidden;
  }
  .seg {
    display: flex;
    align-items: center;
    justify-content: center;
    min-width: 0;
    overflow: hidden;
    white-space: nowrap;
    font-size: var(--fs-micro);
  }
  .seg.frogfs {
    background: var(--mario-red);
    color: #fff;
  }
  .seg.littlefs {
    background: var(--zelda-green);
    color: #fff;
  }
  .seg.reserved {
    background: var(--hairline);
    color: var(--ink-soft);
  }
  .seg.free {
    background: var(--surface-sunk);
    color: var(--ink-soft);
  }
  .legend {
    display: flex;
    justify-content: space-between;
    font-size: var(--fs-micro);
    color: var(--ink-soft);
  }
  .dbglink {
    font: inherit;
    font-size: var(--fs-micro);
    background: none;
    border: none;
    color: var(--ink-soft);
    text-decoration: underline;
    cursor: pointer;
    padding: 0;
  }
  .dbgout {
    margin: 0.4rem 0 0;
    background: var(--surface-sunk);
    padding: 0.55rem 0.7rem;
    font-size: var(--fs-micro);
    white-space: pre-wrap;
    word-break: break-all;
  }
  /* Device-layout geometry aid (moved here from the top status). */
  .devgeo {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }
  .devgeo.dim {
    opacity: 0.45;
  }
  .devgeo-title {
    font-size: var(--fs-micro);
    color: var(--ink-soft);
    font-weight: 600;
  }
  .devclass {
    font-size: var(--fs-caption);
    font-weight: 600;
    color: var(--ink);
  }
  .devclass.unknown,
  .devclass.locked {
    color: var(--caution);
  }
  .scanning {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: var(--fs-micro);
    color: var(--ink-soft);
  }
  .track {
    flex: 1;
    height: 0.5rem;
    background: var(--surface-sunk);
    border-radius: 3px;
    overflow: hidden;
  }
  .fill {
    height: 100%;
    background: var(--model-accent);
    transition: width 120ms ease;
  }
  .scanerr {
    font-size: var(--fs-micro);
    color: #b03030;
  }
</style>
