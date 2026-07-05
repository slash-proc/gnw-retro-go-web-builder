<script lang="ts">
  // Gates loading the RAM flash utility (ensureStub). Shown whenever device.stubPrompt is
  // set; Continue resolves the pending ensureStub(), Cancel rejects it.
  import { device } from "../device.svelte.js";
  import Button from "./Button.svelte";
  import ModalShell from "./ModalShell.svelte";
  import { locale } from "../i18n/locale.svelte.js";
</script>

{#if device.stubPrompt}
  <!-- Explicit zIndex above InstallProgressModal's default 100: while a flash/SD-sync is
       running, ensureStub() can prompt for Recovery Mode confirmation — that confirmation must
       render on top of (not behind) the still-visible progress modal. -->
  <ModalShell zIndex={110} onDismiss={() => device.cancelStubLoad()}>
    {#snippet children()}
      <h3>{locale.t.shared.stubLoadModal.title}</h3>
      <p class="muted">
        {locale.t.shared.stubLoadModal.body1Pre}<strong>{locale.t.shared.stubLoadModal.body1Bold}</strong>{locale.t.shared.stubLoadModal.body1Post}
      </p>
      <p class="muted">
        {locale.t.shared.stubLoadModal.body2Pre}<strong>{locale.t.shared.stubLoadModal.body2Bold}</strong>{locale.t.shared.stubLoadModal.body2Post}
      </p>
      <div class="actions">
        <Button onclick={() => device.cancelStubLoad()}>{locale.t.shared.common.cancel}</Button>
        <Button variant="action" onclick={() => device.confirmStubLoad()}>{locale.t.shared.stubLoadModal.continue}</Button>
      </div>
    {/snippet}
  </ModalShell>
{/if}

<style>
  h3 {
    font-size: var(--fs-lg);
    margin-bottom: 0.5rem;
  }
  .muted {
    color: var(--ink-soft);
    font-size: var(--fs-caption);
    margin-bottom: 0.5rem;
  }
  .actions {
    display: flex;
    gap: 0.6rem;
    justify-content: flex-end;
    margin-top: 1.25rem;
  }
</style>
