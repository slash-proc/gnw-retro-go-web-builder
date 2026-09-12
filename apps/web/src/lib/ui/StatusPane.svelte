<script lang="ts">
  /**
   * Overview — Status. The approved board is
   * `docs/design/proposals/overview-v2/Status.dc.html`, with its needs-attention twin
   * `StatusAttention.dc.html`.
   *
   * WHERE IT LIVES. The board draws Status as the first item of an Overview rail
   * (CONSOLE: Status, Details / LOGS: Activity, Device log). That rail is a PROPOSAL and is
   * not built. Rather than half-build it, this is the first section of the Overview tab's
   * left column, in the place the old `Device` card held — the same call
   * `ui/ActivityPane.svelte` made for the rail's Activity item. When the rail lands, this
   * becomes its CONSOLE/Status item and nothing inside here moves.
   *
   * IT REPLACES THE `Device` CARD, it does not sit next to it. That card's three rows were
   * `Running`, `External flash` and `Read protection`; keeping it would have printed
   * Read protection twice on one page. Of the two rows that are not in the board,
   * `External flash` (the chip's size) is still shown, independently, in the External flash
   * panel's own headline further down this tab, and `Running` (is the RAM flash utility
   * loaded) is device chrome the header LED already carries — neither value is lost here.
   *
   * WHAT THE ROWS READ. Every one of them is existing store state; this pane performs no
   * device reads of its own.
   *   Layout            both banks' shapes, via `bankLayout` (ui/statusLayout.ts). The
   *                     board's small Bank 1 / Bank 2 grid is NOT redrawn here: the real
   *                     bank visualisation (BankCard) is the very next section on this page,
   *                     and a second, cruder copy of it two rows above would be noise.
   *   Debug probe       `device.probeName`
   *   Read protection   `device.locked`
   *   Firmware backup   `backupPresence` — the user's actual backup FOLDER, never a local
   *                     flag. WHICH CONSOLES ARE COVERED (`Zelda`, `Mario`, or both on one
   *                     line), `None`, or `Folder not connected`. Not a date: a date says when
   *                     someone did something, and the question this row answers is whether the
   *                     device in your hands can be put back. That is the Firmware tab's own
   *                     model (`OfficialFirmwareSection`'s `offerBackup`), reused rather than
   *                     re-invented. Never a verb: "Taken" was the exact word the review
   *                     rejected. See `backupPresence.svelte.ts` for why the flag it replaced
   *                     could not answer this. A LOCKED device is offered no `Back up now`: it
   *                     cannot be backed up at all, and unlocking to make it possible is what
   *                     destroys the thing being saved.
   *   Storage           `device.targetMedia` + `device.sdHandle`
   *   Installed firmware the Retro-Go bank's baked version string.
   *
   * The needs-attention state is NOT a different page. It is these same rows with different
   * values, an amber dot on the ones that want something, and a count under the title. There
   * is no promoted panel and no post-mortem of a failed write here.
   */
  import { untrack } from "svelte";
  import { device, modelLabel } from "../device.svelte.js";
  import { backupPresence } from "../backupPresence.svelte.js";
  import { locale } from "../i18n/locale.svelte.js";
  import { bankLayout } from "./statusLayout.js";
  import { listVersions, type FirmwareVersion } from "../artifacts.js";
  import { installTitleState } from "../firmwareDist/compare.js";

  const s = $derived(locale.t.overview.status);

  const layoutValue = $derived.by(() => {
    switch (bankLayout(device.banks)) {
      case "dual": return s.layoutDual;
      case "retrogo": return s.layoutRetroGo;
      case "stock": return s.layoutStock;
      default: return s.layoutOther;
    }
  });

  const probeValue = $derived(device.probeName ?? locale.t.overview.info.unknownValue);

  const lockValue = $derived(
    device.locked == null
      ? locale.t.overview.info.unknownValue
      : device.locked
        ? locale.t.overview.info.lockLocked
        : locale.t.overview.info.lockUnlocked,
  );

  // THE BACKUP ROW READS THE FOLDER, not `device.backupTaken`. That flag records only that this
  // app once finished a backup for this unit's UID: it says None to someone who has a good
  // folder from gnwmanager or an earlier install, and keeps claiming one exists after the files
  // are deleted. Automatic unlock now gates on a backup existing, so the second direction is
  // not a cosmetic error. `backupPresence.svelte.ts` carries the full reasoning.
  //
  // A folder we cannot see is `disconnected`, and it is NOT `None`: asserting "no backup" about
  // a folder nobody has looked in is the same lie in a different costume. Both want something
  // from the user, so both are amber and both carry an action, but they ask for different
  // things -- one for a backup, one for the folder.
  const backup = $derived(backupPresence.state);
  const backupMissing = $derived(backup.kind === "none" || backup.kind === "disconnected");
  const backupHits = $derived(backup.kind === "present" ? backup.hits : []);

  // IS THE DEVICE IN YOUR HANDS COVERED? Not "is there a backup somewhere". This is
  // `OfficialFirmwareSection`'s `offerBackup` rule, deliberately identical: a Mario device with
  // only a Zelda backup on disk is NOT covered and should still be offered a backup. With no
  // device scanned we cannot judge, so we do not: any pair counts.
  const backupCovered = $derived(
    device.model === "unknown"
      ? backupHits.length > 0
      : backupHits.some((h) => h.model === device.model),
  );
  // Backups exist, but none of them is for this hardware. A different fact from having none,
  // and the only one of the two that a folder full of files can be guilty of.
  const backupMismatch = $derived(backup.kind === "present" && !backupCovered);
  // Everything that wants the user to do something. Feeds the amber dot AND the count above,
  // which must not disagree: a row wearing amber under a headline saying nothing needs
  // attention is the exact defect this suite already caught once.
  const backupWants = $derived(backupMissing || backupMismatch);

  // Only the states that have no model list of their own. `present` renders per-model chips
  // instead, because "Zelda" and "Mario" are values that stand alone in the column and a
  // formatted date is not.
  const backupValue = $derived.by(() => {
    switch (backup.kind) {
      case "none":
        return s.backupNone;
      case "disconnected":
        return s.backupNotConnected;
      default:
        // Nothing has looked yet (or this browser cannot pick folders at all). The two rows
        // above already use this placeholder for a fact we do not have.
        return locale.t.overview.info.unknownValue;
    }
  });

  // Look once when the pane mounts. Silent: it re-adopts an already-granted folder and never
  // raises a permission prompt the user did not ask for.
  //
  // UNTRACKED, and it has to be. `refresh()` reads and writes the store's own state
  // synchronously before its first `await`, so a tracked effect would depend on the very state
  // the call sets and re-run itself forever, reprobing the folder in a tight loop. No gate in
  // this repo would catch that: every suite stubs runes as identity functions, so reactivity is
  // not reachable from a node test.
  $effect(() => {
    untrack(() => void backupPresence.refresh());
  });

  // A LOCKED DEVICE CANNOT BE BACKED UP AT ALL, so it must not be offered the button.
  // RDP 1 makes internal flash unreadable over SWD, which is why `OfficialFirmwareSection`
  // disables its own `Back up now` on `device.locked === true` and `doBackup` throws
  // `errDeviceLocked` before it starts. Routing someone there from here would land them on a
  // disabled control -- the same defect the beginner audit found on the unsupported-browser
  // card, which was clickable and led nowhere.
  //
  // Unlocking is NOT offered as the way out, and that is deliberate: clearing RDP mass-erases
  // both flashes, so on a device with no backup it is precisely the action that guarantees the
  // original firmware can never be saved (`engine/unlockGate.ts`). There is no action here that
  // helps, so there is no action. The value stays truthful and the Read protection row directly
  // above already reads `Locked`, which is where the reason lives.
  //
  // `Connect folder` is NOT suppressed: picking a folder is a filesystem action that has
  // nothing to do with the device, and a locked device's owner may well have a backup already.
  const canBackUp = $derived(device.locked !== true);

  async function connectBackupFolder(): Promise<void> {
    try {
      await backupPresence.connect();
    } catch {
      // The picker throwing (dismissed, or blocked) leaves the row exactly as it was, which is
      // already the truthful value. There is nothing to report that the row does not say.
    }
  }

  // "SD card" is only true once a card folder has actually been picked; an SD-mode device
  // with no handle has nowhere to write, which is a thing to fix, not a storage kind.
  const sdMissing = $derived(device.targetMedia === "sd" && !device.sdHandle);
  const storageValue = $derived(
    device.targetMedia === "sd" ? (device.sdHandle ? s.storageSdCard : s.storageNoCard) : s.storageInternal,
  );

  const rgBank = $derived(device.banks.find((b) => b.retroGoVersion));
  const firmwareValue = $derived(rgBank?.retroGoVersion ?? s.firmwareNone);

  // Same shared rule the guided Wizard and the Advanced rail answer this with, so the three
  // surfaces cannot disagree about reinstall-vs-upgrade. `listVersions()` is memoised, so
  // this is not a second fetch.
  let versions = $state<FirmwareVersion[]>([]);
  $effect(() => {
    listVersions().then((v) => { versions = v; }).catch(() => {});
  });
  const upgradeAvailable = $derived(
    installTitleState(rgBank?.retroGoVersion, versions[0]?.gitTag, versions.map((v) => v.gitTag)) === "upgrade",
  );

  const attention = $derived((backupWants ? 1 : 0) + (sdMissing ? 1 : 0));

  const go = (hash: string) => { location.hash = hash; };
</script>

<section class="sect status-sect">
  <!-- No section label: the rail already names this pane "Status", and repeating it here read
       as two headings before any content. -->
  {#if attention > 0}
    <p class="attention">{s.needAttention(attention)}</p>
  {/if}


  <dl class="rows">
    <div class="row">
      <dt><span class="dot"></span>{s.debugProbe}</dt>
      <dd>{probeValue}</dd>
    </div>
    <div class="row">
      <!-- No artboard draws a locked part in a warning colour; unlocked is the success ink. -->
      <dt><span class="dot"></span>{locale.t.overview.info.readProtection}</dt>
      <dd class:ok={device.locked === false}>{lockValue}</dd>
    </div>
    <div class="row">
      <dt><span class="dot" class:warn={backupWants}></span>{s.firmwareBackup}</dt>
      <dd>
        {#if backup.kind === "present"}
          <!-- One chip per model found, on one line. Green tick when this hardware is covered;
               a caution mark when every backup on disk is for the other console, which is a
               folder that looks full and protects nothing. The model names are proper nouns
               (`modelLabel`) and are not translated. -->
          <span class="models">
            {#each backupHits as h (h.model)}
              <span class="model" class:ok={!backupMismatch} class:warn={backupMismatch}>
                <span aria-hidden="true">{backupMismatch ? "⚠" : "✓"}</span>{modelLabel(h.model)}
              </span>
            {/each}
          </span>
          {#if backupMismatch}<span class="sr-only">{s.backupNotThisDevice}</span>{/if}
        {:else}
          <span class:warn={backupMissing}>{backupValue}</span>
        {/if}
        {#if (backup.kind === "none" || backupMismatch) && canBackUp}
          <button class="row-action" onclick={() => go("firmware/ofw")}>{s.backUpNow}</button>
        {:else if backup.kind === "disconnected"}
          <button class="row-action" onclick={() => void connectBackupFolder()}>{s.connectFolder}</button>
        {/if}
      </dd>
    </div>
    <div class="row">
      <dt><span class="dot" class:warn={sdMissing}></span>{s.storage}</dt>
      <dd><span class:warn={sdMissing}>{storageValue}</span></dd>
    </div>
    <!-- Layout is a fact about the device like every other row here, so it reads as one rather
         than as a second heading above the table. -->
    <div class="row">
      <dt><span class="dot"></span>{s.layoutLabel}</dt>
      <dd>{layoutValue}</dd>
    </div>
    <div class="row row-last">
      <dt><span class="dot"></span>{s.installedFirmware}</dt>
      <dd class="mono">{firmwareValue}</dd>
    </div>
  </dl>

  {#if upgradeAvailable}
    <div class="upgrade">
      <dl class="rows bare">
        <div class="row row-last">
          <dt>{s.latestLabel}</dt>
          <dd class="mono">{versions[0]?.gitTag}</dd>
        </div>
      </dl>
      <button class="upgrade-btn" onclick={() => go("firmware/install")}>{s.upgradeAction}</button>
    </div>
  {/if}

  <div class="foot">
    <button
      class="row-action"
      disabled={device.scanning}
      onclick={() => {
        void device.runScan("status pane");
        void backupPresence.refresh();
      }}>{s.rescan}</button
    >
  </div>
</section>

<style>
  .status-sect {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .attention {
    margin: -2px 0 10px;
    font-size: 13px;
    color: var(--caution);
  }
  .rows {
    margin: 0;
    border: 1px solid var(--hairline);
    border-radius: 6px;
    background: var(--surface);
  }
  .rows.bare {
    border: 0;
    border-radius: 0;
    background: transparent;
  }
  .row {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 16px;
    padding: 8px 12px;
    border-bottom: 1px solid var(--rule);
  }
  .row-last {
    border-bottom: 0;
  }
  dt {
    display: flex;
    align-items: baseline;
    gap: 8px;
    font-size: 13px;
    color: var(--ink-soft);
  }
  dd {
    margin: 0;
    display: flex;
    align-items: baseline;
    gap: 8px;
    font-size: 13px;
    text-align: end;
  }
  .dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--ink-faint);
    flex: none;
  }
  .dot.warn {
    background: var(--caution);
  }
  .warn {
    color: var(--caution);
    font-weight: 600;
  }
  .ok {
    color: var(--zelda-green);
  }
  .models {
    display: flex;
    align-items: baseline;
    gap: 10px;
  }
  .model {
    display: inline-flex;
    align-items: baseline;
    gap: 4px;
    font-weight: 600;
  }
  /* Visually hidden, still announced. NO `overflow: hidden` here even though the canonical
     snippet carries it: `clip-path` already does the hiding, and this pane is under a blunt
     no-clip guard that cannot tell a 1px a11y helper from a pane that silently clips the page. */
  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    clip-path: inset(50%);
    white-space: nowrap;
  }
  .mono {
    font-family: var(--font-mono);
  }
  .upgrade {
    margin-top: 12px;
    padding: 10px 12px;
    border: 1px solid var(--hairline);
    border-radius: 6px;
    background: var(--surface);
  }
  .upgrade-btn {
    margin-top: 8px;
    width: 100%;
    padding: 7px 12px;
    font: inherit;
    font-size: 13px;
    font-weight: 600;
    color: #fff;
    background: var(--zelda-green);
    border: 0;
    border-radius: 5px;
    cursor: pointer;
  }
  .foot {
    margin-top: 12px;
  }
  .row-action {
    font: inherit;
    font-size: 12px;
    padding: 2px 10px;
    border: 1px solid var(--hairline);
    border-radius: 4px;
    background: var(--surface);
    color: var(--ink);
    cursor: pointer;
  }
  .row-action:disabled {
    color: var(--ink-dim);
    cursor: default;
  }
</style>
