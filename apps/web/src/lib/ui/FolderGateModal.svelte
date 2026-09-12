<script lang="ts">
  // Gates ROM management when required folders haven't been selected yet.
  // Shown whenever library.folderGatePrompt is set; Continue resolves the pending
  // ensureFolders(), Cancel rejects it. Mirrors the StubLoadModal pattern.
  import { library } from "../library.svelte.js";
  import { device } from "../device.svelte.js";
  import { pickSdCardFolder } from "../romScan.js";
  import { sdFolderPick } from "../sdFolderPick.svelte.js";
  import Button from "./Button.svelte";
  import ModalShell from "./ModalShell.svelte";
  import { locale } from "../i18n/locale.svelte.js";
  import { cardDisplayName } from "../sdStorage.svelte.js";
  import { SD_NOMINAL_SIZES_GB, loadStatedCard, saveStatedCard } from "../sdCapacity.js";

  const prompt = $derived(library.folderGatePrompt);

  /**
   * THE CARD'S SIZE, ASKED HERE BECAUSE THIS IS WHERE THE CARD IS PICKED (GatePrompt.dc.html
   * draws it on the SD row). No browser API reports a picked directory's volume, so a stated
   * size is the only denominator the SD card page will ever have, and the moment the user
   * chooses the folder is the moment they are holding the card.
   *
   * IT IS NOT ASKED WHICH FILESYSTEM, and the modal never was the place for that question even
   * before it was dropped everywhere: exFAT beats FAT32 by less than the safety margin at every
   * measured size, so the answer cannot move the figure.
   *
   * The word is `sources.sd.capacity`, the card page's own label for this fact, rather than a
   * new key of this modal's. One fact gets one word across the two surfaces that state it.
   */
  const sdName = $derived(device.sdHandle ? cardDisplayName(device.sdHandle.name) : null);

  /**
   * `loadStatedCard` reads localStorage, which is not reactive, so the select is backed by
   * state that is re-seeded when the CARD changes and written when the user picks. A plain
   * `$derived` over the loader would have shown a stale value the moment a size was chosen.
   * The effect reads `sdName` and writes `statedGB`, and never reads what it writes, so it
   * cannot re-dirty its own batch.
   */
  let statedGB = $state<number | null>(null);
  $effect(() => {
    statedGB = loadStatedCard(sdName)?.nominalGB ?? null;
  });

  function pickSize(raw: string): void {
    if (sdName === null) return;
    const nominalGB = raw === "" ? null : Number(raw);
    if (nominalGB !== null && !Number.isFinite(nominalGB)) return;
    saveStatedCard(nominalGB === null ? null : { folderName: sdName, nominalGB });
    statedGB = nominalGB;
  }

  // Continue is enabled once all required folders are satisfied.
  const ready = $derived(
    !!prompt &&
    library.selected &&
    (!prompt.sd || !!device.sdHandle)
  );

  const pickSdCard = pickSdCardFolder;
</script>

{#if prompt}
  <ModalShell onDismiss={() => library.cancelFolderGate()} maxWidth="26rem">
    {#snippet children()}
    <div class="content">
      <h3>{locale.t.shared.folderGateModal.title}</h3>

      <div class="items">
        <!-- ROM source folder -->
        <div class="item">
          {#if library.selected}
            <span class="mark done" aria-label={locale.t.shared.folderGateModal.selectedFallback}>
              <svg width="11" height="11" viewBox="0 0 20 20" fill="none" stroke="#fff" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4.5 10.5l3.5 3.5 7.5-8"></path></svg>
            </span>
          {:else}
            <span class="mark" aria-hidden="true"></span>
          {/if}
          <div class="item-label">
            <span class="item-title">{locale.t.shared.folderGateModal.romFolderTitle}</span>
            <span class="item-sub">{locale.t.shared.folderGateModal.romFolderHint}</span>
            {#if library.selected}
              <span class="item-path">{library.scan?.dir?.name ?? locale.t.shared.folderGateModal.selectedFallback}</span>
            {/if}
          </div>
          <div class="item-actions">
            {#if !library.selected && library.pendingHandle}
              <button class="link" onclick={() => library.reconnect()}>{locale.t.shared.folderGateModal.reconnectLastFolder}</button>
              <span class="sep">{locale.t.shared.common.or}</span>
            {/if}
            <button class="pick" disabled={library.folderScanning} onclick={() => library.pickFolder()}>
              {library.folderScanning ? locale.t.shared.folderGateModal.scanning : library.selected ? locale.t.shared.common.changeEllipsis : locale.t.shared.common.chooseEllipsis}
            </button>
          </div>
        </div>

        <!-- SD card folder (SD mode only) -->
        {#if prompt.sd}
          <div class="item">
            {#if device.sdHandle}
              <span class="mark done" aria-label={locale.t.shared.folderGateModal.selectedFallback}>
                <svg width="11" height="11" viewBox="0 0 20 20" fill="none" stroke="#fff" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4.5 10.5l3.5 3.5 7.5-8"></path></svg>
              </span>
            {:else}
              <span class="mark" aria-hidden="true"></span>
            {/if}
            <div class="item-label">
              <span class="item-title">{locale.t.shared.folderGateModal.sdCardFolderTitle}</span>
              <span class="item-sub">{locale.t.shared.folderGateModal.sdCardFolderHint}</span>
              <!-- ModalFolderSdUnreadable.dc.html — a genuine pick/scan failure (never a cancel)
                   is drawn on the row that raised the picker, because `Choose…` beside it IS the
                   retry. The status slot stays empty: the requirement is still unmet. -->
              {#if sdFolderPick.failed}
                <span class="item-err">{locale.t.shared.folderGateModal.errRead}</span>
                {#if sdFolderPick.failedFolder}
                  <span class="item-path">{sdFolderPick.failedFolder}</span>
                {/if}
              {:else if device.sdHandle}
                <span class="item-path">{device.sdHandle.name}</span>
              {/if}
              <!-- GatePrompt.dc.html draws the size on this row, under the card's own name. It
                   appears only once a card is chosen: there is nothing to state a size for
                   before that, and an enabled control over no card would be a question about
                   nothing. -->
              {#if device.sdHandle}
                <label class="item-size">
                  <span>{locale.t.sources.sd.capacity}</span>
                  <select value={statedGB === null ? "" : String(statedGB)} onchange={(e) => pickSize(e.currentTarget.value)}>
                    <option value="">{locale.t.sources.sd.none}</option>
                    {#each SD_NOMINAL_SIZES_GB as gb (gb)}
                      <option value={String(gb)}>{gb} GB</option>
                    {/each}
                  </select>
                </label>
              {/if}
            </div>
            <button class="pick" onclick={pickSdCard}>{device.sdHandle ? locale.t.shared.common.changeEllipsis : locale.t.shared.common.chooseEllipsis}</button>
          </div>
        {/if}
      </div>

      <div class="actions">
        <Button variant="cancel" onclick={() => library.cancelFolderGate()}>{locale.t.shared.common.cancel}</Button>
        <Button variant="action" disabled={!ready} onclick={() => library.resolveFolderGate()}>
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
    gap: 4px;
  }
  h3 {
    font-size: var(--fs-title);
    font-weight: 600;
    letter-spacing: -0.01em;
    margin: 0;
  }
  .items {
    display: flex;
    flex-direction: column;
    padding-top: 12px;
  }
  /* The size sits under the card's name on its own row, not beside the title, so a long
     translation of the label cannot squeeze the name. */
  .item-size {
    display: flex;
    align-items: center;
    gap: 8px;
    padding-top: 5px;
    font-size: var(--fs-btn-sm);
    color: var(--ink-soft);
  }
  /* De-boxed checklist rows: a step is not an object — a single rule separates them. */
  .item {
    display: flex;
    align-items: center;
    gap: 13px;
    padding: 0.875rem 0;
    border-bottom: 1px solid var(--rule);
  }
  .mark {
    width: 18px;
    height: 18px;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .mark.done {
    border-radius: 50%;
    background: var(--zelda-green);
  }
  .item-label {
    display: flex;
    flex-direction: column;
    gap: 2px;
    flex-grow: 1;
    min-width: 0;
  }
  .item-title {
    font-size: var(--fs-caption);
    font-weight: 600;
    color: var(--ink);
  }
  .item-sub {
    font-size: var(--fs-btn-sm);
    color: var(--ink-soft);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .item-path {
    font-family: var(--font-mono);
    font-size: var(--fs-micro);
    color: var(--ink-soft);
    padding-top: 3px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .item-err {
    font-size: var(--fs-btn-sm);
    color: var(--danger);
    padding-top: 3px;
  }
  .item-actions {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    flex-shrink: 0;
  }
  .pick {
    font: inherit;
    font-size: var(--fs-btn-sm);
    font-weight: 600;
    color: var(--zelda-green);
    background: none;
    border: none;
    padding: 0;
    cursor: pointer;
    white-space: nowrap;
  }
  .pick:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .link {
    font: inherit;
    font-size: var(--fs-btn-sm);
    background: none;
    border: none;
    color: var(--ink-soft);
    text-decoration: underline;
    cursor: pointer;
    padding: 0;
    white-space: nowrap;
  }
  .sep {
    font-size: var(--fs-btn-sm);
    color: var(--ink-soft);
  }
  .actions {
    display: flex;
    gap: 20px;
    justify-content: flex-end;
    margin-top: 20px;
  }
</style>
