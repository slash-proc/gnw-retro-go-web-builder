<script lang="ts">
  // Gates loading the RAM flash utility (ensureStub). Shown whenever device.stubPrompt is
  // set; Continue resolves the pending ensureStub(), Cancel rejects it.
  import { device } from "../device.svelte.js";
  import Button from "./Button.svelte";
</script>

{#if device.stubPrompt}
  <div
    class="backdrop"
    role="presentation"
    onclick={(e) => e.target === e.currentTarget && device.cancelStubLoad()}
    onkeydown={(e) => e.key === "Escape" && device.cancelStubLoad()}
  >
    <div class="modal" role="dialog" aria-modal="true" tabindex="-1">
      <h3>Load the flash utility?</h3>
      <p class="muted">
        Managing the device — reading its flash, backing up, or flashing — needs the RAM flash
        utility running. Loading it <strong>resets the device</strong>.
      </p>
      <p class="muted">
        Hold down the device's <strong>power button</strong> while it connects, then set the
        device down and don't touch it until the operation finishes.
      </p>
      <div class="actions">
        <Button onclick={() => device.cancelStubLoad()}>Cancel</Button>
        <Button variant="action" onclick={() => device.confirmStubLoad()}>Continue</Button>
      </div>
    </div>
  </div>
{/if}

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 100;
    background: rgba(0, 0, 0, 0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 1.25rem;
  }
  .modal {
    background: var(--surface);
    border: 2px solid var(--model-accent);
    border-radius: var(--r-card);
    box-shadow: 0 8px 30px rgba(0, 0, 0, 0.3);
    padding: 1.25rem 1.5rem;
    max-width: 26rem;
    width: 100%;
  }
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
