<script lang="ts">
  /**
   * Tab — Overview. `docs/design/proposals/overview-v2/`.
   *
   * This tab is now a HOST, not a page: the four panes live in `OverviewRail.svelte`, and what
   * is left here is the two things that sit outside the rail.
   *
   *  1. **The disconnected states.** Three of them, not one. This tab is the default landing of
   *     "Manage Device", so the old single grey wait line was the first and often last thing a
   *     newcomer saw. A browser with no WebUSB can never reach a device however long it waits and
   *     must not be told to wait; an in-flight connect genuinely is a wait; everything else needs
   *     an adapter physically wired to the device, which is irreducible and so is named rather
   *     than implied. Connect is offered ONLY where it can succeed.
   *  2. **The screen dock.** "The screen is docked right, a third column beside the rail rather
   *     than a block at the top of the body. It is ambient, and it sits in gutter the page
   *     already had, outside the content column and outside `--maxw`. Below roughly 1200px it
   *     drops out. Its capture action sits with it, not in the page footer."
   *
   * The accordion stack this replaced is gone: Status, Details, Activity and Device log are rail
   * items now, so nothing on this tab opens or closes, and the old multi-open `openSet` prop
   * went with it. `Advanced.svelte` owns the selection and routes `#info/<pane>` into it, the
   * same single-select shape the Firmware rail already had.
   */
  import { device } from "../device.svelte.js";
  import { locale } from "../i18n/locale.svelte.js";
  import { loadSel, saveSel } from "../persist.js";
  import { installProgress, type PhaseDef, type PhaseReporter } from "../installProgress.svelte.js";
  import OverviewRail, { type OverviewRailId } from "./OverviewRail.svelte";

  let {
    selected,
    onSelect,
  }: {
    selected: OverviewRailId;
    onSelect: (id: OverviewRailId) => void;
  } = $props();

  // Read once: a browser does not grow WebUSB mid-session, and this decides which of the
  // disconnected states we show. The same test `Landing.svelte` gates its card on.
  const webusbSupported = typeof navigator !== "undefined" && !!navigator.usb;

  // This tab is a dead end without a device — auto-surface the shared connect gate the moment
  // it is viewed while disconnected (no click required). No-ops instantly if already connected.
  let gateActive = false;
  $effect(() => {
    if (device.isConnected || gateActive) return;
    gateActive = true;
    device
      .ensureConnectGate()
      .catch(() => {})
      .finally(() => (gateActive = false));
  });

  // --- the screen dock ---------------------------------------------------------------------
  let isCapturingScreenshot = $state(false);
  let screenshotProgress = $state({ done: 0, total: 1 });
  let latestScreenshotUrl = $state<string | null>(null);
  let screenshotErr = $state<string | null>(null);

  // Single-phase, no substeps — a screenshot capture has no natural internal decomposition
  // beyond "capturing" with a byte-progress counter (see engine/screenshot.ts's halt / 64KiB
  // chunk / resume sequence, which this must NOT touch).
  const screenshotPhases = $derived<PhaseDef[]>([
    { id: "capture", label: locale.t.overview.screenshot.phaseCapturing },
  ]);

  function renderImageDataToUrl(imageData: ImageData): string {
    const canvas = document.createElement("canvas");
    canvas.width = imageData.width;
    canvas.height = imageData.height;
    canvas.getContext("2d")!.putImageData(imageData, 0, 0);
    return canvas.toDataURL("image/png");
  }

  async function runScreenshot(report: PhaseReporter): Promise<void> {
    report.start("capture");
    const imageData = await device.captureScreenshot((done, total) => {
      report.progress("capture", done, total);
    });
    latestScreenshotUrl = renderImageDataToUrl(imageData);
    report.finish("capture");
  }

  async function triggerScreenshot(): Promise<void> {
    screenshotErr = null;
    if (loadSel("skip-screenshot-confirm", false)) {
      isCapturingScreenshot = true;
      try {
        const imageData = await device.captureScreenshot((done, total) => {
          screenshotProgress = { done, total };
        });
        latestScreenshotUrl = renderImageDataToUrl(imageData);
      } catch (err) {
        screenshotErr = err instanceof Error ? err.message : String(err);
      } finally {
        isCapturingScreenshot = false;
      }
      return;
    }
    void installProgress.run({
      title: locale.t.overview.screenshot.modalTitle,
      body: locale.t.overview.screenshot.modalBody,
      confirmText: locale.t.overview.screenshot.modalConfirm,
      phases: screenshotPhases,
      checkboxes: [{ id: "remember", label: locale.t.overview.screenshot.rememberCheckbox }],
      exec: async (report) => {
        if (installProgress.checkboxValues["remember"]) saveSel("skip-screenshot-confirm", true);
        try {
          await runScreenshot(report);
        } catch (e) {
          screenshotErr = e instanceof Error ? e.message : String(e);
          throw e;
        }
      },
    });
  }

  function downloadScreenshot(): void {
    if (!latestScreenshotUrl) return;
    const a = document.createElement("a");
    a.href = latestScreenshotUrl;
    a.download = `gnw_screenshot_${Date.now()}.png`;
    a.click();
  }
</script>

<div class="overview">
  <!-- The rail is drawn CONNECTED OR NOT. `StatusNoDevice.dc.html` is explicit that "Activity
       stays live in the rail", and it is right for a reason beyond the board: the audit log
       fills up from Sources and the Library with no device in the room at all, so a rail that
       appeared only on connect would hide the session's whole record from the people most
       likely to need it. Only Status changes; Details and Device log carry their own empty
       states already. -->
  <OverviewRail {selected} {onSelect} connected={device.isConnected} {disconnected} />

  {#if device.isConnected}
    <!-- Ambient, in gutter the page already had. Absent with no device because there is no
         screen to show, not because it is unimportant. -->
    <aside class="screendock">
      <div class="screen-head">
        <h4 class="seclabel">{locale.t.overview.screenshot.sectionLabel}</h4>
        <button
          class="text-action"
          disabled={isCapturingScreenshot || !device.isConnected}
          onclick={triggerScreenshot}
        >
          {isCapturingScreenshot
            ? locale.t.overview.controls.capturingPercent(
                Math.round((screenshotProgress.done / screenshotProgress.total) * 100),
              )
            : locale.t.overview.controls.captureScreenshot}
        </button>
      </div>
      {#if screenshotErr}<p class="err">{screenshotErr}</p>{/if}
      <div class="screenshot-area">
        {#if latestScreenshotUrl}
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
          <img
            src={latestScreenshotUrl}
            alt={locale.t.overview.screenshot.alt}
            onclick={downloadScreenshot}
            title={locale.t.overview.screenshot.clickToDownload}
          />
        {:else}
          <div class="screenshot-placeholder">{locale.t.overview.screenshot.noScreenshotCaptured}</div>
        {/if}
      </div>
    </aside>
  {/if}
</div>

<!-- THREE disconnected states, not one. This tab is the default landing of "Manage Device", so
     the old single grey wait line was the first and often last thing a newcomer saw. A browser
     with no WebUSB can never reach a device however long it waits and must not be told to wait;
     an in-flight connect genuinely is a wait; everything else needs an adapter physically wired
     to the device, which is irreducible and so is named rather than implied. Connect is offered
     ONLY where it can succeed. -->
{#snippet disconnected()}
  {#if !webusbSupported}
    <div class="nodev">
      <p class="nodev-title">{locale.t.overview.noDevice.browserTitle}</p>
      <p class="nodev-body">{locale.t.overview.noDevice.browserBody}</p>
    </div>
  {:else if device.connection === "connecting"}
    <p class="placeholder">{locale.t.overview.waitingForConnection}</p>
  {:else}
    <div class="nodev">
      <p class="nodev-title">{locale.t.overview.noDevice.title}</p>
      <p class="nodev-body">{locale.t.overview.noDevice.body}</p>
      <button class="btn" onclick={() => void device.connect()}>{locale.t.shared.common.connect}</button>
    </div>
  {/if}
{/snippet}

<style>
  /* The rail plus the screen gutter. `minmax(0, 1fr)` on the rail column is what lets the
     244px + pane grid inside it shrink; the dock is a fixed gutter, not a fraction. NO
     `overflow` anywhere in here: `.tabpane` is the page's only general scroll container and an
     overflow on this element or the rail's pane would clip every tab with no scrollbar and no
     gate to catch it. */
  .overview {
    display: grid;
    /* 360px = the 320px panel + `--page-pad-x` (40px) of trailing gutter on `.screendock`.
       It was 260px, which left 220px of content, and the panel's `max-width: 100%` then capped
       it to 220 without a word. Change either number and you resize the capture. */
    grid-template-columns: minmax(0, 1fr) 360px;
    align-items: start;
    flex: 1;
    width: 100%;
    min-width: 0;
  }
  /* "Below roughly 1200px it drops out." Ambient content does not get to squeeze the rail. */
  @media (max-width: 1200px) {
    .overview {
      grid-template-columns: minmax(0, 1fr);
    }
    .screendock {
      display: none;
    }
  }
  .screendock {
    display: flex;
    flex-direction: column;
    gap: 10px;
    /* LOGICAL, not `padding: 32px var(--page-pad-x) 40px 0`. The dock is the grid's trailing
       column, so its page gutter belongs on the INLINE-END edge. As a physical `padding-right`
       it stayed on the right when the grid mirrored under `dir=rtl`, which put the 40px on the
       dock's inner edge and left the panel flush against the viewport with no gutter at all. */
    padding-block: 32px 40px;
    padding-inline: 0 var(--page-pad-x);
    min-width: 0;
  }
  .screen-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 10px;
  }
  .seclabel {
    margin: 0;
    font-size: var(--fs-label);
    font-weight: 700;
    letter-spacing: var(--label-track);
    text-transform: uppercase;
    color: var(--ink-soft);
  }
  /* A bare 13/600 green text control, not a chromed button. */
  .text-action {
    font: inherit;
    font-size: var(--fs-btn-sm);
    font-weight: 600;
    color: var(--zelda-green);
    background: transparent;
    border: none;
    padding: 0;
    cursor: pointer;
  }
  .text-action:disabled {
    color: var(--ink-soft);
    cursor: not-allowed;
  }
  /* EXACTLY 320x240, the device's own panel, at one image pixel per CSS pixel.
     The capture IS 320x240 (`engine/screenshot.ts` even repairs a 319/239 readback), so any
     other size is a resample of a 76800-pixel image -- `image-rendering: pixelated` keeps the
     edges hard but cannot put back what scaling removed. This used to be `width: 100%`, which
     made the shot whatever the sidebar happened to be.
     `max-width` is the one concession: below ~320px of column there is nowhere to put it, and
     the rule that the page body never scrolls sideways outranks matching the panel. It shrinks
     and letterboxes there (`object-fit: contain`) rather than distorting or being clipped. */
  .screenshot-area {
    border: 1px solid var(--hairline);
    border-radius: var(--r-panel);
    background: var(--surface);
    overflow: hidden;
    display: flex;
    align-items: center;
    justify-content: center;
    /* CONTENT-BOX, against this app's global border-box, and that is the whole point of the
       rule: under border-box the 1px border eats into the declared size, so `width: 320px`
       renders the panel at 318x238 -- off by one pixel a side, invisible in a screenshot of a
       screenshot, and still a resample of every one of the 76800 pixels. Declared here so the
       CONTENT box is the panel and the border sits outside it. */
    box-sizing: content-box;
    width: 320px;
    height: 240px;
  }
  .screenshot-area img {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: contain;
    image-rendering: pixelated;
    cursor: pointer;
  }
  .screenshot-placeholder {
    color: var(--ink-soft);
    font-size: var(--fs-caption);
    padding: 24px 12px;
    text-align: center;
  }
  .nodev {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 10px;
    border: 1px solid var(--hairline);
    border-radius: var(--r-panel);
    background: var(--surface);
    padding: 20px 22px;
    max-width: 560px;
  }
  .nodev-title {
    margin: 0;
    font-size: 16px;
    font-weight: 600;
  }
  .nodev-body {
    margin: 0;
    font-size: var(--fs-caption);
    color: var(--ink-soft);
  }
  .btn {
    font: inherit;
    font-size: var(--fs-btn-sm);
    font-weight: 600;
    color: var(--ink-on-face);
    background: var(--zelda-green);
    border: none;
    border-radius: var(--r-control);
    padding: 8px 16px;
    cursor: pointer;
  }
  .placeholder {
    margin: 0;
    color: var(--ink-soft);
    font-size: var(--fs-caption);
  }
  .err {
    margin: 0;
    color: var(--danger);
    font-size: var(--fs-caption);
  }
</style>
