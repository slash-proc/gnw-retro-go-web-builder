<script lang="ts">
  import type { Snippet } from "svelte";

  type Variant = "action" | "default" | "destructive" | "quiet";
  let {
    variant = "default",
    type = "button",
    disabled = false,
    onclick,
    children,
  }: {
    variant?: Variant;
    type?: "button" | "submit";
    disabled?: boolean;
    onclick?: (e: MouseEvent) => void;
    children?: Snippet;
  } = $props();
</script>

<button class="btn {variant}" {type} {disabled} {onclick}>
  {@render children?.()}
</button>

<style>
  .btn {
    font: inherit;
    font-weight: 600;
    border-radius: 5px;
    padding: 0.5rem 1.05rem;
    cursor: pointer;
    border: 1px solid transparent;
    transition:
      background-color 120ms ease,
      border-color 120ms ease;
  }
  /* Disabled reads as inert gray — never a washed-out red/silver. */
  .btn:disabled {
    background: var(--surface-sunk);
    color: var(--ink-soft);
    border-color: var(--hairline);
    box-shadow: none;
    cursor: not-allowed;
  }
  .btn.destructive:disabled {
    background: transparent;
    border-color: var(--hairline);
  }

  /* The single iconic primary action. */
  .action {
    background: var(--action-red);
    color: #fff;
    box-shadow: inset 0 -2px 0 var(--action-red-deep);
  }
  .action:hover:not(:disabled) {
    background: var(--action-red-deep);
  }

  /* Secondary — a gray button cap ringed in the model color (red/green), with a
     black legend. The device's gray function buttons inside the colored frame. */
  .default {
    background: var(--silver);
    color: #161616;
    border: 1.5px solid var(--model-accent);
    box-shadow: inset 0 -2px 0 var(--silver-edge);
    transition: border-color 200ms ease;
  }
  .default:hover:not(:disabled) {
    filter: brightness(0.97);
  }

  /* Destructive — dark oxblood OUTLINE at rest; fills only on confirm. */
  .destructive {
    background: transparent;
    color: var(--danger);
    border: 1.5px solid var(--danger);
    box-shadow: none;
  }
  .destructive:hover:not(:disabled) {
    background: var(--danger);
    color: #fff;
  }

  /* Quiet escape hatch / link. */
  .quiet {
    background: transparent;
    color: var(--ink-soft);
    border: none;
    box-shadow: none;
    padding: 0.5rem 0.25rem;
    text-decoration: underline;
    text-underline-offset: 2px;
  }
  .quiet:hover:not(:disabled) {
    color: var(--ink);
  }
</style>
