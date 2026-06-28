<script lang="ts">
  import { device, modelLabel } from "../device.svelte.js";
  import {
    pickBackupFolder,
    scanBackupFolder,
    defaultBackup,
    dumpBackup,
    writeBackup,
    detectDevice,
    patchAndFlash,
    backupPickerSupported,
    type BackupDir,
    type FoundBackup,
    type OfwModel,
  } from "../engine/ofw.js";
  import { loadSel, saveSel, saveDir, loadDir, handlePermission } from "../persist.js";
  import Button from "../ui/Button.svelte";
  import ConfirmModal from "../ui/ConfirmModal.svelte";

  // Official Firmware — a staged, progressive-disclosure flow:
  //   1. Firmware Backup  — pick a folder; validate existing backups or take a fresh one.
  //   2. Patch            — appears once a valid stock backup is selected (one button + bootloader).
  //   3. Patch & flash    — ConfirmModal-gated, multi-transfer progress (internal + external).
  // A device is needed for a fresh backup + the flash; an existing valid backup unlocks step 2
  // without one. The patch model comes from the BACKUP (not the scanned hardware) — with a guard
  // for the dangerous Zelda-firmware-onto-Mario-hardware case (Mario hardware lacks two buttons).

  const supported = backupPickerSupported();

  // An already-patched (Retro-Go dual-boot) device has no STOCK firmware left to dump, so a fresh
  // "Back up now" is meaningless here. But patching from an EXISTING backup is still valid — that's
  // how you install a *different* official firmware (e.g. Mario↔Zelda) onto a patched device. So we
  // only suppress the fresh-dump path, not the folder-pick / select-backup / patch flow.
  const alreadyPatched = $derived(
    device.deviceClass 
      ? device.deviceClass.ofw 
        ? device.deviceClass.ofw.patched 
        : device.deviceClass.kind !== "locked" 
      : false
  );

  let dir = $state<BackupDir | null>(null);
  let pendingDir = $state<BackupDir | null>(null); // a remembered folder awaiting a permission re-grant
  let triedRestore = $state(false);
  let scanResults = $state<FoundBackup[]>([]); // every backup pair found in the folder (mario and/or zelda)
  let chosenModel = $state<OfwModel | null>(null); // the user's single-selection (radio list)
  let noBackup = $state(false); // folder scanned, no usable pair present
  let pickErr = $state<string | null>(null);

  // The chosen backup, and the patch payload derived from it (only when hash-valid).
  const chosen = $derived(scanResults.find((f) => f.model === chosenModel) ?? null);
  const selected = $derived(
    chosen && chosen.internalOk && chosen.externalOk
      ? { model: chosen.model, internal: chosen.internal, external: chosen.external }
      : null,
  );

  let unlockOptIn = $state(false);
  let backupBusy = $state(false);
  let backupDone = $state(0);
  let backupTotal = $state(0);
  let backupLabel = $state("");
  let backupErr = $state<string | null>(null);

  let bootloader = $state(loadSel("ofwBootloader", true));
  $effect(() => saveSel("ofwBootloader", bootloader));
  let ackCrossModel = $state(false);
  let modalOpen = $state(false);
  let patchErr = $state<string | null>(null);
  let patched = $state(false);

  // Step 2 unlocks only on a genuine, hash-valid stock backup (the chosen one).
  const backupValid = $derived(!!selected);
  // Offer a fresh backup unless we already hold a valid backup for the CONNECTED hardware
  // (a Mario device with only a Zelda backup on disk should still be able to back up Mario).
  const offerBackup = $derived(
    device.model !== "unknown"
      ? !scanResults.some((f) => f.model === device.model && f.internalOk && f.externalOk)
      : !backupValid,
  );
  // Cross-model: the backup's firmware vs the scanned hardware. Zelda firmware on Mario
  // hardware is dangerous (missing buttons); Mario firmware on Zelda hardware is fine.
  const crossModel = $derived(
    !!selected && device.model !== "unknown" && device.model !== selected.model,
  );
  const dangerous = $derived(crossModel && device.model === "mario" && selected?.model === "zelda");
  // Hard capacity guard (not overridable): the external image must fit the device's flash chip.
  // We predict from the stock external backup (the patched external is ≤ it). Only enforced once
  // the chip size is known from the scan.
  const tooBig = $derived(
    !!selected && device.extFlashBytes > 0 && !device.fitsExtFlash(selected.external.length),
  );
  const canPatch = $derived(
    !!selected && device.isConnected && !tooBig && (!dangerous || ackCrossModel),
  );

  const MiB = (n: number): string => (n / 1048576).toFixed(2);

  async function doPickFolder(): Promise<void> {
    pickErr = null;
    backupErr = null;
    try {
      const d = await pickBackupFolder();
      if (!d) return; // cancelled
      dir = d;
      pendingDir = null;
      void saveDir("ofwBackupDir", d);
      patched = false;
      await rescan();
    } catch (e) {
      pickErr = e instanceof Error ? e.message : String(e);
    }
  }

  // On mount, try to silently re-adopt the last-used backup folder (no prompt). If it needs a
  // permission re-grant, stash it so the UI offers a "Reconnect last folder" button.
  $effect(() => {
    if (triedRestore) return;
    triedRestore = true;
    void restoreLastFolder();
  });

  async function restoreLastFolder(): Promise<void> {
    const handle = (await loadDir("ofwBackupDir")) as BackupDir | null;
    if (!handle || dir) return;
    if (await handlePermission(handle, "readwrite", false)) {
      dir = handle;
      await rescan();
    } else {
      pendingDir = handle;
    }
  }

  async function reconnectFolder(): Promise<void> {
    const handle = pendingDir;
    if (!handle) return;
    if (await handlePermission(handle, "readwrite", true)) {
      pendingDir = null;
      dir = handle;
      await rescan();
    }
  }

  // (Re)scan the selected folder for every existing backup pair; default-select one.
  async function rescan(): Promise<void> {
    if (!dir) return;
    const found = await scanBackupFolder(dir);
    scanResults = found;
    noBackup = found.length === 0;
    chosenModel = defaultBackup(found, device.model)?.model ?? null;
  }

  async function doBackup(): Promise<void> {
    if (!dir) return;
    backupErr = null;
    backupBusy = true;
    backupDone = 0;
    backupTotal = 0;
    try {
      const flasher = await device.ensureStub();
      if (device.locked) {
        if (!unlockOptIn) {
          throw new Error('Device is locked (RDP read-protection). Check "Unlock device" to remove it before backing up.');
        }
        await flasher.unlock(); // NOTE: flasher.unlock() is notImplemented — surfaces a clear error for now.
      }
      const extSize = device.info?.externalFlashSizeBytes ?? 0;
      if (!extSize) throw new Error("External flash size is unknown — reconnect and try again.");
      const dumps = await dumpBackup(flasher, extSize, (d, t, label) => {
        backupDone = d;
        backupTotal = t;
        backupLabel = label;
      });
      const det = await detectDevice(dumps.internal, dumps.external);
      if (!det.model || !det.internalOk) {
        throw new Error("The dumped firmware doesn't match a known stock Mario/Zelda ROM — backup not saved.");
      }
      dir = await writeBackup(dir, det.model, dumps);
      const fb: FoundBackup = {
        model: det.model,
        internal: dumps.internal,
        external: dumps.external,
        internalOk: det.internalOk,
        externalOk: det.externalOk,
      };
      // Replace any prior entry for this model, then select it.
      scanResults = [...scanResults.filter((f) => f.model !== det.model), fb];
      noBackup = false;
      chosenModel = det.model;
    } catch (e) {
      backupErr = e instanceof Error ? e.message : String(e);
    } finally {
      backupBusy = false;
    }
  }

  // ConfirmModal run: patch the selected backup, then flash internal → bank 1 + external → bank 0.
  async function run(
    report: (d: number, t: number, sub?: { value: number; max: number; label: string }) => void,
  ): Promise<void> {
    const sel = selected!;
    const flasher = await device.ensureStub();
    await patchAndFlash(flasher, sel.model, sel.internal, sel.external, { bootloader }, report, device.extFlashBytes);
  }

  const modalBody = $derived.by(() => {
    if (!selected) return "";
    const base =
      `Patches the ${modelLabel(selected.model)} stock firmware${bootloader ? " (with the SD-card bootloader)" : ""} ` +
      `and flashes it: internal → bank 1, external → bank 0. ` +
      `Do not move or unplug the device during the write — it can fail the flash.`;
    return dangerous
      ? `⚠ You are flashing ZELDA firmware onto MARIO hardware, which lacks two of the buttons Zelda needs. ${base}`
      : base;
  });
</script>

<div class="ofw">
  <!-- Step 1 — Firmware Backup -->
  <section class="step">
    <h4 class="steph"><span class="num">1</span> Firmware Backup</h4>
    {#if !supported}
      <p class="notice">Folder selection needs a Chromium browser (same as WebUSB).</p>
    {/if}
    <p class="muted">
      Pick a folder holding your stock backups, or an empty folder to back up into. We look for
      <span class="mono">internal_flash_backup_*.bin</span> + <span class="mono">flash_backup_*.bin</span>
      and validate them by hash.
    </p>
    <div class="pickrow">
      <Button variant="default" disabled={!supported || backupBusy} onclick={doPickFolder}>
        {dir ? "Choose a different folder" : "Choose backup folder"}
      </Button>
      {#if !dir && pendingDir}
        <Button variant="quiet" disabled={backupBusy} onclick={reconnectFolder}>
          Reconnect last folder
        </Button>
      {/if}
    </div>

    {#if pickErr}<p class="notice warn">{pickErr}</p>{/if}

    {#if dir}
      {#if scanResults.length > 0}
        <!-- A folder may hold both Mario and Zelda backups — pick one. -->
        <fieldset class="picklist">
          <legend>Stock backup{scanResults.length > 1 ? "s" : ""} found in this folder</legend>
          {#each scanResults as fb (fb.model)}
            <label class="pick">
              <input type="radio" name="ofw-backup" value={fb.model} bind:group={chosenModel} />
              <span class="pmodel">{modelLabel(fb.model)}</span>
              {#if fb.internalOk && fb.externalOk}
                <span class="chip ok-chip">✓ valid</span>
              {:else}
                <span class="chip bad-chip">
                  ✗ invalid (int {fb.internalOk ? "✓" : "✗"} · ext {fb.externalOk ? "✓" : "✗"})
                </span>
              {/if}
            </label>
          {/each}
        </fieldset>
      {/if}

      {#if backupValid && chosen}
        <p class="ok">
          ✓ Valid {modelLabel(chosen.model)} stock backup selected (internal + external hashes match).
        </p>
      {:else if chosen && !backupValid}
        <p class="notice warn">
          The {modelLabel(chosen.model)} backup failed validation
          (internal {chosen.internalOk ? "✓" : "✗"} · external {chosen.externalOk ? "✓" : "✗"}).
          Take a fresh backup below.
        </p>
      {:else if noBackup}
        <p class="muted">No stock backup in this folder yet — back one up from the connected device.</p>
      {/if}

      <!-- Fresh backup from the device (needs the RAM util). -->
      {#if offerBackup}
        {#if alreadyPatched}
          <p class="notice">
            This device is already running <strong>patched Retro-Go</strong> firmware, so there's no
            stock firmware on it to back up. To install a <strong>different</strong> official firmware
            (e.g. Mario ↔ Zelda), choose a folder above that holds a Mario or Zelda stock backup, then
            patch it below.
          </p>
        {:else}
          {#if device.locked}
            <label class="check">
              <input type="checkbox" bind:checked={unlockOptIn} disabled={backupBusy} />
              Unlock device <em>(removes RDP read-protection — required to read a locked device)</em>
            </label>
          {/if}
          <div>
            <Button
              variant="default"
              disabled={!device.isConnected || backupBusy || (device.locked === true && !unlockOptIn)}
              onclick={doBackup}
            >
              {backupBusy ? "Backing up…" : "Back up now"}
            </Button>
            {#if !device.isConnected}
              <span class="hint">Connect a device to back up.</span>
            {:else if device.locked === true && !unlockOptIn}
              <span class="hint">Opt in to unlock to back up a locked device.</span>
            {/if}
          </div>
          {#if backupBusy}
            <div class="prog">
              <div class="track"><div class="fill" style="width:{backupTotal ? Math.round((backupDone / backupTotal) * 100) : 0}%"></div></div>
              <span class="mono">{backupLabel} — {MiB(backupDone)} / {MiB(backupTotal)} MiB</span>
            </div>
          {/if}
          {#if backupErr}<p class="notice warn">{backupErr}</p>{/if}
        {/if}
      {/if}
    {/if}
  </section>

  <!-- Step 2 — Patch (only once a valid stock backup is selected) -->
  {#if selected}
    <section class="step">
      <h4 class="steph"><span class="num">2</span> Patch firmware</h4>
      <p class="muted">
        Patches the {modelLabel(selected.model)} stock firmware into a Retro-Go dual-boot.
        One-size-fits-all — no extra options.
      </p>
      <label class="check">
        <input type="checkbox" bind:checked={bootloader} />
        Install bootloader <em>(recommended)</em>
      </label>

      {#if dangerous}
        <div class="danger">
          <p>
            <strong>⚠ Cross-model:</strong> this is <strong>Zelda</strong> firmware, but the connected
            hardware scanned as <strong>Mario</strong>. Mario hardware lacks two of the buttons Zelda
            needs — the result may be partly unusable.
          </p>
          <label class="check">
            <input type="checkbox" bind:checked={ackCrossModel} />
            I understand and want to flash Zelda firmware onto Mario hardware anyway
          </label>
        </div>
      {:else if crossModel}
        <p class="muted">
          Note: backup is {modelLabel(selected.model)} firmware on {modelLabel(device.model)} hardware
          — allowed.
        </p>
      {/if}

      {#if tooBig}
        <p class="notice warn">
          ⛔ This {modelLabel(selected.model)} backup's external image
          ({MiB(selected.external.length)} MB) is larger than this device's external flash
          ({MiB(device.extFlashBytes)} MB) — it physically won't fit and can't be flashed here.
        </p>
      {/if}

      <div>
        <Button variant="action" disabled={!canPatch} onclick={() => (modalOpen = true)}>
          Patch firmware
        </Button>
        {#if !device.isConnected}<span class="hint">Connect a device to patch + flash.</span>{/if}
      </div>
      {#if patched}<p class="ok">✓ Patched + flashed.</p>{/if}
      {#if patchErr}<p class="notice warn">{patchErr}</p>{/if}
    </section>
  {/if}
</div>

<ConfirmModal
  open={modalOpen}
  title="Patch + flash official firmware?"
  body={modalBody}
  danger
  confirmText="Patch & flash"
  run={async (report) => {
    patchErr = null;
    patched = false;
    try {
      await run(report);
      patched = true;
      void device.runScan();
    } catch (e) {
      patchErr = e instanceof Error ? e.message : String(e);
      throw e;
    }
  }}
  onClose={() => (modalOpen = false)}
/>

<style>
  .ofw {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }
  .step {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
  }
  .pickrow {
    display: flex;
    gap: 0.5rem;
    flex-wrap: wrap;
  }
  .steph {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin: 0;
    font-size: var(--fs-caption);
    font-weight: 600;
    color: var(--ink);
  }
  .num {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1.3rem;
    height: 1.3rem;
    border-radius: 50%;
    background: var(--model-accent);
    color: #fff;
    font-size: var(--fs-micro);
  }
  .muted {
    margin: 0;
    font-size: var(--fs-caption);
    color: var(--ink-soft);
  }
  .mono {
    font-family: var(--font-mono);
  }
  .ok {
    margin: 0;
    font-size: var(--fs-caption);
    color: var(--zelda-green);
    font-weight: 600;
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
  .check {
    display: flex;
    align-items: baseline;
    gap: 0.45rem;
    font-size: var(--fs-caption);
    color: var(--ink);
  }
  .check em {
    color: var(--ink-soft);
    font-style: normal;
    font-size: var(--fs-micro);
  }
  .hint {
    margin-left: 0.5rem;
    font-size: var(--fs-micro);
    color: var(--ink-soft);
  }
  .picklist {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
    border: 1px solid var(--rule);
    border-radius: var(--r-control);
    padding: 0.5rem 0.75rem 0.6rem;
    margin: 0.5rem 0;
  }
  .picklist legend {
    font-size: var(--fs-micro);
    color: var(--ink-soft);
    padding: 0 0.35rem;
  }
  .pick {
    display: flex;
    align-items: baseline;
    gap: 0.45rem;
    font-size: var(--fs-caption);
    color: var(--ink);
  }
  .pmodel {
    font-weight: 600;
  }
  .chip {
    font-size: var(--fs-micro);
  }
  .ok-chip {
    color: var(--ok, #2e7d32);
  }
  .bad-chip {
    color: var(--caution);
  }
  .danger {
    border: 1px solid var(--caution);
    border-radius: var(--r-control);
    padding: 0.6rem 0.7rem;
    background: var(--surface-sunk);
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  .danger p {
    margin: 0;
    font-size: var(--fs-caption);
    color: var(--ink);
  }
  .prog {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
    font-size: var(--fs-micro);
    color: var(--ink-soft);
  }
  .track {
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
</style>
