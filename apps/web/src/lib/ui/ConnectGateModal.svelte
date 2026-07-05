<script lang="ts">
  // App-wide "please connect a device" gate. Shown whenever device.connectGatePrompt is set
  // (surfaced via device.ensureConnectGate() from any of: ROMs tab "Install ROMs", Overview tab,
  // Firmware Setup Guided/Advanced). Modeled on FolderGateModal.svelte's promise-gate/
  // checklist pattern.
  //
  // Two independent actions, not tiered: "Choose Adapter" (item row) always opens the OS
  // picker to grant/switch an adapter. "Connect" (bottom) always attempts a silent connect
  // reusing whatever adapter is already known — no picker. Whichever succeeds first
  // auto-resolves the gate (see the $effect below); there's no separate "Continue" step.
  // Recovery Mode is deliberately NOT offered here — it's gated behind the specific
  // feature/deep-scan action that needs it (each such action calls device.ensureStub()
  // itself, which surfaces its own confirmation via StubLoadModal).
  import { device } from "../device.svelte.js";
  import Button from "./Button.svelte";
  import ModalShell from "./ModalShell.svelte";
  import { locale } from "../i18n/locale.svelte.js";

  const prompt = $derived(device.connectGatePrompt);

  let connecting = $state(false);
  let err = $state<string | null>(null);

  // Auto-resolve the moment a connection succeeds, regardless of which action caused it.
  $effect(() => {
    if (prompt && device.isConnected) device.resolveConnectGate();
  });

  async function chooseAdapter() {
    connecting = true;
    err = null;
    try {
      await device.connect(undefined, { forcePicker: true });
    } catch (e) {
      err = e instanceof Error ? e.message : locale.t.shared.connectGateModal.connectionFailed;
    } finally {
      connecting = false;
    }
  }

  async function connect() {
    connecting = true;
    err = null;
    try {
      await device.connect();
    } catch (e) {
      err = e instanceof Error ? e.message : locale.t.shared.connectGateModal.connectionFailed;
    } finally {
      connecting = false;
    }
  }
</script>

{#if prompt}
  <ModalShell onDismiss={() => device.cancelConnectGate()} maxWidth="28rem">
    {#snippet children()}
    <div class="content">
      <h3>{locale.t.shared.connectGateModal.title}</h3>
      <p class="muted">{locale.t.shared.connectGateModal.subtitle}</p>

      <div class="items">
        <div class="item" class:done={device.isConnected}>
          <div class="item-label">
            <span class="item-title">{locale.t.shared.connectGateModal.deviceConnectionTitle}</span>
            {#if device.isConnected}
              <span class="item-sub">{device.probeName ?? locale.t.shared.connectGateModal.connectedFallback}</span>
            {:else}
              <span class="item-sub">{locale.t.shared.connectGateModal.adapterHint}</span>
            {/if}
          </div>
          {#if device.isConnected}
            <span class="check" aria-label="connected">✓</span>
          {:else}
            <div class="item-actions">
              <button class="pick" disabled={connecting} onclick={chooseAdapter}>
                {connecting ? locale.t.shared.common.connecting : locale.t.shared.connectGateModal.chooseAdapter}
              </button>
            </div>
          {/if}
        </div>
      </div>

      {#if err}<p class="err">{err}</p>{/if}

      <div class="actions">
        <Button onclick={() => device.cancelConnectGate()}>{locale.t.shared.common.cancel}</Button>
        <Button variant="action" disabled={connecting} onclick={connect}>
          {connecting ? locale.t.shared.common.connecting : locale.t.shared.common.connect}
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
  .check {
    font-size: 1rem;
    color: var(--model-accent);
    flex-shrink: 0;
  }
  .err {
    font-size: var(--fs-caption);
    color: var(--danger, #d32f2f);
    margin: 0;
  }
  .actions {
    display: flex;
    gap: 0.6rem;
    justify-content: flex-end;
    margin-top: 0.5rem;
  }
</style>
