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
  import Badge from "../ui/Badge.svelte";
  import { installProgress, type PhaseDef, type PhaseReporter } from "../installProgress.svelte.js";
  import { locale } from "../i18n/locale.svelte.js";

  // Official Firmware — a staged, progressive-disclosure flow:
  //   1. Firmware Backup  — pick a folder; validate existing backups or take a fresh one.
  //   2. Patch            — appears once a valid stock backup is selected (one button + bootloader).
  //   3. Patch & flash    — shared install-progress-modal-gated, multi-transfer progress (internal + external).
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

  // Patch firmware needs Recovery Mode: (1) a deep scan to find existing OFW assets, and
  // (2) it's itself a write op. Two-click affordance on one button: first click enters Recovery
  // Mode (+ runs the deep scan), second click (once device.utilLoaded) performs the patch.
  let enteringRecovery = $state(false);
  let recoveryErr = $state<string | null>(null);
  async function enterRecoveryAndScan(): Promise<void> {
    recoveryErr = null;
    enteringRecovery = true;
    try {
      await device.ensureStub();
      await device.runScan();
    } catch (e) {
      if (!(e instanceof Error && e.message.includes("cancelled"))) {
        recoveryErr = e instanceof Error ? e.message : String(e);
      }
    } finally {
      enteringRecovery = false;
    }
  }

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
          throw new Error(locale.t.officialFirmware.errDeviceLocked);
        }
        await flasher.unlock(); // NOTE: flasher.unlock() is notImplemented — surfaces a clear error for now.
      }
      let extSize = device.extFlashBytes;
      const actualModel = device.deviceClass?.model ?? device.model;
      if (actualModel === "mario") extSize = 1048576; // 1 MB
      else if (actualModel === "zelda") extSize = 4194304; // 4 MB

      const dumps = await dumpBackup(flasher, extSize, (d, t, label) => {
        backupDone = d;
        backupTotal = t;
        backupLabel = label;
      });
      const det = await detectDevice(dumps.internal, dumps.external);
      if (!det.model || !det.internalOk) {
        throw new Error(locale.t.officialFirmware.errFirmwareMismatch);
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

  // Phase shape mirrors Wizard.svelte's already-migrated step1 (Backup & Patch): patch, then
  // the two flash sub-phases patchAndFlash reports via its own progressReport(sub.label), then
  // a rescan. This flow's backup is already selected (step 1 above), so there's no
  // locate-backup/read-device phase here.
  const patchPhases: PhaseDef[] = [
    { id: "patch", label: locale.t.officialFirmware.phasePatch },
    { id: "flash-internal", label: locale.t.officialFirmware.phaseFlashInternal },
    { id: "flash-external", label: locale.t.officialFirmware.phaseFlashExternal },
    { id: "rescan", label: locale.t.officialFirmware.phaseRescan },
  ];

  async function run(report: PhaseReporter): Promise<void> {
    const sel = selected!;
    report.start("patch");
    report.log("patch", locale.t.officialFirmware.logPatchingModel(sel.model));
    let flashInternalStarted = false;
    let flashExternalStarted = false;
    device.suspendPoll();
    try {
      await patchAndFlash(
        (force) => device.ensureStub(undefined, force, true),
        sel.model,
        sel.internal,
        sel.external,
        { bootloader },
        (d, t, sub) => {
          // "bootloader → bank 1" shares the internal phase — both write bank 1.
          if (sub?.label.endsWith("bank 1")) {
            if (!flashInternalStarted) {
              flashInternalStarted = true;
              report.finish("patch");
              report.start("flash-internal");
            }
            report.progress("flash-internal", sub.value, sub.max);
          } else if (sub?.label === "external → bank 0") {
            if (!flashExternalStarted) {
              flashExternalStarted = true;
              if (flashInternalStarted) report.finish("flash-internal");
              report.start("flash-external");
            }
            report.progress("flash-external", sub.value, sub.max);
          }
        },
        undefined,
        device.extFlashBytes,
      );
    } finally {
      device.resumePoll();
    }
    if (flashInternalStarted) report.finish("flash-internal");
    if (flashExternalStarted) report.finish("flash-external");

    report.start("rescan");
    report.log("rescan", "Rescanning device geometry…");
    await device.runScan();
    report.finish("rescan");
  }

  const modalBody = $derived.by(() => {
    if (!selected) return "";
    const base = locale.t.officialFirmware.modalBodyBase(modelLabel(selected.model), bootloader);
    return dangerous ? locale.t.officialFirmware.modalBodyDangerPrefix(base) : base;
  });

  function openPatch() {
    patchErr = null;
    patched = false;
    void installProgress.run({
      title: locale.t.officialFirmware.modalTitle,
      body: modalBody,
      danger: true,
      confirmText: locale.t.officialFirmware.modalConfirmText,
      phases: patchPhases,
      exec: async (report) => {
        try {
          await run(report);
          patched = true;
          void device.runScan();
        } catch (e) {
          patchErr = e instanceof Error ? e.message : String(e);
          throw e;
        }
      },
    });
  }
</script>

<div class="ofw">
  <!-- Step 1 — Firmware Backup -->
  <section class="step">
    <h4 class="steph"><Badge>1</Badge> {locale.t.officialFirmware.step1Title}</h4>
    {#if !supported}
      <p class="notice">{locale.t.officialFirmware.chromiumRequired}</p>
    {/if}
    <p class="muted">{locale.t.officialFirmware.pickFolderIntro}</p>
    <p class="muted">
      {locale.t.officialFirmware.pickFolderLookForPre}
      <span class="mono">{locale.t.officialFirmware.internalBackupFilename}</span> + <span class="mono">{locale.t.officialFirmware.externalBackupFilename}</span>
      {locale.t.officialFirmware.pickFolderBodyPost}
    </p>
    <div class="pickrow">
      <Button variant="default" disabled={!supported || backupBusy} onclick={doPickFolder}>
        {dir ? locale.t.officialFirmware.chooseDifferentFolder : locale.t.officialFirmware.chooseBackupFolder}
      </Button>
      {#if !dir && pendingDir}
        <Button variant="quiet" disabled={backupBusy} onclick={reconnectFolder}>
          {locale.t.officialFirmware.reconnectLastFolder}
        </Button>
      {/if}
    </div>

    {#if pickErr}<p class="notice warn">{pickErr}</p>{/if}

    {#if dir}
      {#if scanResults.length > 0}
        <!-- A folder may hold both Mario and Zelda backups — pick one. -->
        <fieldset class="picklist">
          <legend>{locale.t.officialFirmware.backupsFoundLegend(scanResults.length > 1)}</legend>
          {#each scanResults as fb (fb.model)}
            <label class="pick">
              <input type="radio" name="ofw-backup" value={fb.model} bind:group={chosenModel} />
              <span class="pmodel">{modelLabel(fb.model)}</span>
              {#if fb.internalOk && fb.externalOk}
                <span class="chip ok-chip">{locale.t.officialFirmware.validChip}</span>
              {:else}
                <span class="chip bad-chip">
                  {locale.t.officialFirmware.invalidChip(fb.internalOk, fb.externalOk)}
                </span>
              {/if}
            </label>
          {/each}
        </fieldset>
      {/if}

      {#if backupValid && chosen}
        <p class="ok">
          {locale.t.officialFirmware.validBackupSelected(modelLabel(chosen.model))}
        </p>
      {:else if chosen && !backupValid}
        <p class="notice warn">
          {locale.t.officialFirmware.backupFailedValidation(modelLabel(chosen.model), chosen.internalOk, chosen.externalOk)}
        </p>
      {:else if noBackup}
        <p class="muted">{locale.t.officialFirmware.noBackupYet}</p>
      {/if}

      <!-- Fresh backup from the device (needs the RAM util). -->
      {#if offerBackup}
        {#if alreadyPatched}
          <p class="notice">
            {locale.t.officialFirmware.alreadyPatchedNoticePre} <strong>{locale.t.officialFirmware.alreadyPatchedNoticeBold}</strong>
            {locale.t.officialFirmware.alreadyPatchedNoticePost} <strong>{locale.t.officialFirmware.alreadyPatchedNoticeDifferentBold}</strong>
            {locale.t.officialFirmware.alreadyPatchedNoticeEnd}
          </p>
        {:else}
          {#if device.locked}
            <label class="check">
              <input type="checkbox" bind:checked={unlockOptIn} disabled={backupBusy} />
              {locale.t.officialFirmware.unlockDeviceLabel} <em>{locale.t.officialFirmware.unlockDeviceHint}</em>
            </label>
          {/if}
          <div>
            <Button
              variant="default"
              disabled={!device.isConnected || backupBusy || (device.locked === true && !unlockOptIn)}
              onclick={doBackup}
            >
              {backupBusy ? locale.t.officialFirmware.backingUp : locale.t.officialFirmware.backUpNow}
            </Button>
            {#if !device.isConnected}
              <span class="hint">{locale.t.officialFirmware.connectToBackUp}</span>
            {:else if device.locked === true && !unlockOptIn}
              <span class="hint">{locale.t.officialFirmware.optInToUnlock}</span>
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
      <h4 class="steph"><Badge>2</Badge> {locale.t.officialFirmware.step2Title}</h4>
      <p class="muted">
        {locale.t.officialFirmware.step2Body(modelLabel(selected.model))}
      </p>
      <label class="check">
        <input type="checkbox" bind:checked={bootloader} />
        {locale.t.officialFirmware.installBootloaderLabel} <em>{locale.t.officialFirmware.installBootloaderHint}</em>
      </label>

      {#if dangerous}
        <div class="danger">
          <p>
            <strong>{locale.t.officialFirmware.crossModelDangerBold}</strong> {locale.t.officialFirmware.crossModelDangerBody}
          </p>
          <label class="check">
            <input type="checkbox" bind:checked={ackCrossModel} />
            {locale.t.officialFirmware.crossModelAck}
          </label>
        </div>
      {:else if crossModel}
        <p class="muted">
          {locale.t.officialFirmware.crossModelAllowedNote(modelLabel(selected.model), modelLabel(device.model))}
        </p>
      {/if}

      {#if tooBig}
        <p class="notice warn">
          {locale.t.officialFirmware.tooBigNotice(modelLabel(selected.model), MiB(selected.external.length), MiB(device.extFlashBytes))}
        </p>
      {/if}

      <div>
        {#if !device.utilLoaded}
          <Button variant="action" disabled={!device.isConnected || enteringRecovery} onclick={enterRecoveryAndScan}>
            {enteringRecovery ? locale.t.officialFirmware.enteringRecoveryMode : locale.t.officialFirmware.enterRecoveryMode}
          </Button>
        {:else}
          <Button variant="action" disabled={!canPatch} onclick={openPatch}>
            {locale.t.officialFirmware.patchFirmwareButton}
          </Button>
        {/if}
        {#if !device.isConnected}<span class="hint">{locale.t.officialFirmware.connectToPatchAndFlash}</span>{/if}
      </div>
      {#if recoveryErr}<p class="notice warn">{recoveryErr}</p>{/if}
      {#if patched}<p class="ok">{locale.t.officialFirmware.patchedAndFlashed}</p>{/if}
      {#if patchErr}<p class="notice warn">{patchErr}</p>{/if}
    </section>
  {/if}
</div>

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
