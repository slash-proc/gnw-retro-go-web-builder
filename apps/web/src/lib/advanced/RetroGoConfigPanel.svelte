<script lang="ts">
  import { device } from "../device.svelte.js";
  import { ensureLfsTree, readLfsFile } from "../engine/lfsBrowser.js";
  import { onMount } from "svelte";
  import { loadSel, saveSel } from "../persist.js";
  import { locale } from "../i18n/locale.svelte.js";
import { deviceSafety } from "../installProgress.svelte.js";
import { writeFilesToDeviceLfs } from "../engine/lfsWrite.js";
import { readRomFile, saveFileToDirOrDownload, type RomDirHandle } from "../romScan.js";
  import {
    defaultRetroGoConfig,
    defaultRetroGoConfigForLocale,
  encodeRetroGoConfig,
    normalizeRetroGoConfig,
    parseRetroGoConfig,
    RETRO_GO_BACKLIGHT_RANGE,
    RETRO_GO_COLOR_PALETTES,
    RETRO_GO_FONT_COUNT,
    RETRO_GO_LANGUAGE_NAMES,
    RETRO_GO_MENU_TIMEOUT_RANGE,
    RETRO_GO_VOLUME_RANGE,
    sameRetroGoConfigBytes,
    type RetroGoConfigValues,
  } from "../retroGoConfig.js";

  let {
    installed = false,
    config = $bindable(defaultRetroGoConfigForLocale(locale.current)),
    configBytes = $bindable<Uint8Array | null>(null),
    configLoaded = $bindable(false),
    disabled = false,
    alwaysUse = $bindable(loadSel("retro-go-config-always-use", false)),
    medium = "flash",
    sdHandle = null,
    showControls = true,
  }: {
    installed?: boolean;
    config: RetroGoConfigValues;
    configBytes: Uint8Array | null;
    configLoaded: boolean;
    disabled?: boolean;
    alwaysUse: boolean;
    medium?: "flash" | "sd";
    sdHandle?: RomDirHandle | null;
    showControls?: boolean;
  } = $props();

  let loading = $state(false);
  let loadKey = $state("");
  let loadError = $state<string | null>(null);
  let updating = $state(false);
  let updateError = $state<string | null>(null);
  let updateSuccess = $state(false);
  let configOpen = $state(false);
  let paletteOpen = $state(false);

  onMount(() => {
    const closeOnOutsideClick = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (target && !(target as Element).closest?.(".palette-picker")) paletteOpen = false;
    };
    document.addEventListener("click", closeOnOutsideClick);
    return () => document.removeEventListener("click", closeOnOutsideClick);
  });

  $effect(() => {
    if (disabled) {
      configOpen = false;
      paletteOpen = false;
    }
  });

  function preventDisabledToggle(event: MouseEvent) {
    if (disabled) event.preventDefault();
  }

  // A recovery scan gives us the LittleFS geometry, but CONFIG itself is read lazily here so
  // simply connecting a device does not add another multi-block SWD read to every scan. SD mode
  // reads the card's CONFIG file through the selected folder handle instead.
  $effect(() => {
    const littlefs = device.partitions.find((p) => p.fs === "littlefs");
    const key = installed && !device.scanning && medium === "flash" && littlefs
      ? `flash:${device.deviceClass?.kind ?? ""}:${littlefs.offset}:${littlefs.size}`
      : installed && !device.scanning && medium === "sd" && sdHandle
        ? `sd:${sdHandle.name}`
        : "";
    if (!key) {
      updateError = null;
      updateSuccess = false;
      if (!installed || medium === "sd") {
        loadKey = "";
        config = defaultRetroGoConfigForLocale(locale.current);
        configBytes = null;
        configLoaded = true;
        loadError = null;
      }
      return;
    }
    if (key === loadKey || loading) return;
    loadKey = key;
    loading = true;
    configLoaded = false;
    loadError = null;
    updateError = null;
    updateSuccess = false;
    void (async () => {
      try {
        let bytes: Uint8Array;
        if (medium === "sd") {
          if (!sdHandle) throw new Error("SD card folder is not selected");
          const file = await readRomFile(sdHandle, "CONFIG");
          bytes = new Uint8Array(await file.arrayBuffer());
        } else {
          const tree = await ensureLfsTree();
          const file = tree.children?.find((node) => node.name === "CONFIG" && !node.isDirectory);
          if (!file) throw new Error("CONFIG was not found");
          bytes = await readLfsFile("CONFIG");
        }
        const parsed = parseRetroGoConfig(bytes);
        if (!parsed?.valid) throw new Error("CONFIG is invalid or from an unsupported version");
        config = normalizeRetroGoConfig(parsed.values);
        configBytes = bytes;
      } catch (error) {
        // A missing/old CONFIG is safe to replace with the official defaults. Keep this a quiet
        // status line because the install itself can repair it.
        config = defaultRetroGoConfigForLocale(locale.current);
        configBytes = null;
        loadError = error instanceof Error ? error.message : String(error);
      } finally {
        configLoaded = true;
        loading = false;
      }
    })();
  });

  function setValue<K extends keyof RetroGoConfigValues>(key: K, value: RetroGoConfigValues[K]) {
    updateError = null;
    updateSuccess = false;
    config = normalizeRetroGoConfig({ ...config, [key]: value });
  }

  function numberValue(event: Event): number {
    return Number((event.currentTarget as HTMLInputElement).value);
  }

  function selectNumber(event: Event): number {
    return Number((event.currentTarget as HTMLSelectElement).value);
  }

  const themeOptions = [
    "configThemeList",
    "configThemeCoverV",
    "configThemeCoverH",
    "configThemeCoverLightH",
    "configThemeCoverLightV",
  ] as const;
  const turboOptions = ["configTurboNone", "configTurboA", "configTurboB", "configTurboAB"] as const;
  const cpuOptions = ["configCpuNormal", "configCpuLevel1", "configCpuLevel2"] as const;

  function timeoutLabel(value: number): string {
    return value === 0
      ? locale.t.romSection.configMenuTimeoutOff
      : locale.t.romSection.configMinutes(Math.round(value / RETRO_GO_MENU_TIMEOUT_RANGE.step));
  }

  function restoreDefaults() {
    updateError = null;
    updateSuccess = false;
    config = defaultRetroGoConfigForLocale(locale.current);
  }

  const settingsChanged = $derived.by(() => {
    if (!installed || !configLoaded || loading) return false;
    const next = encodeRetroGoConfig(config, configBytes ?? undefined);
    const baseline = configBytes ?? encodeRetroGoConfig(defaultRetroGoConfig());
    return !sameRetroGoConfigBytes(next, baseline);
  });

  async function updateSettings() {
    if (!installed || disabled || !configLoaded || updating || !settingsChanged) return;
    updating = true;
    updateError = null;
    updateSuccess = false;
    deviceSafety.hold();
    try {
      const bytes = encodeRetroGoConfig(config, configBytes ?? undefined);
      if (medium === "sd") {
        await saveFileToDirOrDownload(sdHandle, "CONFIG", bytes);
      } else {
        await writeFilesToDeviceLfs(
          (force) => device.ensureStub(undefined, force, true, force),
          [{ path: "CONFIG", data: bytes }],
        );
      }
      configBytes = bytes;
      updateSuccess = true;
    } catch (error) {
      updateError = error instanceof Error ? error.message : String(error);
    } finally {
      deviceSafety.release();
      updating = false;
    }
  }

  function setAlwaysUse(value: boolean) {
    alwaysUse = value;
    saveSel("retro-go-config-always-use", value);
  }

</script>

{#if showControls}
<details class="config-foldout" class:config-disabled={disabled} aria-disabled={disabled} bind:open={configOpen}>
  <summary onclick={preventDisabledToggle}>
    <span class="summary-title">{locale.t.romSection.configTitle}</span>
  </summary>

  <div class="config-body">
    <p class="config-intro">{locale.t.romSection.configIntro}</p>
    {#if loading}
      <p class="config-status">{locale.t.romSection.configReading}</p>
    {:else if loadError && installed}
      <p class="config-status">{locale.t.romSection.configUsingDefaults}</p>
    {/if}
    {#if updateError}
      <p class="config-status error">{locale.t.romSection.configUpdateFailed(updateError)}</p>
    {:else if updateSuccess}
      <p class="config-status">{locale.t.romSection.configUpdatedSettings}</p>
    {/if}
    <fieldset class="config-fields" disabled={disabled}>
    <div class="config-grid">
      <label class="field range-field"><span>{locale.t.romSection.configBacklight}<output>{config.backlight}</output></span>
        <input type="range" min={RETRO_GO_BACKLIGHT_RANGE.min} max={RETRO_GO_BACKLIGHT_RANGE.max} step="1" value={config.backlight} oninput={(e) => setValue("backlight", numberValue(e))} />
      </label>
      <label class="field range-field"><span>{locale.t.romSection.configVolume}<output>{config.volume}</output></span>
        <input type="range" min={RETRO_GO_VOLUME_RANGE.min} max={RETRO_GO_VOLUME_RANGE.max} step="1" value={config.volume} oninput={(e) => setValue("volume", numberValue(e))} />
      </label>
      <label class="field"><span>{locale.t.romSection.configTheme}</span>
        <select value={config.theme} onchange={(e) => setValue("theme", selectNumber(e))}>
          {#each themeOptions as option, index}<option value={index}>{locale.t.romSection[option]}</option>{/each}
        </select>
      </label>
      <label class="field"><span>{locale.t.romSection.configColors}</span>
        <details class="palette-picker" bind:open={paletteOpen}>
          <summary class="palette-summary">
            <span>{locale.t.romSection.configColorScheme(config.colors + 1)}</span>
            <span class="swatches" aria-hidden="true">{#each RETRO_GO_COLOR_PALETTES[config.colors] as color}<i style={`background:${color}`}></i>{/each}</span>
          </summary>
          <div class="palette-options" role="listbox" aria-label={locale.t.romSection.configColors}>
            {#each RETRO_GO_COLOR_PALETTES as palette, index}
              <button type="button" role="option" aria-selected={config.colors === index} class:selected={config.colors === index} onclick={() => { setValue("colors", index); paletteOpen = false; }}>
                <span class="swatches" aria-hidden="true">{#each palette as color}<i style={`background:${color}`}></i>{/each}</span>
                <span>{locale.t.romSection.configColorScheme(index + 1)}</span>
              </button>
            {/each}
          </div>
        </details>
      </label>
      <label class="field"><span>{locale.t.romSection.configTurbo}</span>
        <select value={config.turboButtons} onchange={(e) => setValue("turboButtons", selectNumber(e))}>
          {#each turboOptions as option, index}<option value={index}>{locale.t.romSection[option]}</option>{/each}
        </select>
      </label>
      <label class="field"><span>{locale.t.romSection.configLanguage}</span>
        <select value={config.language} onchange={(e) => setValue("language", selectNumber(e))}>
          {#each RETRO_GO_LANGUAGE_NAMES as name, index}<option value={index}>{name}</option>{/each}
        </select>
      </label>
      <label class="field"><span>{locale.t.romSection.configCpuOc}</span>
        <select value={config.cpuOcLevel} onchange={(e) => setValue("cpuOcLevel", selectNumber(e))}>
          {#each cpuOptions as option, index}<option value={index}>{locale.t.romSection[option]}</option>{/each}
        </select>
      </label>
      <label class="field"><span>{locale.t.romSection.configFont}</span>
        <select value={config.font} onchange={(e) => setValue("font", selectNumber(e))}>
          {#each Array(RETRO_GO_FONT_COUNT) as _, index}<option value={index}>{locale.t.romSection.configFontOption(index + 1)}</option>{/each}
        </select>
      </label>
      <label class="field range-field"><span>{locale.t.romSection.configMenuTimeout}<output>{timeoutLabel(config.menuTimeoutS)}</output></span>
        <input type="range" min={RETRO_GO_MENU_TIMEOUT_RANGE.min} max={RETRO_GO_MENU_TIMEOUT_RANGE.max} step={RETRO_GO_MENU_TIMEOUT_RANGE.step} value={config.menuTimeoutS} oninput={(e) => setValue("menuTimeoutS", numberValue(e))} />
      </label>
    </div>
    <div class="config-actions">
      <button type="button" class="restore" onclick={restoreDefaults}>{locale.t.romSection.configRestoreDefaults}</button>
      {#if installed && (settingsChanged || updating)}
        <button type="button" class="update-settings" disabled={disabled || updating || !configLoaded || !settingsChanged} onclick={() => void updateSettings()}>
          {updating ? locale.t.romSection.configUpdatingSettings : locale.t.romSection.configUpdateSettings}
        </button>
      {/if}
      <label class="always"><input type="checkbox" checked={alwaysUse} disabled={disabled} onchange={(e) => setAlwaysUse(e.currentTarget.checked)} /> <span>{locale.t.romSection.configAlwaysUse}</span></label>
    </div>
    </fieldset>
    <p class="config-footnote">{locale.t.romSection.configPreserveNote}</p>
  </div>
</details>
{/if}

<style>
  .config-foldout {
    border: 1px solid var(--hairline);
    border-radius: 8px;
    background: color-mix(in srgb, var(--surface) 96%, var(--ink) 4%);
    overflow: hidden;
  }
  summary {
    display: flex;
    align-items: baseline;
    gap: 10px;
    padding: 12px 14px;
    cursor: pointer;
    list-style: none;
  }
  summary::-webkit-details-marker { display: none; }
  summary::before { content: "▸"; color: var(--ink-soft); transition: transform 120ms ease; }
  details[open] summary::before { transform: rotate(90deg); }
  .summary-title { font-size: var(--fs-btn-sm); font-weight: 600; }
  .config-body { border-top: 1px solid var(--hairline); padding: 14px; display: grid; gap: 14px; }
  .config-intro, .config-status, .config-footnote { margin: 0; color: var(--ink-soft); font-size: var(--fs-caption); }
  .config-status { color: var(--zelda-green); }
  .config-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
  .config-fields { display: grid; gap: 14px; margin: 0; padding: 0; border: 0; min-width: 0; }
  .config-foldout.config-disabled { opacity: 0.5; pointer-events: none; }
  .config-foldout.config-disabled > summary { cursor: not-allowed; }
  .field { display: grid; gap: 5px; color: var(--ink-soft); font-size: var(--fs-caption); }
  .range-field > span { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
  .range-field output { color: var(--ink); font-variant-numeric: tabular-nums; }
  input[type="range"] { width: 100%; min-height: 24px; padding: 0; accent-color: var(--zelda-green); }
  input, select { min-height: 32px; min-width: 0; padding: 4px 8px; border: 1px solid var(--hairline); border-radius: 5px; background: var(--surface); color: var(--ink); }
  .palette-picker { position: relative; }
  .palette-summary { min-height: 32px; box-sizing: border-box; padding: 4px 8px; border: 1px solid var(--hairline); border-radius: 5px; background: var(--surface); color: var(--ink); display: flex; align-items: center; justify-content: space-between; gap: 8px; cursor: pointer; list-style: none; }
  .palette-summary::-webkit-details-marker { display: none; }
  .palette-summary::after { content: "▾"; color: var(--ink-soft); font-size: 0.8em; }
  .palette-options { position: absolute; z-index: var(--z-popover); inset-inline: 0; top: calc(100% + 4px); max-height: 240px; overflow-y: auto; padding: 4px; border: 1px solid var(--hairline); border-radius: 5px; background: var(--surface); box-shadow: 0 5px 16px color-mix(in srgb, var(--ink) 18%, transparent); }
  .palette-options button { width: 100%; display: flex; align-items: center; gap: 9px; padding: 6px 7px; border: 0; border-radius: 4px; background: transparent; color: var(--ink); font: inherit; font-size: var(--fs-caption); text-align: start; cursor: pointer; }
  .palette-options button:hover, .palette-options button:focus-visible, .palette-options button.selected { background: var(--surface-sunk); }
  .swatches { display: inline-flex; flex: none; gap: 2px; }
  .swatches i { display: block; width: 22px; height: 18px; border: 1px solid color-mix(in srgb, var(--ink) 30%, transparent); border-radius: 2px; }
  .config-actions { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
  .restore { border: 0; padding: 0; color: var(--link); background: transparent; cursor: pointer; font-size: var(--fs-caption); }
  .update-settings { border: 1px solid var(--zelda-green); border-radius: 5px; padding: 6px 10px; background: var(--zelda-green); color: white; cursor: pointer; font-size: var(--fs-caption); }
  .update-settings:disabled { opacity: 0.55; cursor: not-allowed; }
  .always { display: flex; align-items: center; gap: 8px; font-size: var(--fs-caption); cursor: pointer; }
  .always input { min-height: auto; }
  @media (max-width: 560px) { .config-grid { grid-template-columns: 1fr; } }
</style>
