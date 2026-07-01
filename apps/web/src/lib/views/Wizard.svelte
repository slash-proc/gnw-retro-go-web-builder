<script lang="ts">
  import { device, modelLabel } from "../device.svelte.js";
  import Button from "../ui/Button.svelte";
  import ConfirmModal from "../ui/ConfirmModal.svelte";

  import { 
    pickBackupFolder, dumpBackup, writeBackup, patchAndFlash, detectDevice,
    scanBackupFolder, defaultBackup
  } from "../engine/ofw.js";
  import { buildFlashInstall, flashInstallToDevice } from "../engine/flashInstall.js";
  import { listVersions, fetchBundle } from "../artifacts.js";
  import { dbg as dbgLog } from "../debug.js";

  let { onComplete }: { onComplete?: () => void } = $props();

  const MiB = (n: number) => (n / 1048576).toFixed(2);

  const hasAssets = $derived(
    device.partitions.some(p => p.type.includes("Assets") || p.type.includes("OFW"))
  );

  const isPatched = $derived.by(() => {
    if (!device.deviceClass) return false;
    if (device.deviceClass.ofw) {
      if (device.deviceClass.ofw.patched) {
        return hasAssets;
      }
      return false;
    }
    return device.deviceClass.kind !== "locked";
  });

  const isInstalled = $derived(
    device.deviceClass 
      ? device.deviceClass.kind === "retrogo-sd" || device.deviceClass.kind === "retrogo-old" 
      : false
  );

  const isBroken = $derived(
    device.deviceClass?.ofw?.patched === true && !hasAssets
  );

  // Step 1: Backup & Patch
  let step1Active = $derived(!isPatched);
  let step1Done = $derived(isPatched);
  let step1Busy = $state(false);
  let step1Progress = $state("");
  let step1Err = $state<string | null>(null);
  let step1Modal = $state(false);

  async function runStep1() {
    step1Err = null;
    step1Busy = true;
    try {
      const dir = await pickBackupFolder();
      if (!dir) return;

      const found = await scanBackupFolder(dir);
      const chosen = defaultBackup(found, device.model);
      
      const flasher = await device.ensureStub();
      let targetModel = chosen?.model;
      let targetInt: Uint8Array;
      let targetExt: Uint8Array;

      if (chosen && chosen.internalOk && chosen.externalOk) {
        targetInt = chosen.internal;
        targetExt = chosen.external;
        step1Progress = "Valid backup found. Patching & Flashing...";
      } else {
        if (isBroken) {
          throw new Error("Device assets are missing. You MUST select the folder containing your previous valid backup to repair it.");
        }
        
        let extSize = device.extFlashBytes;
        const actualModel = device.deviceClass?.model ?? device.model;
        if (actualModel === "mario") extSize = 1048576;
        else if (actualModel === "zelda") extSize = 4194304;

        step1Progress = "Backing up...";
        const dumps = await withTimeout(
          (report) => dumpBackup(flasher, extSize, report),
          30000,
          (d, t, label) => {
            step1Progress = `Backing up: ${MiB(d)} / ${MiB(t)} MB`;
          }
        );

        const det = await detectDevice(dumps.internal, dumps.external);
        if (!det.model || !det.internalOk) {
          throw new Error("Dumped firmware doesn't match a known stock ROM.");
        }
        
        step1Progress = "Saving backup...";
        await writeBackup(dir, det.model, dumps);
        
        targetModel = det.model;
        targetInt = dumps.internal;
        targetExt = dumps.external;
        step1Progress = "Patching & Flashing...";
      }

      await withTimeout(
        (report) => patchAndFlash(
          (force) => device.ensureStub(undefined, force), targetModel!, targetInt, targetExt, 
          { bootloader: true }, 
          report as any,
          device.extFlashBytes
        ),
        30000,
        (d, t, sub) => {
          const pct = t ? Math.min(100, Math.round((d / t) * 100)) : 0;
          step1Progress = `Patching: ${pct}%`;
        }
      );
      
      await device.runScan();
    } catch (e) {
      step1Err = e instanceof Error ? e.message : String(e);
    } finally {
      step1Busy = false;
    }
  }

  function withTimeout<T>(
    runFn: (report: (...args: any[]) => void) => Promise<T>,
    timeoutMs: number,
    onProgressUpdate: (...args: any[]) => void
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      let timeoutId: ReturnType<typeof setTimeout>;
      const resetTimeout = () => {
        if (timeoutId) clearTimeout(timeoutId);
        timeoutId = setTimeout(() => {
          reject(new Error("Operation timed out (device may have hung). Please restart the device and try again."));
        }, timeoutMs);
      };

      resetTimeout();
      
      const wrappedReport = (...args: any[]) => {
        resetTimeout();
        onProgressUpdate(...args);
      };
      
      runFn(wrappedReport).then(
        (val) => {
          clearTimeout(timeoutId);
          resolve(val);
        },
        (err) => {
          clearTimeout(timeoutId);
          reject(err);
        }
      );
    });
  }

  // Step 2: Install Retro-Go
  let step2Active = $derived(isPatched && !isInstalled);
  let step2Done = $derived(isInstalled);
  let step2Busy = $state(false);
  let step2Progress = $state("");
  let step2Err = $state<string | null>(null);
  let step2Modal = $state(false);

  async function runStep2(report: any = undefined) {
    step2Err = null;
    step2Busy = true;
    try {
      step2Progress = "Fetching bundle...";
      if (report) report(0, 100, "Fetching bundle...");
      const versions = await listVersions();
      const bundle = await fetchBundle(versions[0].tag);
      
      step2Progress = "Preparing install...";
      if (report) report(0, 100, "Preparing install...");
      const blockSize = device.info?.minEraseSizeBytes ?? 4096;
      
      const frogfsPart = device.partitions.find((p) => p.fs === "frogfs");
      const reservedEnd = device.partitions
        .filter((p) => p.fs !== "littlefs" && p.fs !== "frogfs")
        .reduce((m, p) => Math.max(m, p.offset + p.size), 0);
      const reservedEndAligned = Math.ceil(reservedEnd / blockSize) * blockSize;
      const reservedOffset = frogfsPart && frogfsPart.offset % blockSize === 0 
        ? frogfsPart.offset 
        : reservedEndAligned;

      const install = await buildFlashInstall({
        bundle,
        bank: 2,
        extflashSize: device.extFlashBytes,
        blockSize,
        reservedOffset,
        userRoms: new Map(),
        littlefsLength: 8 * 1024 * 1024,
      });

      const flasher = await device.ensureStub();
      step2Progress = "Flashing Retro-Go...";
      if (report) report(0, 100, "Flashing Retro-Go...");
      const regions = ["intflash", "frogfs", "littlefs"] as const;
      
      await withTimeout(
        (progressReport) => flashInstallToDevice((force) => device.ensureStub(undefined, force), install, progressReport as any, dbgLog, regions),
        30000,
        (phase, d, t) => {
          const pct = t ? Math.min(100, Math.round((d / t) * 100)) : 0;
          step2Progress = `Flashing ${phase}: ${pct}%`;
          if (report) report(d, t, `Flashing ${phase}`);
        }
      );
      
      await device.runScan();
    } catch (e) {
      step2Err = e instanceof Error ? e.message : String(e);
      throw e;
    } finally {
      step2Busy = false;
    }
  }

  // Step 3: Install ROMs
  let step3Active = $derived(isInstalled);
</script>

<div class="wizard-container">
  <div class="wizard-step" class:active={step1Active} class:done={step1Done}>
    <div class="step-num">1</div>
    <div class="step-content">
      <h3>{isBroken ? "Patch" : "Backup & Patch"}</h3>
      <p>{isBroken ? "Your device is patched but the stock assets are missing. Select your backup folder to patch the device and restore its assets." : "Securely backup your stock firmware and unlock the device for custom firmware."}</p>
      {#if step1Done}
        <Button variant="default" disabled>✓ Patched</Button>
      {:else}
        <Button variant="action" disabled={!step1Active || step1Busy} onclick={() => step1Modal = true}>
          {step1Busy ? step1Progress : isBroken ? "Patch" : "Backup & Patch"}
        </Button>
      {/if}
      {#if step1Err}<p class="err">{step1Err}</p>{/if}
    </div>
  </div>

  <div class="wizard-step" class:active={step2Active} class:done={step2Done}>
    <div class="step-num">2</div>
    <div class="step-content">
      <h3>Install Retro-Go</h3>
      <p>Install the dual-boot Retro-Go system.</p>
      {#if step2Done}
        <Button variant="default" disabled>✓ Installed</Button>
      {:else}
        <Button variant="action" disabled={!step2Active || step2Busy} onclick={() => step2Modal = true}>
          {step2Busy ? step2Progress : "Install Retro-Go"}
        </Button>
      {/if}
      {#if step2Err}<p class="err">{step2Err}</p>{/if}
    </div>
  </div>

  <div class="wizard-step" class:active={step3Active}>
    <div class="step-num">3</div>
    <div class="step-content">
      <h3>Manage ROMs</h3>
      <p>Head over to the ROMs tab to install your games.</p>
      <Button variant="action" disabled={!step3Active} onclick={() => onComplete?.()}>Continue to Manage ROMs →</Button>
    </div>
  </div>
</div>

<ConfirmModal
  open={step1Modal}
  title={isBroken ? "Patch Device" : "Backup & Patch"}
  body={isBroken ? "This will select your backup folder and patch your device with its missing stock assets. Ensure your device has enough battery and do not unplug it!" : "You will be prompted to select a folder on your computer. This is an important folder where your device's original firmware backup will be safely stored. Do not lose these files! Once selected, the backup and patching will happen automatically."}
  confirmText={isBroken ? "Patch" : "Select Folder & Start"}
  run={async () => { step1Modal = false; await runStep1(); }}
  onClose={() => (step1Modal = false)}
/>

<ConfirmModal
  open={step2Modal}
  title="Install Retro-Go"
  body="WARNING: This will completely wipe all custom games, saves, and data from your device! Only the original stock firmware will be preserved. Proceed?"
  danger
  confirmText="Install"
  run={runStep2}
  onClose={() => step2Modal = false}
/>

<style>
  .wizard-container {
    display: flex;
    flex-direction: column;
    gap: 2rem;
    padding: 2.5rem 2rem;
    background: var(--surface);
    border-radius: var(--r-card);
    border: 1px solid var(--surface-sunk);
    max-width: 460px;
    margin: 4rem auto;
    box-shadow: 0 8px 30px rgba(0, 0, 0, 0.05);
  }
  .wizard-step {
    display: flex;
    gap: 1rem;
    opacity: 0.5;
    transition: opacity 0.2s;
  }
  .wizard-step.active, .wizard-step.done {
    opacity: 1;
  }
  .step-num {
    width: 2rem;
    height: 2rem;
    border-radius: 50%;
    background: var(--surface-sunk);
    color: var(--ink-soft);
    display: flex;
    align-items: center;
    justify-content: center;
    font-weight: bold;
    flex-shrink: 0;
  }
  .wizard-step.active .step-num {
    background: var(--model-accent);
    color: white;
  }
  .wizard-step.done .step-num {
    background: var(--zelda-green);
    color: white;
  }
  .step-content {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    align-items: flex-start;
  }
  .step-content h3 {
    margin: 0;
    font-size: 1.1rem;
    color: var(--ink);
  }
  .step-content p {
    margin: 0;
    font-size: 0.9rem;
    color: var(--ink-soft);
  }
  .err {
    color: var(--caution);
    font-size: 0.85rem;
    margin: 0;
  }
</style>
