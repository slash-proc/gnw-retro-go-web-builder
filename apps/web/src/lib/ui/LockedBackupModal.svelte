<script lang="ts">
  import { onMount } from "svelte";
  import { device } from "../device.svelte.js";
  import { isLockedBackupBlueScreen } from "../engine/ofw.js";
  import { dbg } from "../debug.js";
  import Button from "./Button.svelte";
  import ModalShell from "./ModalShell.svelte";
  import { locale } from "../i18n/locale.svelte.js";

  let powerCycleStatus = $state<"red" | "yellow" | "green">("red");
  let checkingStatus = false;
  let lastReconnectAt = 0;
  let consecutiveNonBlueChecks = 0;

  function setPowerCycleStatus(status: "red" | "yellow" | "green"): void {
    if (powerCycleStatus === status) return;
    powerCycleStatus = status;
    dbg(`[locked-backup] power-cycle status LED: ${status}`);
  }

  async function refreshPowerCycleStatus(): Promise<void> {
    if (!device.lockedBackupPrompt) {
      setPowerCycleStatus("red");
      return;
    }
    const transport = device.transport;
    // Use the same normal liveness poll state as the rest of the app. The backup flow
    // temporarily resumes that poll while this prompt is open, so it can follow a target
    // power-cycle and replace a stale transport handle through the usual reconnect path.
    if (!transport || !device.isConnected || device.isTargetUnresponsive) {
      setPowerCycleStatus("red");
      consecutiveNonBlueChecks = 0;
      if (Date.now() - lastReconnectAt >= 5000) {
        lastReconnectAt = Date.now();
        void device.reconnectLockedBackupTarget();
      }
      return;
    }
    if (checkingStatus || transport.busy()) return;
    // Preserve green between samples. Resetting to yellow on every interval made the
    // indicator visibly flicker even when consecutive reads all confirmed blue mode.
    if (powerCycleStatus === "red") setPowerCycleStatus("yellow");
    checkingStatus = true;
    // The shared blue-screen check briefly halts the CPU. Keep the regular poll from
    // interleaving SWD reads with that critical sequence.
    device.suspendPoll();
    try {
      if (device.transport !== transport || !device.isConnected || device.isTargetUnresponsive) return;
      const detected = await isLockedBackupBlueScreen(transport);
      if (device.transport === transport && device.isConnected && !device.isTargetUnresponsive) {
        if (detected) {
          consecutiveNonBlueChecks = 0;
          setPowerCycleStatus("green");
        } else if (++consecutiveNonBlueChecks >= 2) {
          setPowerCycleStatus("yellow");
        }
      }
    } catch {
      // A transient SWD read failure is not proof that the display left blue mode. The
      // normal liveness poll owns disconnected detection and drives red when it confirms loss.
    } finally {
      device.resumePoll();
      checkingStatus = false;
    }
  }

  onMount(() => {
    const timer = window.setInterval(() => void refreshPowerCycleStatus(), 750);
    void refreshPowerCycleStatus();
    return () => window.clearInterval(timer);
  });
</script>

{#if device.lockedBackupFailurePrompt}
  <ModalShell zIndex="var(--z-modal-prompt)" onDismiss={() => device.chooseLockedBackupFailure("stop")}>
    {#snippet children()}
      <h3>{locale.t.officialFirmware.lockedBackupFailureTitle}</h3>
      <p class="muted">{device.lockedBackupFailurePrompt.error}</p>
      <p class="muted">{locale.t.officialFirmware.lockedBackupFailureDetails((device.lockedBackupFailurePrompt.nextSwdClockHz / 1_000_000).toFixed(1))}</p>
      <div class="actions">
        <Button variant="cancel" onclick={() => device.chooseLockedBackupFailure("stop")}>{locale.t.officialFirmware.lockedBackupStop}</Button>
        <Button variant="default" onclick={() => device.chooseLockedBackupFailure("restore")}>{locale.t.officialFirmware.lockedBackupRestore}</Button>
        <Button variant="action" onclick={() => device.chooseLockedBackupFailure("retry")}>{locale.t.officialFirmware.lockedBackupRetry((device.lockedBackupFailurePrompt.nextSwdClockHz / 1_000_000).toFixed(1))}</Button>
      </div>
    {/snippet}
  </ModalShell>
{:else if device.lockedBackupPrompt}
  <ModalShell zIndex="var(--z-modal-prompt)" onDismiss={() => device.cancelLockedBackupPowerCycle()}>
    {#snippet children()}
      <h3>{locale.t.officialFirmware.lockedPowerCycleTitle}</h3>
      <ol class="muted steps">
        <li>{locale.t.officialFirmware.lockedPowerCycleStepOff}</li>
        <li>{locale.t.officialFirmware.lockedPowerCycleStepOn}</li>
        <li>{locale.t.officialFirmware.lockedPowerCycleStepContinue}</li>
      </ol>
      <p class="muted"><strong>{locale.t.officialFirmware.lockedPowerCycleNoteLabel}</strong> {locale.t.officialFirmware.lockedPowerCycleNote}</p>
      <p class="device-status">
        <strong>{locale.t.officialFirmware.lockedPowerCycleStatusLabel}</strong>
        <span
          class="status-led {powerCycleStatus}"
          title={powerCycleStatus === "green"
            ? locale.t.officialFirmware.lockedPowerCycleStatusBlue
            : powerCycleStatus === "yellow"
              ? locale.t.officialFirmware.lockedPowerCycleStatusNotBlue
              : locale.t.officialFirmware.lockedPowerCycleStatusNoDevice}
          aria-label={powerCycleStatus === "green"
            ? locale.t.officialFirmware.lockedPowerCycleStatusBlue
            : powerCycleStatus === "yellow"
              ? locale.t.officialFirmware.lockedPowerCycleStatusNotBlue
              : locale.t.officialFirmware.lockedPowerCycleStatusNoDevice}
          role="img"
        ></span>
      </p>
      <div class="actions">
        <Button variant="cancel" onclick={() => device.cancelLockedBackupPowerCycle()}>{locale.t.shared.common.cancel}</Button>
        <Button variant="action" disabled={powerCycleStatus !== "green" || !device.isConnected || device.isTargetUnresponsive} onclick={() => device.confirmLockedBackupPowerCycle()}>{locale.t.shared.stubLoadModal.continue}</Button>
      </div>
    {/snippet}
  </ModalShell>
{/if}

<style>
  h3 { font-size: var(--fs-title); font-weight: 600; letter-spacing: -0.01em; margin-bottom: 0.5rem; }
  .muted { color: var(--ink-soft); font-size: var(--fs-caption); margin-bottom: 0.5rem; }
  .steps { padding-inline-start: 1.5rem; }
  .steps li + li { margin-top: 0.4rem; }
  .device-status { display: flex; align-items: center; gap: 0.55rem; color: var(--ink-soft); font-size: var(--fs-caption); margin: 0.8rem 0 0; }
  .status-led { display: inline-block; width: 0.8rem; height: 0.8rem; border-radius: 50%; cursor: help; box-shadow: 0 0 0 1px color-mix(in srgb, currentColor 28%, transparent); }
  .status-led.red { background: #ef4444; }
  .status-led.yellow { background: #facc15; }
  .status-led.green { background: #22c55e; }
  .actions { display: flex; flex-wrap: wrap; gap: 0.75rem; justify-content: flex-end; margin-top: 1.25rem; }
</style>
