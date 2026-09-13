<script lang="ts">
  /**
   * Overview > Logs > Device log — `docs/design/proposals/overview-v2/DeviceLog.dc.html`.
   *
   * What the firmware printed. Three things the board changed from the accordion this replaces:
   *
   *  1. **Output first.** The panel opens on the text, not on a row of buttons. Reading is why
   *     anyone came here; re-reading is an operation you ask for afterwards.
   *  2. **Copy and Save sit on the output**, in its own heading row, beside the thing they act
   *     on. They were page chrome in the footer band, and on a long page the eye goes title,
   *     content, and never comes back to the bottom.
   *  3. **`Read device log` stays in the footer**, because it is the device operation on this
   *     pane, which is what every other rail footer's primary action is.
   *
   * NO TERMINAL BLACK. The output panel is the page's sunk surface inside the standard border,
   * so it still recedes from the white panels around it and still reads as machine output,
   * without a second palette invented for a console. `--surface-sunk` is theme-aware, which a
   * hardcoded black was not.
   *
   * NOT BUILT: the board's `Debug` section (Address / Function / Build). The README lists it
   * under "Not grounded" — "Symbolication is drawn, not built. Nothing in `apps/web` parses an
   * ELF." Drawing the heading over three empty rows would be filler, so the section is absent
   * until something can fill it. The chain that would make it possible is real (the installed
   * `gitTag` names the release and the release publishes `symbols[]`), it is just not wired.
   */
  import { locale } from "../i18n/locale.svelte.js";
  import { device } from "../device.svelte.js";
  import { deviceSafety } from "../installProgress.svelte.js";
  import { download } from "../util.js";
  import PaneFooter from "../advanced/PaneFooter.svelte";
  import Button from "./Button.svelte";

  const t = $derived(locale.t.overviewRail);
  const ov = $derived(locale.t.overview);

  let log = $state<string | null>(null);
  let logErr = $state<string | null>(null);
  let logContainer = $state<HTMLElement | null>(null);
  let reading = $state(false);
  let polling = $state(false);
  let pollTimer: ReturnType<typeof setInterval> | undefined;

  async function readLog(manual = true): Promise<void> {
    if (manual) reading = true;
    else {
      if (polling) return;
      polling = true;
    }
    logErr = null;
    const followOutput =
      !logContainer || logContainer.scrollTop + logContainer.clientHeight >= logContainer.scrollHeight - 8;
    try {
      const r = await device.readLog(manual);
      // "(log buffer empty)" and the "\n---\n" join stay English in every locale: this is the
      // DEVICE's own raw printf buffer, and these markers are interleaved with it in the same
      // <pre>. Not UI chrome.
      const newText = r.text || "(log buffer empty)";
      if (!log || newText === "(log buffer empty)") {
        log = newText;
      } else {
        let overlap = 0;
        for (let i = Math.min(log.length, newText.length); i > 0; i--) {
          if (log.endsWith(newText.slice(0, i))) {
            overlap = i;
            break;
          }
        }
        log += overlap > 0 ? newText.slice(overlap) : "\n---\n" + newText;
      }
      if (followOutput) {
        setTimeout(() => {
          if (logContainer) logContainer.scrollTop = logContainer.scrollHeight;
        }, 0);
      }
    } catch (e) {
      logErr = e instanceof Error ? e.message : String(e);
    } finally {
      if (manual) reading = false;
      else polling = false;
    }
  }

  $effect(() => {
    if (device.isConnected && device.retroGoRunning && !deviceSafety.unsafe && !log && !reading && !polling) {
      void readLog(false);
    }
  });

  $effect(() => {
    if (!device.isConnected || !device.retroGoRunning) return;
    pollTimer = setInterval(() => {
      if (!reading && !polling && !deviceSafety.unsafe) void readLog(false);
    }, 1000);
    return () => {
      if (pollTimer) clearInterval(pollTimer);
      pollTimer = undefined;
    };
  });

  function copyLog(): void {
    if (log == null) return;
    void navigator.clipboard?.writeText(log);
  }

  function saveLog(): void {
    if (log == null) return;
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    download(`retro-go-output-${stamp}.log`, new Blob([log], { type: "text/plain" }));
  }

</script>

<div class="devicelog">
  <section class="sect">
    <div class="outhead">
      <h4 class="seclabel">{t.output}</h4>
      {#if log != null}
        <div class="outactions">
          <button class="mini" type="button" onclick={copyLog}>{t.copy}</button>
          <button class="mini" type="button" onclick={saveLog}>{t.save}</button>
        </div>
      {/if}
    </div>
    {#if logErr}<p class="err">{logErr}</p>{/if}
    {#if log != null}
      <pre class="out mono" bind:this={logContainer}>{log}</pre>
    {:else}
      <p class="placeholder">{ov.log.readLog}</p>
    {/if}
  </section>
</div>

<!-- The pane's one DEVICE operation, drawn in the rail's anchored footer bar. Copy and Save are
     deliberately NOT here: they act on the output above, so they sit with it. -->
<PaneFooter>
  <Button variant="action" disabled={reading || !device.isConnected} onclick={() => void readLog(true)}>
    {reading ? ov.log.reading : ov.log.readLog}
  </Button>
</PaneFooter>

<style>
  .devicelog {
    display: flex;
    flex-direction: column;
    gap: 32px;
    min-width: 0;
  }
  .sect {
    display: flex;
    flex-direction: column;
    gap: 12px;
    min-width: 0;
  }
  /* The heading and its actions share one baseline row, which is what puts Copy and Save
     beside the line naming what they act on. */
  .outhead {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 12px;
  }
  .seclabel {
    margin: 0;
    font-size: var(--fs-label);
    font-weight: 700;
    letter-spacing: var(--label-track);
    text-transform: uppercase;
    color: var(--ink-soft);
  }
  .outactions {
    display: flex;
    gap: 12px;
    flex: none;
  }
  .mini {
    font: inherit;
    font-size: var(--fs-btn-sm);
    font-weight: 600;
    color: var(--zelda-green);
    background: transparent;
    border: none;
    padding: 0;
    cursor: pointer;
  }
  /* The page ground inside the standard border, never terminal black — see the header note.
     `overflow: auto` is this element's OWN scroller for its own long text, which is a
     different thing from a page-level scroll container: `.tabpane` remains the only one. */
  .out {
    margin: 0;
    min-height: 150px;
    max-height: 28rem;
    overflow: auto;
    white-space: pre-wrap;
    word-break: break-word;
    font-size: var(--fs-micro);
    line-height: 1.35;
    background: var(--surface-sunk);
    border: 1px solid var(--hairline);
    border-radius: var(--r-panel);
    padding: 12px 14px;
  }
  .mono {
    font-family: var(--font-mono);
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
