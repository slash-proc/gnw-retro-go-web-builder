<script lang="ts">
  // A primary "action" button with a caret that opens a small menu of secondary
  // actions (e.g. Connect | ▾ → "Choose Adapter…").
  import { locale } from "../i18n/locale.svelte.js";

  let {
    label,
    onclick,
    disabled = false,
    variant = "action",
    items = [],
  }: {
    label: string;
    onclick?: (e: MouseEvent) => void;
    disabled?: boolean;
    variant?: "action" | "default";
    items?: { label: string; onclick: () => void }[];
  } = $props();

  let open = $state(false);
  let root = $state<HTMLElement | null>(null);
  // Menu is position:fixed (computed from the button rect) so it escapes any
  // ancestor's overflow:hidden (e.g. a rounded card or scroll container).
  let menuPos = $state({ top: 0, left: 0 });

  /** The nearest ancestor that actually scrolls, or null if only the viewport clips us.
   *  Since commit 5567424 the document no longer scrolls — `.app` is `100vh/overflow:hidden`
   *  and `.tabpane` owns the scroll — so this is normally the tab pane. */
  function scrollClip(el: HTMLElement): HTMLElement | null {
    for (let n = el.parentElement; n; n = n.parentElement) {
      const o = getComputedStyle(n).overflowY;
      if ((o === "auto" || o === "scroll") && n.scrollHeight > n.clientHeight) return n;
    }
    return null;
  }

  function place() {
    if (!root) return;
    const r = root.getBoundingClientRect();
    // The trigger has scrolled out of the box that clips it: a fixed menu would be left
    // hanging over unrelated content, so close instead of tracking to nowhere.
    const clip = scrollClip(root);
    const box = clip
      ? clip.getBoundingClientRect()
      : { top: 0, bottom: window.innerHeight } as DOMRect;
    if (r.bottom < box.top || r.top > box.bottom) {
      open = false;
      return;
    }
    menuPos = { top: r.bottom + 4, left: r.left };
  }

  function toggle() {
    if (!open) place();
    open = !open;
  }

  function choose(it: { onclick: () => void }) {
    open = false;
    it.onclick();
  }

  $effect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (root && !root.contains(e.target as Node)) open = false;
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && (open = false);
    // Capture phase: scroll does not bubble, and the element that scrolls is now the tab
    // pane (or any other overflow ancestor), not the document — so we cannot listen on
    // window alone and expect to hear it.
    const onScroll = () => place();
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    document.addEventListener("scroll", onScroll, { capture: true, passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("scroll", onScroll, { capture: true });
      window.removeEventListener("resize", onScroll);
    };
  });
</script>

<div class="split {variant}" bind:this={root}>
  <button class="seg main" {disabled} {onclick}>{label}</button>
  <!-- The caret used to render unconditionally, so a call site whose `items` were empty drew a
       dropdown arrow that opened an empty menu. That is what "the Flash Retro-Go button is
       broken" was: in SD mode, and before an install was built, its item list was `[]`. A split
       button with nothing to split is a plain button. -->
  {#if items.length > 0}
    <button
      class="seg caret"
      {disabled}
      aria-haspopup="menu"
      aria-expanded={open}
      aria-label={locale.t.shared.splitButton.moreOptions}
      onclick={toggle}
    >
      <span aria-hidden="true">▾</span>
    </button>
  {/if}
  {#if open}
    <div class="menu" role="menu" style="top:{menuPos.top}px; left:{menuPos.left}px">
      {#each items as it (it.label)}
        <button class="item" role="menuitem" onclick={() => choose(it)}>{it.label}</button>
      {/each}
    </div>
  {/if}
</div>

<style>
  .split {
    position: relative;
    display: inline-flex;
  }
  .seg {
    font: inherit;
    font-weight: 600;
    border: none;
    cursor: pointer;
    transition: background-color 120ms ease;
  }
  /* action (primary red) */
  .action .seg {
    background: var(--action-red);
    color: #fff;
    box-shadow: inset 0 -2px 0 var(--action-red-deep);
  }
  .action .seg:hover:not(:disabled) {
    background: var(--action-red-deep);
  }
  .action .caret {
    /* Artboard F16 draws the caret divider as a light rule over the red fill,
       not the darker oxblood edge used for the button's bottom lip. */
    border-inline-start: 1px solid rgba(255, 255, 255, 0.28);
  }
  /* default (secondary silver) */
  .default .seg {
    background: var(--silver);
    color: var(--ink-on-face);
    box-shadow: inset 0 -2px 0 var(--silver-edge);
  }
  .default .seg:hover:not(:disabled) {
    filter: brightness(0.97);
  }
  .default .caret {
    border-inline-start: 1px solid var(--silver-edge);
  }
  .seg:disabled {
    background: var(--surface-sunk);
    color: var(--ink-soft);
    box-shadow: none;
    cursor: not-allowed;
  }
  .main {
    padding: 0.5rem 1.05rem;
    border-radius: 5px 0 0 5px;
  }
  /* With no caret beside it the main segment IS the button, so it takes the full radius rather
     than keeping the flat right edge that only makes sense against a second segment. */
  .split:not(:has(.caret)) .main {
    border-radius: 5px;
  }
  .caret {
    padding: 0.5rem 0.55rem;
    border-radius: 0 5px 5px 0;
  }
  .caret:disabled {
    border-inline-start-color: var(--hairline);
  }
  .menu {
    position: fixed;
    z-index: var(--z-popover);
    min-width: 13rem;
    background: var(--surface);
    border: 1px solid var(--hairline);
    border-radius: var(--r-control);
    box-shadow: 0 6px 20px rgba(0, 0, 0, 0.18);
    padding: 0.25rem;
    display: flex;
    flex-direction: column;
  }
  .item {
    font: inherit;
    text-align: start;
    background: transparent;
    color: var(--ink);
    border: none;
    border-radius: calc(var(--r-control) - 2px);
    padding: 0.45rem 0.6rem;
    cursor: pointer;
  }
  .item:hover {
    background: var(--surface-sunk);
  }
</style>
