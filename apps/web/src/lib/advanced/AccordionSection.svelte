<script lang="ts">
  import type { Snippet } from "svelte";

  // A multi-open disclosure panel (§2.2). A section whose operation is *running*
  // cannot be collapsed (§2.4) — the header button goes aria-disabled so a
  // cancelable read / blocking write stays on screen.
  export type ChipKind = "idle" | "running" | "success" | "error" | "deferred" | "locked";

  let {
    id,
    title,
    open = false,
    running = false,
    chipKind = "idle",
    chipText = "",
    onToggle,
    children,
  }: {
    id: string;
    title: string;
    open?: boolean;
    running?: boolean;
    chipKind?: ChipKind;
    chipText?: string;
    onToggle?: (id: string) => void;
    children?: Snippet;
  } = $props();

  const headingId = $derived(`acc-h-${id}`);
  const regionId = $derived(`acc-r-${id}`);

  function toggle() {
    if (running) return; // running sections can't collapse (§2.4)
    onToggle?.(id);
  }
</script>

<section class="acc" class:open>
  <h3 class="hdr" id={headingId}>
    <button
      class="toggle"
      aria-expanded={open}
      aria-controls={regionId}
      aria-disabled={running}
      title={running ? "Operation in progress" : undefined}
      onclick={toggle}
    >
      {#if running}
        <span class="dot" aria-hidden="true"></span>
      {:else}
        <span class="caret" aria-hidden="true">{open ? "▾" : "▸"}</span>
      {/if}
      <span class="title">{title}</span>
      {#if chipText}
        <span class="chip {chipKind}">{chipText}</span>
      {/if}
    </button>
  </h3>
  {#if open}
    <div class="body" id={regionId} role="region" aria-labelledby={headingId}>
      {@render children?.()}
    </div>
  {/if}
</section>

<style>
  .acc {
    background: var(--surface);
    border: 1px solid var(--model-accent);
    border-radius: var(--r-card);
    box-shadow: var(--shadow-card);
    overflow: hidden;
  }
  .hdr {
    margin: 0;
    font-size: var(--fs-body);
  }
  .toggle {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 0.55rem;
    font: inherit;
    font-weight: 600;
    text-align: left;
    background: var(--surface);
    color: var(--ink);
    border: none;
    padding: 0.7rem 0.9rem;
    cursor: pointer;
  }
  .toggle[aria-disabled="true"] {
    cursor: default;
  }
  .open .toggle {
    border-bottom: 1px solid var(--hairline);
  }
  .caret {
    color: var(--ink-soft);
    width: 1ch;
  }
  .dot {
    width: 0.55rem;
    height: 0.55rem;
    border-radius: 50%;
    background: var(--model-accent);
    animation: pulse 1.1s ease-in-out infinite;
  }
  @keyframes pulse {
    0%,
    100% {
      opacity: 0.35;
    }
    50% {
      opacity: 1;
    }
  }
  .title {
    flex: 1;
  }
  /* Status chips (§5.5). */
  .chip {
    font-size: var(--fs-micro);
    font-weight: 600;
    border-radius: 999px;
    padding: 0.08rem 0.55rem;
    white-space: nowrap;
  }
  .chip.idle,
  .chip.deferred {
    color: var(--ink-soft);
    background: var(--surface-sunk);
  }
  .chip.running {
    color: var(--ink);
    background: var(--surface-sunk);
  }
  .chip.success {
    color: #fff;
    background: var(--zelda-green);
  }
  .chip.error {
    color: #fff;
    background: var(--danger);
  }
  .chip.locked {
    color: #161616;
    background: var(--caution);
  }
  .body {
    padding: 0.85rem 0.9rem 1rem;
  }
</style>
