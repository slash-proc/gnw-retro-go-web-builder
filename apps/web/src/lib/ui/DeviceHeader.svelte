<script lang="ts">
  import { device } from "../device.svelte.js";
  import { theme } from "../theme.svelte.js";
  import Button from "./Button.svelte";
  import SplitButton from "./SplitButton.svelte";

  const connect = (force = false) =>
    device.connect(undefined, force ? { forcePicker: true } : undefined).catch(() => {});
</script>

<header class="band on-gold">
  <span class="dot {device.connection}" title={device.connection} aria-hidden="true"></span>
  <strong class="brand">GNW Web Builder</strong>
  <span class="spacer"></span>
  <button class="icon" onclick={() => theme.toggle()} title="Toggle light / dark" aria-label="Toggle theme">
    {theme.mode === "dark" ? "☀" : "☾"}
  </button>
  {#if device.isConnected}
    <Button variant="quiet" onclick={() => device.disconnect()}>Disconnect</Button>
  {:else}
    <SplitButton
      variant="default"
      label={device.connection === "connecting" ? "Connecting…" : "Connect"}
      disabled={device.connection === "connecting"}
      onclick={() => connect()}
      items={[{ label: "Choose adapter…", onclick: () => connect(true) }]}
    />
  {/if}
</header>

<style>
  /* The gold "device lip" — black silkscreen legend, a model-colored pinstripe
     underneath. Gold reads light in both themes, so the text stays black. */
  /* Metallic gold "device lip" with a model-colored pinstripe. */
  .band {
    position: sticky;
    top: 0;
    z-index: 10;
    display: flex;
    align-items: center;
    gap: 0.7rem;
    background: var(--grad-gold);
    color: #161616;
    padding: 0.55rem 1.25rem;
    border-bottom: 3px solid var(--model-accent);
    transition: border-color 200ms ease;
  }
  /* The GAME&WATCH logo plate: black text on silver, on gold. */
  .brand {
    font-size: var(--fs-caption);
    font-weight: 700;
    letter-spacing: 0.02em;
    background: var(--silver);
    color: #161616;
    border: 1px solid #161616;
    border-radius: 3px;
    padding: 0.15rem 0.5rem;
  }
  .spacer {
    flex: 1;
  }
  /* Gray function-button cap ringed in the model color. */
  .icon {
    font: inherit;
    background: var(--silver);
    border: 1.5px solid var(--model-accent);
    box-shadow: inset 0 -2px 0 var(--silver-edge);
    border-radius: 5px;
    color: #161616;
    cursor: pointer;
    width: 1.9rem;
    height: 1.9rem;
    line-height: 1;
    transition: border-color 200ms ease;
  }
  .icon:hover {
    filter: brightness(0.97);
  }
  /* Force the quiet Disconnect legend dark on the gold lip (both themes). */
  .band :global(.btn.quiet) {
    color: #161616;
    text-decoration-color: #161616;
  }
  .dot {
    width: 0.65rem;
    height: 0.65rem;
    border-radius: 50%;
    background: var(--neutral-edge);
    flex: none;
    transition: background-color 200ms ease;
  }
  .dot.connected {
    background: var(--model-accent);
  }
  .dot.attention {
    background: var(--caution);
  }
  .dot.lost {
    background: var(--danger);
  }
  .dot.connecting {
    background: var(--ink-soft);
    animation: pulse 1s ease-in-out infinite;
  }
  @keyframes pulse {
    0%,
    100% {
      opacity: 0.4;
    }
    50% {
      opacity: 1;
    }
  }
</style>
