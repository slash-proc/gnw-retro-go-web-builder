<script lang="ts">
  // A small circled-ⓘ that reveals explanatory text on hover/focus — used to replace long
  // descriptive paragraphs so the UI stays sleek (the detail is there if you want it).
  let { text }: { text: string } = $props();
</script>

<button type="button" class="infotip" aria-label={text}>
  <span class="mark" aria-hidden="true">&#9432;</span>
  <span class="pop" role="tooltip">{text}</span>
</button>

<style>
  .infotip {
    /* reset the button to an inline marker */
    appearance: none;
    background: none;
    border: none;
    padding: 0;
    font: inherit;
    position: relative;
    display: inline-flex;
    align-items: center;
    cursor: help;
    vertical-align: middle;
  }
  .mark {
    font-size: var(--fs-caption);
    line-height: 1;
    color: var(--ink-soft);
  }
  .infotip:hover .mark,
  .infotip:focus-visible .mark {
    color: var(--ink);
  }
  .pop {
    position: absolute;
    bottom: calc(100% + 6px);
    left: 50%;
    transform: translateX(-50%);
    width: max-content;
    max-width: 18rem;
    z-index: 30;
    background: var(--surface);
    color: var(--ink);
    border: 1px solid var(--hairline);
    border-radius: var(--r-control);
    box-shadow: var(--shadow-card);
    padding: 0.4rem 0.55rem;
    font-size: var(--fs-caption);
    font-weight: 400;
    line-height: 1.35;
    text-align: left;
    opacity: 0;
    visibility: hidden;
    transition: opacity 120ms ease;
    pointer-events: none;
  }
  .infotip:hover .pop,
  .infotip:focus .pop,
  .infotip:focus-visible .pop {
    opacity: 1;
    visibility: visible;
  }
</style>
