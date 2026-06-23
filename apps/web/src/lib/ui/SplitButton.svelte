<script lang="ts">
  // A primary "action" button with a caret that opens a small menu of secondary
  // actions (e.g. Connect | ▾ → "Choose Adapter…").
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
  // Menu is position:fixed (computed from the button rect) so it escapes ancestor
  // overflow:hidden (e.g. AccordionSection's rounded card).
  let menuPos = $state({ top: 0, left: 0 });

  function toggle() {
    if (!open && root) {
      const r = root.getBoundingClientRect();
      menuPos = { top: r.bottom + 4, left: r.left };
    }
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
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  });
</script>

<div class="split {variant}" bind:this={root}>
  <button class="seg main" {disabled} {onclick}>{label}</button>
  <button
    class="seg caret"
    {disabled}
    aria-haspopup="menu"
    aria-expanded={open}
    aria-label="More options"
    onclick={toggle}
  >
    <span aria-hidden="true">▾</span>
  </button>
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
    border-left: 1px solid var(--action-red-deep);
  }
  /* default (secondary silver) */
  .default .seg {
    background: var(--silver);
    color: #161616;
    box-shadow: inset 0 -2px 0 var(--silver-edge);
  }
  .default .seg:hover:not(:disabled) {
    filter: brightness(0.97);
  }
  .default .caret {
    border-left: 1px solid var(--silver-edge);
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
  .caret {
    padding: 0.5rem 0.55rem;
    border-radius: 0 5px 5px 0;
  }
  .caret:disabled {
    border-left-color: var(--hairline);
  }
  .menu {
    position: fixed;
    z-index: 30;
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
    text-align: left;
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
