<script lang="ts">
  import { device } from "../device.svelte.js";
  import { deviceSafety } from "../installProgress.svelte.js";
  import { theme } from "../theme.svelte.js";
  import { onMount, tick } from "svelte";
  import { locale, SUPPORTED_LOCALES, isRegistered } from "../i18n/locale.svelte.js";
  import { auditLog } from "../auditLog.svelte.js";
  import ConfirmModal from "./ConfirmModal.svelte";
  import NotificationsPanel from "./NotificationsPanel.svelte";
  import DeviceControls from "./DeviceControls.svelte";
  import FlashChipIcon from "./FlashChipIcon.svelte";
  import SdCardIcon from "./SdCardIcon.svelte";
  import logoRgo from "../../assets/logo-rgo.png";
  import logoGnw from "../../assets/logo-gnw-badge.svg";

  let { showConnectButton = true, onNavigateHome }: { showConnectButton?: boolean, onNavigateHome?: () => void } = $props();

  let showMethodChangeModal = $state(false);
  let notifOpen = $state(false);

  /**
   * The panel's footer link. Routes to the Overview tab, where Activity lives, and opens the
   * section — `Advanced.svelte`'s hash listener owns the tab switch (`HASH_SEGMENT.info`), so
   * setting the hash is the whole navigation. `show()` also marks everything seen, which is
   * right here and wrong on the bell itself: the user is now looking at the full record.
   *
   * The sub-segment is required. Overview's rail is single-select and `#info` alone falls back
   * to Status (`Advanced.svelte`'s `overviewRail = hit ?? "status"`), so a bare "#info" here
   * landed the user one pane short of the Activity log they asked for.
   */
  function openActivity() {
    notifOpen = false;
    auditLog.show();
    if (location.hash !== "#info/activity") location.hash = "#info/activity";
  }

  // Hide locales that don't have a real translation registered yet — showing them would just
  // silently fall back to English with no indication anything's wrong.
  const availableLocales = SUPPORTED_LOCALES.filter((l) => isRegistered(l.code));

  // --- Language picker -------------------------------------------------------------------
  // A hand-rolled menu rather than a native `select`, for two reasons that a `select` cannot
  // both satisfy at once:
  //  1. The closed indicator must stay the short CODE ("EN") — every artboard draws it that
  //     way — while the OPEN list must show each language's own name ("Deutsch", "日本語").
  //     A native `select` closed shows the selected `option`'s own text, so one control cannot
  //     render two different strings for the same choice without hiding the select's text
  //     behind an overlay (fragile: it fights UA `text-align-last`/RTL/zoom handling and still
  //     leaves the popup itself UA-painted).
  //  2. The popup of a native `select` is drawn by the browser, not by this stylesheet, so the
  //     app's dark tokens never reached it — see the .lang-menu comment in the style block below.
  // Follows DeviceControls.svelte's menu pattern (trigger button + absolutely-positioned menu,
  // document-click to dismiss); this one adds full keyboard operation, which the `select` gave
  // for free and must not be lost.
  let langOpen = $state(false);
  let langMenu = $state<HTMLDivElement | null>(null);
  let langBtn = $state<HTMLButtonElement | null>(null);
  let typeBuf = "";
  let typeTimer: ReturnType<typeof setTimeout> | undefined = undefined;

  function langItems(): HTMLButtonElement[] {
    return langMenu ? Array.from(langMenu.querySelectorAll<HTMLButtonElement>(".lang-item")) : [];
  }
  function focusItem(i: number) {
    const items = langItems();
    if (!items.length) return;
    items[((i % items.length) + items.length) % items.length].focus();
  }
  // "current" mirrors a native select, which opens with the active choice highlighted.
  async function openLang(where: "current" | "first" | "last" = "current") {
    langOpen = true;
    await tick();
    const items = langItems();
    const cur = availableLocales.findIndex((l) => l.code === locale.current);
    focusItem(where === "last" ? items.length - 1 : where === "first" || cur < 0 ? 0 : cur);
  }
  function closeLang(refocus = true) {
    langOpen = false;
    typeBuf = "";
    if (refocus) langBtn?.focus();
  }
  function pickLang(code: (typeof SUPPORTED_LOCALES)[number]["code"]) {
    locale.set(code);
    closeLang();
  }
  function onTriggerKey(e: KeyboardEvent) {
    if (e.key === "ArrowDown") { e.preventDefault(); void openLang("first"); }
    else if (e.key === "ArrowUp") { e.preventDefault(); void openLang("last"); }
  }
  function onMenuKey(e: KeyboardEvent) {
    const items = langItems();
    const i = items.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === "ArrowDown") { e.preventDefault(); focusItem(i + 1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); focusItem(i - 1); }
    else if (e.key === "Home") { e.preventDefault(); focusItem(0); }
    else if (e.key === "End") { e.preventDefault(); focusItem(items.length - 1); }
    else if (e.key === "Escape") { e.preventDefault(); closeLang(); }
    else if (e.key === "Tab") { closeLang(false); }
    else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      // Type-ahead, the one `select` affordance worth reproducing: matches either the language's
      // own name or its code, so both "de"/"DE" and "Deu" land on Deutsch.
      typeBuf += e.key.toLowerCase();
      if (typeTimer) clearTimeout(typeTimer);
      typeTimer = setTimeout(() => (typeBuf = ""), 700);
      const hit = availableLocales.findIndex(
        (l) => l.label.toLowerCase().startsWith(typeBuf) || l.code.toLowerCase().startsWith(typeBuf),
      );
      if (hit >= 0) focusItem(hit);
    }
  }
  onMount(() => {
    const onDocClick = (e: MouseEvent) => {
      const el = e.target as HTMLElement;
      if (!el.closest(".lang-picker")) langOpen = false;
      // Same dismissal rule as the language menu, one control over: a click anywhere outside
      // the indicator closes the panel, including on the bell itself (which toggles).
      if (!el.closest(".log-indicator")) notifOpen = false;
    };
    document.addEventListener("click", onDocClick);
    return () => {
      document.removeEventListener("click", onDocClick);
      if (typeTimer) clearTimeout(typeTimer);
    };
  });

  const connect = (force = false) =>
    device.connect(undefined, force ? { forcePicker: true } : undefined).catch(() => {});

  const scanned = $derived(device.banks.length > 0);
  const isRetroGo = $derived(
    device.deviceClass?.kind === "retrogo-sd" || device.deviceClass?.kind === "retrogo-old",
  );

  // The console chip is a state light, not just a connection light: HeaderBusy.dc.html shows it
  // amber and throbbing while a write is in flight, so a flash can't look "calm green". Same
  // deviceSafety store as App.svelte's lip (installProgress.svelte.ts) — a pure consumer, it
  // decides nothing about when a write is in flight and adds no second source of truth. A lost
  // or absent connection still wins, exactly as `statusText` below resolves it: there is no
  // "don't disconnect" state once the device is already gone.
  const statusColor = $derived(
    !device.isConnected
      ? "red"
      : deviceSafety.unsafe
        ? "amber"
        : device.utilLoaded
          ? "green"
          : "yellow",
  );
  // During a write the status line carries the do-not-disconnect wording (HeaderBusy artboard),
  // which is why the lip could stop being a text banner. Same deviceSafety store as App.svelte's
  // lip — one source of truth, this is a pure consumer. A lost or absent connection still wins:
  // "do not disconnect" is meaningless once the device is already gone.
  const statusText = $derived(
    device.connection === "lost"
      ? locale.t.deviceHeader.connectionLost
      : !device.isConnected
        ? locale.t.deviceHeader.noConnection
        : deviceSafety.state === "writing"
          ? locale.t.deviceHeader.unsafeWritingStatus
        : deviceSafety.state === "settling"
            ? locale.t.deviceHeader.unsafeSettlingStatus
        : device.utilLoaded
        ? locale.t.deviceHeader.connectedRecoveryMode
        : device.runtimeKind === "retro-go"
          ? locale.t.deviceHeader.connectedAs(
              device.retroGoActivity ? `Retro-Go - ${device.retroGoActivity}` : "Retro-Go",
            )
          : device.runtimeKind === "stock-ofw"
            ? locale.t.deviceHeader.connectedAs(locale.t.deviceHeader.stock)
            : device.runtimeKind === "bootloader"
              ? locale.t.deviceHeader.connectedAs("Bootloader")
              : device.runtimeKind === "recovery"
                ? locale.t.deviceHeader.connectedRecoveryMode
        : device.runtimeKind === "unknown"
          ? locale.t.deviceHeader.connected
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

  // The do-not-disconnect signal lives in App.svelte's single face-plate lip, which swaps its
  // fill on deviceSafety. This component renders no lip of its own — two components owning one
  // 3px row is how the header ended up stacking two of them (audit finding 5.7).
</script>

<header class="band" class:busy={deviceSafety.unsafe}>
  <!-- Main.dc.html:22 draws this band with exactly TWO children: the content group hard against
       the 40px left padding, and the right-hand group hard against the right. There is NO empty
       left spacer — one used to live here and, with `justify-content: space-between` and three
       children, it pushed the content group into the MIDDLE of the band on every connected
       screen. Landing1.dc.html:21 draws the never-connected header as `justify-content:
       flex-end` with the right group alone; that still resolves correctly here, because
       `.header-right` carries `flex: 1` and right-aligns its own contents, so as the band's only
       child it fills the width and lands flush right. Do not reintroduce a spacer div. -->

  {#if showConnectButton}
    <div class="overview-line">
      <button class="home-btn" onclick={() => showMethodChangeModal = true} title={locale.t.deviceHeader.changeInstallationMethod}>
        {#if device.targetMedia === 'sd'}
          <SdCardIcon size={19} strokeWidth={1.3} />
        {:else}
          <FlashChipIcon size={19} strokeWidth={1.3} />
        {/if}
      </button>

      <!-- HeaderBusy/Main.dc.html:28 pair the console chip and its status word in their own
           group at `gap: 11px`, sitting `gap: 13px` from the media icon and the dividers. -->
      <span class="statusgroup">
        <DeviceControls {statusColor} />
        <strong class="status">{statusText}</strong>
      </span>

      {#if device.isConnected || device.everConnected}
        <span class="divider"></span>

        <!-- Two independent install-state slots in BANK ORDER: stock firmware (bank 1) first,
             then Retro-Go (bank 2). Each slot dims as a whole (logo + value) when its side is
             not installed — the artboards dim the pair symmetrically, not just one side. -->
        <span class="slot" class:dim={scanned && !ofw}>
          <img class="logo-key logo-key-gnw" src={logoGnw} alt={locale.t.deviceHeader.logoOfwAlt} />
          <span class="val ofw">{ofwText}</span>
        </span>

        <span class="divider"></span>

        <span class="slot" class:dim={scanned && !isRetroGo}>
          <img class="logo-key" src={logoRgo} alt={locale.t.deviceHeader.logoRgoAlt} />
          <span class="val" class:mono={scanned && !device.scanning && isRetroGo}>{retroGoStatus}</span>
        </span>
      {/if}
    </div>
  {/if}

  <div class="header-right">
    <!-- THE NOTIFICATION INDICATOR (`auditLog.svelte.ts`, `overview-v2/Notifications.dc.html`).
         ERRORS ONLY, list and count alike — `auditLog.notifications` is the single rule. A
         converter's crop warning is a note: it belongs in Activity and never rings here.

         Opening the panel does NOT mark everything seen. That was the old behaviour when the
         click had nowhere to go and could only acknowledge; now the panel lists exactly the
         unattended errors, so clearing them on open would empty the thing the user just opened.
         Dismissal is explicit: a per-row control, or the footer's Clear. -->
    <div class="log-indicator">
      <button
        class="icon log-btn"
        type="button"
        title={locale.t.shared.auditLog.notificationsTitle}
        aria-label={locale.t.shared.auditLog.notificationsTitle}
        aria-haspopup="dialog"
        aria-expanded={notifOpen}
        onclick={() => (notifOpen = !notifOpen)}
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" /><line x1="8" y1="18" x2="21" y2="18" />
          <line x1="3" y1="6" x2="3.01" y2="6" /><line x1="3" y1="12" x2="3.01" y2="12" /><line x1="3" y1="18" x2="3.01" y2="18" />
        </svg>
        {#if auditLog.unattended > 0}
          <span class="log-badge">{auditLog.unattended}</span>
        {/if}
      </button>
      {#if notifOpen}
        <NotificationsPanel onOpenActivity={openActivity} />
      {/if}
    </div>
    <div class="lang-picker">
      <button
        class="icon lang-btn"
        bind:this={langBtn}
        type="button"
        title={locale.t.deviceHeader.toggleLanguage}
        aria-label={locale.t.deviceHeader.toggleLanguageAria}
        aria-haspopup="menu"
        aria-expanded={langOpen}
        onclick={() => (langOpen ? closeLang(false) : void openLang())}
        onkeydown={onTriggerKey}
      >{locale.current.toUpperCase()}</button>

      {#if langOpen}
        <!-- The list shows each language's ENDONYM (its own name in its own script), straight
             from SUPPORTED_LOCALES. Those are proper nouns, not translatable copy, so they never
             go through the i18n tables; `lang=` on each row tells the browser (and a screen
             reader) which language that text actually is. The trigger keeps the short code. -->
        <div
          class="lang-menu"
          role="menu"
          tabindex="-1"
          bind:this={langMenu}
          aria-label={locale.t.deviceHeader.toggleLanguageAria}
          onkeydown={onMenuKey}
        >
          {#each availableLocales as l (l.code)}
            <button
              class="lang-item"
              type="button"
              role="menuitemradio"
              aria-checked={l.code === locale.current}
              lang={l.code}
              onclick={() => pickLang(l.code)}
            >
              <span class="lang-name">{l.label}</span>
              <span class="lang-code">{l.code.toUpperCase()}</span>
            </button>
          {/each}
        </div>
      {/if}
    </div>
    <button class="theme-btn" onclick={() => theme.toggle()} title={locale.t.deviceHeader.toggleTheme} aria-label={locale.t.deviceHeader.toggleThemeAria}>
      {#if theme.mode === "dark"}
        <!-- No artboard draws the dark-theme state (all mockups are light-only), so the existing
             glyph is kept rather than inventing a second icon. Open owner question. -->
        ☀
      {:else}
        <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M16 12.5A7 7 0 0 1 7.5 4a7 7 0 1 0 8.5 8.5z"></path>
        </svg>
      {/if}
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
    color: var(--ink);
    /* HeaderBusy.dc.html / RomsNewSystem.dc.html: `height: 56px; padding: 0 40px`. The side
       padding is the artboard's; the height is written as a min-height so a longer status line
       in another locale grows the band rather than overflowing it, with the vertical padding
       kept as slack. At every shipped string length it resolves to exactly 56px. */
    min-height: 56px;
    padding: 0.45rem 40px;
    flex-wrap: nowrap;
    background: var(--surface);
  }
  /* HeaderBusy.dc.html: while a write is in flight the band itself goes #ffffff -> #fdf8ec and
     the status line to #8a6508/700. Pure presentation off deviceSafety — no second source of
     truth, and no layout change, so nothing moves when a write starts or ends. */
  .band.busy {
    background: var(--band-busy);
  }
  .band.busy .status {
    color: var(--band-busy-ink);
    font-weight: 700;
  }
  .header-right {
    display: flex;
    align-items: center;
    gap: 0.7rem;
    /* `flex: 1` is what right-aligns this group in BOTH cases: beside the content group it
       absorbs the slack between them, and alone (landing) it spans the band so its own
       `justify-content: flex-end` puts the controls on the right edge. */
    flex: 1;
  }
  .header-right {
    justify-content: flex-end;
    /* HeaderBusy.dc.html right group: `gap: 18px`. */
    gap: 18px;
  }
  /* Overview Line */
  .overview-line {
    display: flex;
    align-items: center;
    /* Main.dc.html:23 — the band's left-hand content group runs at `gap: 13px`. */
    gap: 13px;
    flex-shrink: 0;
  }
  /* Main.dc.html:28 — the chip and its status word are one group at `gap: 11px`. */
  .statusgroup {
    display: inline-flex;
    align-items: center;
    gap: 11px;
  }
  /* HeaderBusy.dc.html: `width: 1px; height: 18px; background: #d8d8d8; margin: 0 3px`. */
  .divider {
    width: 1px;
    height: 18px;
    background: var(--hairline);
    margin: 0 3px;
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
    color: var(--ink);
  }
  /* Main.dc.html:42 — logo + value inside an install-state slot sit at `gap: 8px`. */
  .slot {
    display: inline-flex;
    align-items: center;
    gap: 8px;
  }
  .dim {
    opacity: 0.42;
  }

  /* HeaderBusy.dc.html draws the Retro-Go version as `13px/600 ui-monospace`. Applied only when
     the slot actually holds a version string — the artboard never draws the placeholder states
     ("Scanning…", "—", "Not installed"), which stay in the sans face. */
  .mono {
    font-family: var(--font-mono);
    font-size: var(--fs-btn-sm);
  }

  /* Home/change-installation-method button.
     Deliberately NOT styled like a button (no background/border/shadow chrome) — matches the
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
    color: var(--ink);
    cursor: pointer;
  }
  .home-btn:hover {
    opacity: 0.7;
  }

  /* Right Side Controls.
     Every artboard — Main / HeaderBusy / FlashFailure / Landing1 / Landing2 and the rest —
     draws the language control as bare text, `12px/500 #5c5c5c`, with no cap, border, shadow
     or native select arrow: the same chrome-less treatment as the theme crescent beside it.
     The silver capped-button styling it used to carry is drawn by no board. */
  .log-indicator { position: relative; display: inline-flex; }
  /* The badge is drawn INSIDE the button, not as a sibling over it. It overhangs the
     button's box, but an absolutely positioned descendant is still hit-tested as part of
     its ancestor button (nothing here sets overflow: hidden), so the number is clickable
     and the count no longer punches a dead spot through the bell's own corner. As a
     sibling span it swallowed every click that landed on it. */
  .log-btn { position: relative; display: inline-flex; align-items: center; justify-content: center; padding: 0; }
  .log-badge {
    position: absolute;
    top: -4px;
    inset-inline-end: -5px;
    min-width: 15px;
    height: 15px;
    padding: 0 4px;
    box-sizing: border-box;
    border-radius: 8px;
    background: var(--danger);
    color: #fff;
    font-size: 10px;
    font-weight: 700;
    line-height: 15px;
    text-align: center;
  }
  .icon {
    font: inherit;
    background: none;
    border: none;
    box-shadow: none;
    border-radius: 0;
    color: var(--ink-soft);
    cursor: pointer;
    line-height: 1;
  }
  /* The closed indicator. Paint unchanged from the `select` this replaced (9e0f750): bare,
     chrome-less, --fs-micro/500 --ink-soft via .icon, centred, no border/background/arrow. */
  .lang-btn {
    appearance: none;
    -webkit-appearance: none;
    width: auto;
    padding: 0;
    font-size: var(--fs-micro);
    font-weight: 500;
    text-align: center;
  }
  .lang-picker {
    position: relative;
    display: inline-block;
  }
  /* Why this exists at all: the old native `select` popup was painted by the browser, not by
     this stylesheet. `.icon` gives the control `background: none` (transparent) and
     `color: var(--ink-soft)`, and the `option`s carried no rules whatsoever — so in dark theme
     Chromium composited the popup on its own light popup ground while the options inherited the
     author `color` #9b9b9b, i.e. pale grey text on near-white: roughly 2.5:1, unreadable. (The
     :root `color-scheme: dark` cannot rescue it — an author-declared `color` on the select wins
     for the option text, and a transparent author background is not a dark one.) Painting the
     list ourselves removes the UA from the loop entirely: both surfaces below are app tokens,
     so the menu tracks whichever theme block in tokens.css is live. Same shape as
     DeviceControls.svelte's .dropdown-menu, but anchored to the INLINE END — this control sits
     on the band's trailing edge, so a start-anchored menu would hang off the viewport. Logical
     rather than `right`, because in an RTL locale the whole band mirrors and the trailing edge
     is the left one. */
  .lang-menu {
    position: absolute;
    top: 100%;
    inset-inline-end: 0;
    margin-top: 0.5rem;
    min-width: 168px;
    max-height: 60vh;
    overflow-y: auto;
    background: var(--surface);
    border: 1px solid var(--hairline);
    border-radius: var(--r-card);
    box-shadow: var(--shadow-card, 0 4px 12px rgba(0, 0, 0, 0.15));
    z-index: var(--z-popover);
    padding: 0.4rem 0;
    display: flex;
    flex-direction: column;
    text-align: start;
  }
  .lang-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    width: 100%;
    padding: 0.4rem 0.85rem;
    background: none;
    border: none;
    text-align: start;
    color: var(--ink);
    font: inherit;
    font-size: var(--fs-caption);
    cursor: pointer;
  }
  .lang-item:hover {
    background: var(--surface-sunk);
  }
  .lang-item:focus-visible {
    outline: 2px solid var(--model-accent);
    outline-offset: -2px;
  }
  .lang-item[aria-checked="true"] .lang-name {
    font-weight: 700;
  }
  .lang-code {
    font-size: var(--fs-micro);
    font-weight: 500;
    color: var(--ink-soft);
    font-variant-numeric: tabular-nums;
  }
  .icon:hover {
    color: var(--ink);
  }
  .icon:focus-visible {
    outline: 2px solid var(--model-accent);
    outline-offset: 2px;
  }
  /* HeaderBusy.dc.html: a bare 16px stroked crescent in #5c5c5c — no cap, border or shadow.
     Not `.icon`, which the language control uses; both are chrome-less now (9e0f750 removed
     the silver cap), but the crescent needs the flex centring the select does not. */
  .theme-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: none;
    border: none;
    padding: 0;
    font: inherit;
    line-height: 1;
    color: var(--ink-soft);
    cursor: pointer;
  }
  .theme-btn:hover {
    color: var(--ink);
  }
  .theme-btn:focus-visible {
    outline: 2px solid var(--model-accent);
    outline-offset: 2px;
  }
  .band :global(.btn.quiet) {
    color: var(--ink);
    text-decoration-color: var(--ink);
  }
</style>
