<script lang="ts">
  import { device } from "../device.svelte.js";
  import { theme } from "../theme.svelte.js";
  import { locale, SUPPORTED_LOCALES, isRegistered } from "../i18n/locale.svelte.js";
  import ConfirmModal from "./ConfirmModal.svelte";
  import DeviceControls from "./DeviceControls.svelte";
  import FlashChipIcon from "./FlashChipIcon.svelte";
  import SdCardIcon from "./SdCardIcon.svelte";
  import logoRgo from "../../assets/logo-rgo.png";
  import logoGnw from "../../assets/logo-gnw-badge.svg";

  let { showConnectButton = true, onNavigateHome }: { showConnectButton?: boolean, onNavigateHome?: () => void } = $props();

  let showMethodChangeModal = $state(false);

  // Hide locales that don't have a real translation registered yet — showing them would just
  // silently fall back to English with no indication anything's wrong.
  const availableLocales = SUPPORTED_LOCALES.filter((l) => isRegistered(l.code));

  const connect = (force = false) =>
    device.connect(undefined, force ? { forcePicker: true } : undefined).catch(() => {});

  const scanned = $derived(device.banks.length > 0);
  const isRetroGo = $derived(
    device.deviceClass?.kind === "retrogo-sd" || device.deviceClass?.kind === "retrogo-old",
  );

  const statusColor = $derived(
    !device.isConnected ? "red" : device.utilLoaded ? "green" : "yellow",
  );
  const statusText = $derived(
    device.connection === "lost"
      ? locale.t.deviceHeader.connectionLost
      : !device.isConnected
        ? locale.t.deviceHeader.noConnection
        : device.utilLoaded
        ? locale.t.deviceHeader.connectedRecoveryMode
        : isRetroGo
          ? locale.t.deviceHeader.connectedRetroGo
          : device.deviceClass
            ? locale.t.deviceHeader.connectedAs(device.deviceClass.label)
            : locale.t.deviceHeader.connected,
  );

  // FrogFS presence is a Flash-mode concept (extflash content) — it must never influence SD
  // mode's status text. A device set to SD can have leftover/orphaned FrogFS+LittleFS
  // partitions from a prior Flash install; that's irrelevant to whether SD's own retro-go
  // intflash image is installed. Same rule as RomManagementTab's shared table (CLAUDE.md:
  // "SD mode vs Flash mode share UI, not budget logic" — this bit us once already there).
  const frogfsPresent = $derived(
    device.targetMedia !== "sd" && device.partitions.some((p) => p.fs === "frogfs"),
  );

  const retroGoStatus = $derived(
    device.scanning
      ? locale.t.deviceHeader.scanning
      : !scanned
        ? locale.t.deviceHeader.dash
        : isRetroGo
          ? device.deviceClass!.label.replace(/^Retro-Go\s*(SD\s*)?/, "") // version + our -flash/-sd suffix only, no "SD" fork name
          : frogfsPresent
            ? locale.t.deviceHeader.patchMissing
            : locale.t.deviceHeader.notInstalled,
  );
  const ofw = $derived(device.deviceClass?.ofw ?? null);
  const ofwText = $derived(
    device.scanning
      ? locale.t.deviceHeader.scanning
      : !scanned
        ? locale.t.deviceHeader.dash
        : ofw
          ? locale.t.deviceHeader.ofwLabel(
              ofw.model === "mario" ? locale.t.deviceHeader.mario : locale.t.deviceHeader.zelda,
              ofw.patched ? locale.t.deviceHeader.patched : locale.t.deviceHeader.stock,
            )
          : locale.t.deviceHeader.none,
  );
</script>

<header class="band">
  <div class="header-left">
    {#if !device.isConnected && !device.everConnected}
      <span class="dot {device.connection}" title={device.connection} aria-hidden="true"></span>
    {/if}
  </div>

  {#if showConnectButton}
    <div class="overview-line">
      <button class="home-btn" onclick={() => showMethodChangeModal = true} title={locale.t.deviceHeader.changeInstallationMethod}>
        {#if device.targetMedia === 'sd'}
          <SdCardIcon size={18} />
        {:else}
          <FlashChipIcon size={18} />
        {/if}
      </button>

      <DeviceControls {statusColor} />

      <strong class="status">{statusText}</strong>

      {#if device.isConnected || device.everConnected}
        <span class="divider"></span>

        <img class="logo-key" src={logoRgo} alt={locale.t.deviceHeader.logoRgoAlt} />
        <span class="val">{retroGoStatus}</span>

        <span class="divider"></span>

        <img class="logo-key logo-key-gnw" src={logoGnw} alt={locale.t.deviceHeader.logoOfwAlt} />
        <span class="val ofw" class:dim={!ofw}>{ofwText}</span>
      {/if}
    </div>
  {/if}

  <div class="header-right">
    <select
      class="icon lang-select"
      title={locale.t.deviceHeader.toggleLanguage}
      aria-label={locale.t.deviceHeader.toggleLanguageAria}
      value={locale.current}
      onchange={(e) => locale.set(e.currentTarget.value as typeof locale.current)}
    >
      {#each availableLocales as l (l.code)}
        <option value={l.code}>{l.label}</option>
      {/each}
    </select>
    <button class="icon" onclick={() => theme.toggle()} title={locale.t.deviceHeader.toggleTheme} aria-label={locale.t.deviceHeader.toggleThemeAria}>
      {theme.mode === "dark" ? "☀" : "☾"}
    </button>
  </div>
</header>

{#if showMethodChangeModal}
  <ConfirmModal
    open={true}
    title={locale.t.deviceHeader.changeMethodTitle}
    body={locale.t.deviceHeader.changeMethodBody}
    confirmText={locale.t.deviceHeader.changeMethodConfirm}
    run={async () => {
      showMethodChangeModal = false;
      device.disconnect();
      if (onNavigateHome) onNavigateHome();
    }}
    onClose={() => (showMethodChangeModal = false)}
  />
{/if}

<style>
  .band {
    /* Shared control height — the Sync button and the Official Firmware badge logo both key
       off this so they stay an exact match, not an eyeballed guess. */
    --header-control-h: 1.7rem;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.7rem;
    color: #161616;
    padding: 0.45rem 1.25rem;
    flex-wrap: nowrap;
  }
  .header-left, .header-right {
    display: flex;
    align-items: center;
    gap: 0.7rem;
    flex: 1;
  }
  .header-right {
    justify-content: flex-end;
  }
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

  
  /* Overview Line */
  .overview-line {
    display: flex;
    align-items: center;
    gap: 0.45rem;
    flex-shrink: 0;
  }
  .divider {
    width: 1px;
    height: 14px;
    background: rgba(0,0,0,0.15);
    margin: 0 0.2rem;
  }
  .key {
    font-size: var(--fs-caption);
    color: rgba(26, 23, 20, 0.55);
  }
  .logo-key {
    height: 14px;
    width: auto;
    display: inline-block;
    flex-shrink: 0;
  }
  .logo-key-gnw {
    height: var(--header-control-h);
  }
  .val, .status {
    font-size: var(--fs-caption);
    font-weight: 600;
    color: #161616;
  }
  .dim {
    opacity: 0.4;
  }

  .mono {
    font-family: var(--font-mono);
  }

  /* Home/change-installation-method button — same square icon-button visual language as
     DeviceControls.svelte's .gw-icon-btn (silver bg, thin dark border, inset highlight) so
     the two sit consistently side by side at the start of the overview line. */
  /* Deliberately NOT styled like a button (no background/border/shadow chrome) — matches the
     device's actual current media (flash chip vs. SD card) at a glance, and its height must
     equal DeviceControls' .gw-icon-btn exactly (same --header-control-h) so both sit on the
     same vertical center within .overview-line's flex row. */
  .home-btn {
    box-sizing: border-box;
    height: var(--header-control-h, 1.7rem);
    width: var(--header-control-h, 1.7rem);
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    background: none;
    border: none;
    color: #161616;
    cursor: pointer;
  }
  .home-btn:hover {
    opacity: 0.7;
  }

  /* Right Side Controls */
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
  /* Language names vary a lot in width (e.g. "简体中文" vs "Українська") — a fixed square
     icon button doesn't fit a select's own text, so this one sizes to content instead. */
  .lang-select {
    width: auto;
    min-width: 1.9rem;
    padding: 0 0.4rem;
    font-size: var(--fs-micro);
    text-align: center;
    text-align-last: center;
  }
  .icon:hover {
    filter: brightness(0.97);
  }
  .band :global(.btn.quiet) {
    color: #161616;
    text-decoration-color: #161616;
  }
</style>
