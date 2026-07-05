<script lang="ts">
  // Gates ROM management when required folders haven't been selected yet.
  // Shown whenever roms.folderGatePrompt is set; Continue resolves the pending
  // ensureFolders(), Cancel rejects it. Mirrors the StubLoadModal pattern.
  import { roms } from "../roms.svelte.js";
  import { device } from "../device.svelte.js";
  import { pickSdCardFolder } from "../romScan.js";
  import Button from "./Button.svelte";
  import ModalShell from "./ModalShell.svelte";
  import { locale } from "../i18n/locale.svelte.js";

  const prompt = $derived(roms.folderGatePrompt);

  // Continue is enabled once all required folders are satisfied.
  const ready = $derived(
    !!prompt &&
    roms.selected &&
    (!prompt.sd || !!device.sdHandle)
  );

  const pickSdCard = pickSdCardFolder;
</script>

{#if prompt}
  <ModalShell onDismiss={() => roms.cancelFolderGate()} maxWidth="28rem">
    {#snippet children()}
    <div class="content">
      <h3>{locale.t.shared.folderGateModal.title}</h3>
      <p class="muted">
        {prompt.sd ? locale.t.shared.folderGateModal.subtitlePlural : locale.t.shared.folderGateModal.subtitleSingular}
      </p>

      <div class="items">
        <!-- ROM source folder -->
        <div class="item" class:done={roms.selected}>
          <div class="item-label">
            <span class="item-title">{locale.t.shared.folderGateModal.romFolderTitle}</span>
            {#if roms.selected}
              <span class="item-sub">{roms.scan?.dir?.name ?? locale.t.shared.folderGateModal.selectedFallback}</span>
            {:else}
              <span class="item-sub">{locale.t.shared.folderGateModal.romFolderHint}</span>
            {/if}
          </div>
          <div class="item-actions">
            {#if roms.selected}
              <span class="check" aria-label="selected">✓</span>
            {:else if roms.pendingHandle}
              <button class="link" onclick={() => roms.reconnect()}>{locale.t.shared.folderGateModal.reconnectLastFolder}</button>
              <span class="sep">{locale.t.shared.common.or}</span>
            {/if}
            <button class="pick" disabled={roms.folderScanning} onclick={() => roms.pickFolder()}>
              {roms.folderScanning ? locale.t.shared.folderGateModal.scanning : roms.selected ? locale.t.shared.common.changeEllipsis : locale.t.shared.common.chooseEllipsis}
            </button>
          </div>
        </div>

        <!-- SD card folder (SD mode only) -->
        {#if prompt.sd}
          <div class="item" class:done={!!device.sdHandle}>
            <div class="item-label">
              <span class="item-title">{locale.t.shared.folderGateModal.sdCardFolderTitle}</span>
              {#if device.sdHandle}
                <span class="item-sub">{device.sdHandle.name}</span>
              {:else}
                <span class="item-sub">{locale.t.shared.folderGateModal.sdCardFolderHint}</span>
              {/if}
            </div>
            <div class="item-actions">
              {#if device.sdHandle}
                <span class="check" aria-label="selected">✓</span>
              {/if}
              <button class="pick" onclick={pickSdCard}>{device.sdHandle ? locale.t.shared.common.changeEllipsis : locale.t.shared.common.chooseEllipsis}</button>
            </div>
          </div>
        {/if}
      </div>

      <div class="actions">
        <Button onclick={() => roms.cancelFolderGate()}>{locale.t.shared.common.cancel}</Button>
        <Button variant="action" disabled={!ready} onclick={() => roms.resolveFolderGate()}>
          {locale.t.shared.folderGateModal.continue}
        </Button>
      </div>
    </div>
    {/snippet}
  </ModalShell>
{/if}

<style>
  .content {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }
  h3 {
    font-size: var(--fs-lg);
    margin: 0;
  }
  .muted {
    color: var(--ink-soft);
    font-size: var(--fs-caption);
    margin: 0;
  }
  .items {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    margin-top: 0.25rem;
  }
  .item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    padding: 0.75rem 1rem;
    border: 1.5px solid var(--surface-sunk);
    border-radius: var(--r-control);
    transition: border-color 150ms ease;
  }
  .item.done {
    border-color: var(--model-accent);
  }
  .item-label {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
    min-width: 0;
  }
  .item-title {
    font-size: var(--fs-caption);
    font-weight: 600;
    color: var(--ink);
  }
  .item-sub {
    font-size: 0.75rem;
    color: var(--ink-soft);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .item-actions {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    flex-shrink: 0;
  }
  .pick {
    font: inherit;
    font-size: var(--fs-caption);
    padding: 0.3rem 0.75rem;
    border: 1.5px solid var(--model-accent);
    border-radius: var(--r-control);
    background: transparent;
    color: var(--model-accent);
    cursor: pointer;
    white-space: nowrap;
  }
  .pick:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .link {
    font: inherit;
    font-size: var(--fs-caption);
    background: none;
    border: none;
    color: var(--ink-soft);
    text-decoration: underline;
    cursor: pointer;
    padding: 0;
    white-space: nowrap;
  }
  .sep {
    font-size: var(--fs-caption);
    color: var(--ink-soft);
  }
  .check {
    font-size: 1rem;
    color: var(--model-accent);
    flex-shrink: 0;
  }
  .actions {
    display: flex;
    gap: 0.6rem;
    justify-content: flex-end;
    margin-top: 0.5rem;
  }
</style>
