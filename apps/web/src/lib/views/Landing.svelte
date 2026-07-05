<script lang="ts">
  import { device } from "../device.svelte.js";
  import Card from "../ui/Card.svelte";
  import FlashChipIcon from "../ui/FlashChipIcon.svelte";
  import SdCardIcon from "../ui/SdCardIcon.svelte";
  import { locale } from "../i18n/locale.svelte.js";
  import { onMount } from "svelte";

  let { onNavigate }: { onNavigate: (target: 'device' | 'device-advanced' | 'games', media: 'flash' | 'sd') => void } = $props();

  const webusb = typeof navigator !== "undefined" && !!navigator.usb;
  let knownDevices = $state<USBDevice[]>([]);
  let step = $state<'media' | 'action'>('media');

  onMount(() => {
    if (webusb) {
      navigator.usb.getDevices().then(devs => knownDevices = devs).catch(() => {});
    }
  });

  function selectMedia(media: 'flash' | 'sd') {
    device.targetMedia = media;
    step = 'action';
  }
</script>

<div class="landing">
  <Card>
    <div class="stack">
      <h1>{locale.t.landing.title}</h1>

      {#if step === 'media'}
        <p class="muted">{locale.t.landing.mediaPrompt}</p>
        <div class="media-toggle">
          <button class="media-btn" onclick={() => selectMedia('flash')}>
            <FlashChipIcon />
            <span>{locale.t.landing.flashMemory}</span>
          </button>

          <button class="media-btn" onclick={() => selectMedia('sd')}>
            <SdCardIcon />
            <span>{locale.t.landing.sdCard}</span>
          </button>
        </div>
      {:else if step === 'action'}
        <p class="muted">{locale.t.landing.actionPrompt}</p>
        <div class="action-toggle">
          <div class="device-action-wrapper">
            <button
              class="action-btn device-btn"
              class:disabled={!webusb}
              onclick={() => onNavigate('device', device.targetMedia)}
            >
              <span class="title">{locale.t.landing.manageDevice}</span>
              {#if !webusb}
                <span class="sub">{locale.t.landing.unsupportedBrowser}</span>
              {:else if knownDevices.length === 0}
                <span class="sub">{locale.t.landing.requiresAdapter}</span>
              {/if}
            </button>
            <button
              class="advanced-link"
              onclick={(e) => { e.stopPropagation(); onNavigate('device-advanced', device.targetMedia); }}
            >
              {locale.t.landing.manageDeviceAdvanced}
            </button>
          </div>

          <div class="device-action-wrapper">
            <button
              class="action-btn games-btn"
              onclick={() => onNavigate('games', device.targetMedia)}
            >
              <span class="title">{locale.t.landing.manageGames}</span>
              <span class="sub">{locale.t.landing.romsCollection}</span>
            </button>
          </div>
        </div>

        <div style="margin-top: 1rem; text-align: center;">
          <button class="back-btn" onclick={() => { step = 'media'; }}>{locale.t.landing.back}</button>
        </div>
      {/if}
    </div>
  </Card>
</div>

<style>
  .landing {
    align-self: center;
    width: 100%;
    max-width: 720px;
  }
  h1 {
    font-size: var(--fs-display);
    margin: 0;
  }
  .muted {
    color: var(--ink-soft);
    font-size: 1.1rem;
    margin: 0 0 1rem 0;
  }
  .stack {
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
  }
  .media-toggle, .action-toggle {
    display: flex;
    gap: 1.5rem;
    justify-content: center;
  }
  .media-btn, .action-btn {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 1rem;
    padding: 2.5rem 2rem;
    border: 2px solid var(--surface-sunk);
    border-radius: var(--r-card);
    background: var(--surface);
    color: var(--ink-soft);
    cursor: pointer;
    transition: all 0.2s ease;
  }
  .device-action-wrapper {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  .action-btn {
    padding: 2rem 1.5rem;
    height: 100%;
  }
  .media-btn:hover, .action-btn:hover:not(.disabled) {
    border-color: var(--ink-soft);
    background: var(--surface-sunk);
  }
  .action-btn.disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .media-btn span {
    font-size: 1.25rem;
    font-weight: 600;
  }
  .action-btn .title {
    font-size: 1.25rem;
    font-weight: 600;
    color: var(--ink);
  }
  .action-btn .sub {
    font-size: 0.9rem;
    opacity: 0.8;
  }
  .advanced-link {
    background: none;
    border: none;
    color: var(--model-accent, var(--primary));
    font-size: 0.9rem;
    text-decoration: underline;
    cursor: pointer;
    padding: 0.25rem;
  }
  .advanced-link:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .back-btn {
    background: none;
    border: none;
    color: var(--ink-soft);
    font-size: 1rem;
    cursor: pointer;
    padding: 0.5rem 1rem;
  }
</style>
