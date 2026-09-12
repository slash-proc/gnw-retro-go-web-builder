<script lang="ts">
  // The ONE prompt that survives automatic unlocking.
  //
  // The owner's rule is that unlocking "should just automatically happen", and everywhere a
  // backup of this unit exists it does -- `engine/unlockGate.ts` never reaches this modal.
  // This is the case that cannot be made safe: a locked device's internal flash is unreadable
  // over SWD, so there is no backup to take first, and clearing RDP mass-erases both flashes.
  // The unit's original firmware is not redistributable and cannot be re-downloaded, so this
  // is genuinely one-way -- which is the whole reason it still asks.
  //
  // Store-backed singleton rendered at the App root, like StubLoadModal: `device.unlockPrompt`
  // holds the pending promise, so no unrelated `{#if}` elsewhere in the tree can unmount the
  // question out from under an in-flight write.
  import { device } from "../device.svelte.js";
  import Button from "./Button.svelte";
  import ModalShell from "./ModalShell.svelte";
  import { locale } from "../i18n/locale.svelte.js";
</script>

{#if device.unlockPrompt}
  <!-- --z-modal-prompt, above ModalShell's default --z-modal: every write flow calls
       ensureUnlocked() from inside installProgress.run(), so this asks on top of a
       still-visible progress modal, exactly as StubLoadModal does. -->
  <ModalShell zIndex="var(--z-modal-prompt)" onDismiss={() => device.cancelUnlock()}>
    {#snippet children()}
      <h3>{locale.t.officialFirmware.unlockModalTitle}</h3>
      <p class="muted">{locale.t.officialFirmware.unlockModalBody}</p>
      <div class="actions">
        <Button variant="cancel" onclick={() => device.cancelUnlock()}>{locale.t.shared.common.cancel}</Button>
        <Button variant="destructive" onclick={() => device.confirmUnlock()}>
          {locale.t.officialFirmware.unlockModalConfirm}
        </Button>
      </div>
    {/snippet}
  </ModalShell>
{/if}

<style>
  h3 {
    font-size: var(--fs-title);
    font-weight: 600;
    letter-spacing: -0.01em;
    margin-bottom: 0.5rem;
  }
  .muted {
    color: var(--ink-soft);
    font-size: var(--fs-caption);
    margin-bottom: 0.5rem;
  }
  .actions {
    display: flex;
    gap: 1.25rem;
    justify-content: flex-end;
    margin-top: 1.25rem;
  }
</style>
