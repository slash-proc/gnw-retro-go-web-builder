<script lang="ts">
  // Gates loading the RAM flash utility (ensureStub). Shown whenever device.stubPrompt is
  // set; Continue resolves the pending ensureStub(), Cancel rejects it.
  import { device } from "../device.svelte.js";
  import Button from "./Button.svelte";
  import ModalShell from "./ModalShell.svelte";
  import { locale } from "../i18n/locale.svelte.js";
</script>

{#if device.stubPrompt}
  <!-- --z-modal-prompt, above ModalShell's default --z-modal: while a flash/SD-sync is
       running, ensureStub() can prompt for Recovery Mode confirmation — that confirmation must
       render on top of (not behind) the still-visible progress modal. -->
  <ModalShell zIndex="var(--z-modal-prompt)" onDismiss={() => device.cancelStubLoad()}>
    {#snippet children()}
      <h3>{locale.t.shared.stubLoadModal.title}</h3>
      <p class="muted">
        {locale.t.shared.stubLoadModal.body1Pre}<strong>{locale.t.shared.stubLoadModal.body1Bold}</strong>{locale.t.shared.stubLoadModal.body1Post}
      </p>
      <p class="muted">
        {locale.t.shared.stubLoadModal.body2Pre}<strong>{locale.t.shared.stubLoadModal.body2Bold}</strong>{locale.t.shared.stubLoadModal.body2Post}
      </p>
      <div class="actions">
        <Button variant="cancel" onclick={() => device.cancelStubLoad()}>{locale.t.shared.common.cancel}</Button>
        <Button variant="action" onclick={() => device.confirmStubLoad()}>{locale.t.shared.stubLoadModal.continue}</Button>
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
  /* ModalRecoveryMode.dc.html:94 sets both emphasised runs to
     `color: #1b1b1b` — full ink, a step UP from the paragraph's muted grey.
     --ink is that exact hex (tokens.css:10) and carries dark-theme overrides
     (tokens.css:256, :295); without this rule the <strong> inherits
     --ink-soft and reads as no emphasis at all. */
  .muted strong {
    color: var(--ink);
  }
  .actions {
    display: flex;
    gap: 1.25rem;
    justify-content: flex-end;
    margin-top: 1.25rem;
  }
</style>
