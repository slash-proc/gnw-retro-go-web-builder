<script lang="ts">
  import ModalShell from "./ModalShell.svelte";
  import { massCoverImport } from "../massCoverImport.svelte.js";
  import { locale } from "../i18n/locale.svelte.js";

  let previewUrl = $state<string | null>(null);
  $effect(() => {
    const blob = massCoverImport.previewBlob;
    if (!blob) {
      previewUrl = null;
      return;
    }
    const url = URL.createObjectURL(blob);
    previewUrl = url;
    return () => URL.revokeObjectURL(url);
  });

  const progressLabel = $derived(locale.t.roms.gameDetailsPanel.importModal.progressLabel(
    massCoverImport.current,
    massCoverImport.total,
  ));
</script>

{#if massCoverImport.active && !massCoverImport.minimized}
  <ModalShell zIndex="var(--z-modal-prompt)" onDismiss={null} maxWidth="48rem">
    <div class="head">
      <h3>{locale.t.roms.gameDetailsPanel.importModal.title}</h3>
      <div class="actions">
        <button class="mbtn" onclick={() => massCoverImport.minimized = true}>
          {locale.t.roms.gameDetailsPanel.importModal.minimize}
        </button>
        <button class="mbtn stop" onclick={() => massCoverImport.cancelRequested = true}>
          {locale.t.roms.gameDetailsPanel.importModal.stop}
        </button>
      </div>
    </div>

    {#if massCoverImport.showGeneratedCovers}
      <div class="preview" aria-live="polite">
        {#if previewUrl}
          <img src={previewUrl} alt={massCoverImport.previewMessage ?? progressLabel} />
        {:else if massCoverImport.previewMessage}
          <p>{massCoverImport.previewMessage}</p>
        {:else}
          <p>{locale.t.roms.gameDetailsPanel.importModal.showGeneratedCovers}</p>
        {/if}
      </div>
    {/if}

    <div class="progress" aria-live="polite">
      <div class="progress-label">
        <span>{progressLabel}</span>
        {#if massCoverImport.total > 0}
          <span>{Math.min(100, Math.round(massCoverImport.current / massCoverImport.total * 100))}%</span>
        {/if}
      </div>
      <div class="track">
        <div class="fill" class:indeterminate={massCoverImport.total === 0}
          style:width={massCoverImport.total === 0 ? undefined : `${Math.min(100, massCoverImport.current / massCoverImport.total * 100)}%`}></div>
      </div>
    </div>
  </ModalShell>
{/if}

<style>
  .head { display: flex; align-items: center; justify-content: space-between; gap: 1rem; margin-bottom: 1rem; }
  h3 { margin: 0; }
  .actions { display: flex; gap: .5rem; }
  .mbtn { padding: .45rem .8rem; border: 1px solid var(--hairline); border-radius: var(--r-btn); background: var(--surface); color: var(--ink); cursor: pointer; }
  .stop { border-color: var(--danger); color: var(--danger); }
  .preview { min-height: 10rem; max-height: 48vh; display: grid; place-items: center; overflow: hidden; border-radius: var(--r-card); background: var(--surface-sunk); }
  .preview img { max-width: 100%; max-height: 48vh; object-fit: contain; }
  .preview p { color: var(--ink-soft); }
  .progress { margin-top: 1rem; }
  .progress-label { display: flex; justify-content: space-between; margin-bottom: .4rem; }
  .track { height: .5rem; overflow: hidden; border-radius: 99px; background: var(--hairline); }
  .fill { height: 100%; background: var(--grad-gold); transition: width .15s ease; }
  .fill.indeterminate { width: 35%; animation: slide 1.2s ease-in-out infinite alternate; }
  @keyframes slide { to { transform: translateX(190%); } }
</style>
