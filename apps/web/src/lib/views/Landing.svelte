<script lang="ts">
  import { device } from "../device.svelte.js";
  import FlashChipIcon from "../ui/FlashChipIcon.svelte";
  import SdCardIcon from "../ui/SdCardIcon.svelte";
  import { locale } from "../i18n/locale.svelte.js";
  import { loadSel, saveSel } from "../persist.js";
  import { onMount } from "svelte";

  let { onNavigate, resetToMedia = false }: {
    onNavigate: (target: 'device' | 'device-advanced' | 'games', media: 'flash' | 'sd') => void;
    resetToMedia?: boolean;
  } = $props();

  const webusb = typeof navigator !== "undefined" && !!navigator.usb;
  let knownDevices = $state<USBDevice[]>([]);
  let step = $state<'media' | 'action'>('media');

  onMount(() => {
    // Keep the entry wizard on its second step after the user has chosen Flash or SD.
    // This restores presentation only: adapter discovery still starts exclusively from
    // handleNavigate(), after the user chooses an action on this step.
    if (!resetToMedia && loadSel("landing-media-chosen", false)) step = 'action';
    if (webusb) {
      navigator.usb.getDevices().then(devs => knownDevices = devs).catch(() => {});
    }
  });

  function selectMedia(media: 'flash' | 'sd') {
    device.targetMedia = media;
    saveSel("landing-media-chosen", true);
    step = 'action';
  }
</script>

<!-- Landing1 / Landing2 artboards. The entry wizard sits on the grey page ground: no outer
     card, no rules. Each step is progress pips, a title, a grey rubric line, and the choices
     themselves; only the choice cards take a border, because a choice is a real object. -->
<div class="landing">
  <div class="head">
    <!-- The two-step entry is ONE flow: the pips are what say so (Landing1/Landing2). -->
    <div class="pips" aria-hidden="true">
      <span class="pip" class:on={step === 'media'}></span>
      <span class="pip" class:on={step === 'action'}></span>
    </div>
    <h1>{step === 'media' ? locale.t.landing.title1 : locale.t.landing.title2}</h1>
    <p class="rubric">{step === 'media' ? locale.t.landing.mediaPrompt : locale.t.landing.actionPrompt}</p>
  </div>

  <!-- BOTH steps' choice rows live in the SAME grid cell, and this is what stops the cards
       moving. They are separately sized boxes whose height follows their own copy: step 2's
       "Backup, patch, install firmware. Requires an adapter." is two sentences in every locale
       and wraps to a second line, while step 1's one-sentence sub fits on one line in some
       languages and not others. So in en/ko/pt/ru the two steps differed by exactly one line
       and the vertically centred column moved; in de/fr/es both wrapped and it did not. That is
       the owner's own observation: the shift appears when a language does NOT wrap on the first
       card. Overlaying the two rows makes the stage as tall as the TALLER of the two real rows,
       measured from the real text at the real width, so it follows any translation, any zoom and
       any future copy change -- the same reasoning that made the footer hold its real control's
       real box rather than a hardcoded height. It also absorbs the third difference: the extra
       `unsupportedBrowser` line on a browser without WebUSB is inside a box step 1 now reserves
       too. `visibility: hidden` keeps the held row out of the a11y tree and the tab order;
       `disabled` is belt and braces so a held card's handler cannot fire. -->
  <div class="choices-stage">
    <div class="choices" class:held={step !== 'media'}>
      <button class="choice" disabled={step !== 'media'} onclick={() => selectMedia('flash')}>
        <!-- Landing1 strokes both step-1 glyphs in full ink (#1b1b1b), not the card's
             grey body colour, so they carry their own colour rather than inheriting. -->
        <span class="icon-ink"><FlashChipIcon size={26} /></span>
        <span class="text">
          <span class="label">{locale.t.landing.flashMemory}</span>
          <span class="sub">{locale.t.landing.flashMemoryDesc}</span>
        </span>
      </button>

      <button class="choice" disabled={step !== 'media'} onclick={() => selectMedia('sd')}>
        <span class="icon-ink"><SdCardIcon size={26} /></span>
        <span class="text">
          <span class="label">{locale.t.landing.sdCard}</span>
          <span class="sub">{locale.t.landing.sdCardDesc}</span>
        </span>
      </button>
    </div>

    <!-- The re-synced Landing2 (31cc2f7) deletes the "Modded with … / Change" recall row
         outright; the ← Back line below is the only way back to step 1. -->
    <div class="choices" class:held={step !== 'action'}>
      <!-- `disabled` is the guarantee, not the class: `class:disabled` only greyed the card,
           so on a browser without WebUSB it stayed clickable and focusable and dropped the
           user on a device screen that can never connect. The class still carries the LOOK,
           and `pointer-events: none` stops the hover affordance a disabled button keeps. -->
      <button
        class="choice"
        class:disabled={!webusb}
        disabled={!webusb || step !== 'action'}
        onclick={() => onNavigate('device', device.targetMedia)}
      >
        <!-- Landing2 draws an icon on both action cards: the chosen media, tinted green, on
             "Manage device". The glyph components are the same ones step 1 uses. -->
        <span class="icon-green">
          {#if device.targetMedia === 'sd'}
            <SdCardIcon size={26} />
          {:else}
            <FlashChipIcon size={26} />
          {/if}
        </span>
        <span class="text">
          <span class="label">{locale.t.landing.manageDevice}</span>
          <span class="sub">{locale.t.landing.manageDeviceDesc}</span>
          {#if !webusb}
            <span class="sub">{locale.t.landing.unsupportedBrowser}</span>
          {/if}
        </span>
      </button>

      <button class="choice" disabled={step !== 'action'} onclick={() => onNavigate('games', device.targetMedia)}>
        <!-- Landing2's gamepad glyph, drawn exactly as the artboard's inline SVG. -->
        <svg
          class="pad-icon"
          width="26" height="26" viewBox="0 0 20 20"
          fill="none" stroke="currentColor" stroke-width="1.2"
          stroke-linecap="round" stroke-linejoin="round"
          aria-hidden="true"
        >
          <rect x="2.5" y="4.5" width="15" height="11" rx="1.6" />
          <path d="M6 8v4M4 10h4" />
          <circle cx="13.5" cy="9.5" r="1" />
          <circle cx="15.5" cy="11.5" r="1" />
        </svg>
        <span class="text">
          <span class="label">{locale.t.landing.manageLibrary}</span>
          <span class="sub">{locale.t.landing.manageLibraryDesc}</span>
        </span>
      </button>
    </div>
  </div>

  <!-- The footer sits OUTSIDE the step branch on purpose, and this is load-bearing.
       `App.svelte`'s `.landing` centres this column vertically (`justify-content: safe
       center`), so a column that grows taller has its top edge pushed UP: adding these two
       links on step 2 moved the choice cards, which is the shift that was reported.
       Landing1 already draws the back row on step 1, empty (Landing1.dc.html:41 is the same
       `space-between` row Landing2.dc.html:41 puts `← Back` into), so a persistent row is the
       artboards' own idiom, not an invention. The advanced link is held the same way.
       `visibility: hidden` reserves the REAL control's REAL box without drawing it or exposing
       it (it leaves the a11y tree and the tab order), so the space held is exactly the space
       the link will need -- including when a longer translation wraps to a second line at
       narrow widths, which a hardcoded height could not follow. `disabled` is belt and braces
       so the handler cannot fire even if the box is somehow reached. -->
  <!-- Landing2 puts this BELOW both cards as a quiet grey line, not inside either column. -->
  <button
    class="advanced-link"
    class:held={step !== 'action'}
    disabled={step !== 'action'}
    onclick={() => onNavigate('device-advanced', device.targetMedia)}
  >
    {locale.t.landing.manageDeviceAdvanced}
  </button>

  <div class="backrow">
    <button
      class="back-btn"
      class:held={step !== 'action'}
      disabled={step !== 'action'}
      onclick={() => { step = 'media'; }}
    >{locale.t.landing.back}</button>
  </div>
</div>

<style>
  .landing {
    align-self: center;
    width: 100%;
    /* Landing1/Landing2 put the column at `grid-column: 4 / span 6` of the 12-column body:
       inside --maxw 1360 less 2x40px sides, with 32px gutters, that is exactly 664px
       (6 x 84 + 5 x 32), not the 620 this carried. */
    max-width: 664px;
    display: flex;
    flex-direction: column;
    gap: 28px;
  }
  .head {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .pips {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .pip {
    width: 6px;
    height: 6px;
    border-radius: 3px;
    background: var(--hairline);
  }
  .pip.on {
    width: 22px;
    background: var(--zelda-green);
  }
  h1 {
    font-size: var(--fs-display-lg);
    font-weight: 600;
    letter-spacing: -0.02em;
    line-height: 1.15;
    margin: 0;
  }
  /* A sentence, not a small-caps rubric: the artboards run a plain grey line under the title. */
  .rubric {
    margin: 0;
    font-size: var(--fs-lede);
    color: var(--ink-soft);
  }
  /* The stage is one grid CELL holding both steps' rows, so it is always as tall as the taller
     of the two and the choice cards keep their position across the step change. A grid row
     sizes to its tallest item, and `visibility: hidden` (unlike `display: none`) keeps the held
     row's layout box, so the reserved height is measured from the real text at the real width
     rather than guessed at. That is why this carries no length of its own: a `min-height` in px
     could not follow a longer translation, a larger font or the user's zoom. */
  .choices-stage {
    display: grid;
  }
  .choices-stage > .choices {
    grid-area: 1 / 1;
  }
  .choices {
    display: flex;
    gap: 18px;
    align-items: stretch;
  }
  .choice {
    flex: 1;
    min-width: 0;
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 14px;
    padding: 24px 26px;
    border: 1px solid var(--hairline);
    border-radius: var(--r-card);
    background: var(--surface);
    color: var(--ink-soft);
    text-align: start;
    font: inherit;
    cursor: pointer;
    transition: border-color 0.15s ease, box-shadow 0.15s ease;
  }
  /* The re-synced boards drop the card's fixed 168px height and the `margin-top: auto`
     that pinned the text to its bottom: the card now shrink-wraps icon over text. */
  .choice .text {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .choice:hover:not(.disabled) {
    border-color: var(--model-accent);
    box-shadow: var(--shadow-card);
  }
  .choice:focus-visible {
    outline: 2px solid var(--model-accent);
    outline-offset: 2px;
  }
  .choice.disabled {
    opacity: 0.5;
    cursor: not-allowed;
    pointer-events: none;
  }
  /* Step 1's glyphs sit in full ink, like Landing2's gamepad — the card's grey is for prose. */
  .icon-ink {
    display: flex;
    color: var(--ink);
  }
  /* Landing2 tints the "Manage device" glyph green - it echoes the media chosen in step 1. */
  .icon-green {
    display: flex;
    color: var(--zelda-green);
  }
  .pad-icon {
    display: block;
    color: var(--ink);
  }
  .choice .label {
    font-size: var(--fs-title);
    font-weight: 600;
    letter-spacing: -0.01em;
    line-height: 1.2;
    color: var(--ink);
  }
  .choice .sub {
    font-size: var(--fs-caption);
    color: var(--ink-soft);
  }
  .advanced-link {
    align-self: flex-start;
    background: none;
    border: none;
    color: var(--ink-soft);
    font: inherit;
    font-size: var(--fs-btn-sm);
    font-weight: 500;
    cursor: pointer;
    padding: 0;
  }
  .advanced-link:hover {
    color: var(--ink);
  }
  /* Landing1.dc.html:41 / Landing2.dc.html:41 draw this row identically, differing only in
     what sits in it: `align-items: center; justify-content: space-between; padding-top: 4px`.
     The code carried only `display: flex`. */
  .backrow {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding-top: 4px;
  }
  /* Holds a control's box on the step where the control does not apply, so the choice cards
     above keep their position across both steps. Not a placeholder and not invented content:
     it is the real button, undrawn, and `visibility: hidden` takes it out of the accessibility
     tree and the tab order while preserving its exact layout box. */
  .held {
    visibility: hidden;
  }
  .back-btn {
    background: none;
    border: none;
    color: var(--ink-soft);
    font: inherit;
    font-size: var(--fs-btn);
    font-weight: 500;
    cursor: pointer;
    padding: 0;
  }
  .back-btn:hover {
    color: var(--ink);
  }
</style>
