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
  <ModalShell onDismiss={() => device.cancelConnectGate()} maxWidth="26rem">
    {#snippet children()}
    <div class="content">
      <h3>{locale.t.shared.connectGateModal.title}</h3>
      <p class="muted">{locale.t.shared.connectGateModal.subtitle}</p>

      <div class="items">
        <div class="item">
          {#if device.isConnected}
            <span class="mark done" aria-label={locale.t.shared.connectGateModal.connectedFallback}>
              <svg width="11" height="11" viewBox="0 0 20 20" fill="none" stroke="#fff" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4.5 10.5l3.5 3.5 7.5-8"></path></svg>
            </span>
          {:else}
            <span class="mark" aria-hidden="true"></span>
          {/if}
          <div class="item-label">
            <span class="item-title">{locale.t.shared.connectGateModal.deviceConnectionTitle}</span>
            <span class="item-sub">{locale.t.shared.connectGateModal.adapterHint}</span>
            {#if device.isConnected}
              <span class="item-path">{device.probeName ?? locale.t.shared.connectGateModal.connectedFallback}</span>
            {/if}
          </div>
          {#if !device.isConnected}
            <button class="pick" disabled={connecting} onclick={chooseAdapter}>
              {connecting ? locale.t.shared.common.connecting : locale.t.shared.connectGateModal.chooseAdapter}
            </button>
          {/if}
        </div>
      </div>

      {#if err}<p class="err">{err}</p>{/if}

      <div class="actions">
        <Button variant="cancel" onclick={() => device.cancelConnectGate()}>{locale.t.shared.common.cancel}</Button>
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
    gap: 4px;
  }
  h3 {
    font-size: var(--fs-title);
    font-weight: 600;
    letter-spacing: -0.01em;
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
    padding-top: 12px;
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
    flex-shrink: 0;
  }
  .pick:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .err {
    font-size: var(--fs-caption);
    color: var(--danger);
    margin: 0;
  }
  .actions {
    display: flex;
    gap: 20px;
    justify-content: flex-end;
    margin-top: 20px;
  }
</style>
