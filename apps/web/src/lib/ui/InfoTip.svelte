<script lang="ts">
  // --- InfoTip: the app's hover/focus explanation bubble ---------------------------------
  //
  // The reusable alternative to the native `title=` attribute (still used by Carousel,
  // DeviceControls and BankCard): `title` is slow to appear, unstyleable, and draws as OS
  // chrome rather than as this app. Use this anywhere a short one-sentence explanation hangs
  // off a label. First drawn on SourcesCache.dc.html, beside the Storage panel's `Protected`.
  //
  // POSITIONING IS IN FLOW, DELIBERATELY. The bubble is absolutely positioned inside this
  // component's own `position: relative` inline wrapper, so it rides the scroll of whatever
  // pane it sits in. It is NOT `position: fixed`, which would need SplitButton.svelte's
  // capture-phase `scroll` listener (`scroll` does not bubble and the emitter is `.tabpane`,
  // not the document) plus a measure-on-open — machinery that can desync from its trigger.
  // Nothing on the path to a pane sets `overflow: hidden`, so the bubble is not clipped.
  //
  // Opens on hover AND on keyboard focus — hover alone would leave the control unreachable
  // for anyone not using a mouse. Closes on leave, on blur and on Escape. No click is needed
  // to open or to dismiss, and focus is never trapped.

  interface Props {
    /** Accessible name for the trigger — what the `?` is about (e.g. the row's label). */
    label: string;
    /** The one sentence to show. Associated with the trigger via `aria-describedby`. */
    message: string;
  }

  const { label, message }: Props = $props();

  let open = $state(false);
  const id = $props.id();
</script>

<span class="tip">
  <button
    class="mark"
    type="button"
    aria-label={label}
    aria-describedby={`${id}-msg`}
    aria-expanded={open}
    onmouseenter={() => (open = true)}
    onmouseleave={() => (open = false)}
    onfocus={() => (open = true)}
    onblur={() => (open = false)}
    onkeydown={(e) => {
      if (e.key === "Escape") open = false;
    }}>?</button
  >
  <!-- Always rendered, so `aria-describedby` always resolves; visibility alone is toggled. -->
  <span id={`${id}-msg`} class="bubble" role="tooltip" class:open>{message}</span>
</span>

<style>
  .tip {
    position: relative;
    display: inline-block;
    vertical-align: middle;
    margin-inline-start: 6px;
    line-height: 1;
  }
  /* The artboard's small outlined circle. */
  .mark {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 14px;
    height: 14px;
    border-radius: 999px;
    border: 1px solid var(--hairline);
    background: none;
    color: var(--ink-soft);
    font: inherit;
    font-size: 10px;
    font-weight: 600;
    line-height: 1;
    padding: 0;
    cursor: help;
  }
  .bubble {
    position: absolute;
    left: 50%;
    bottom: calc(100% + 8px);
    transform: translateX(-50%);
    z-index: var(--z-tooltip);
    width: max-content;
    max-width: 268px;
    background: var(--ink);
    color: var(--surface);
    font-size: var(--fs-micro);
    line-height: 1.45;
    text-align: start;
    border-radius: 4px;
    padding: 7px 10px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.18);
    /* Hidden from sight and from pointer events, but never from `aria-describedby`. */
    visibility: hidden;
    opacity: 0;
    pointer-events: none;
  }
  .bubble.open {
    visibility: visible;
    opacity: 1;
  }
</style>
