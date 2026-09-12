<script lang="ts">
  import type { Snippet } from "svelte";

  // "action" = the single iconic primary. "default" = neutral. "ink" = neutral
  // with the dark edge/label (a stronger, still-not-primary choice).
  // "ink-solid" = the FILLED dark cap ReposDetail.dc.html draws for the Sources footer's
  // Activate — the same weight as "action" without claiming the iconic red.
  type Variant =
    | "action"
    | "default"
    | "ink"
    | "ink-solid"
    | "destructive"
    | "quiet"
    | "cancel";
  let {
    variant = "default",
    type = "button",
    disabled = false,
    class: className = "",
    onclick,
    children,
  }: {
    variant?: Variant;
    type?: "button" | "submit";
    disabled?: boolean;
    class?: string;
    onclick?: (e: MouseEvent) => void;
    children?: Snippet;
  } = $props();
</script>

<button class="btn {variant} {className}" {type} {disabled} {onclick}>
  {@render children?.()}
</button>

<style>
  .btn {
    font-family: inherit;
    font-size: var(--fs-btn-sm);
    font-weight: 600;
    border-radius: var(--r-btn);
    padding: var(--pad-btn-sm);
    cursor: pointer;
    border: 1px solid transparent;
    transition:
      background-color 120ms ease,
      border-color 120ms ease;
  }
  /* Disabled reads as inert gray — never a washed-out red/silver. ModalFilesBios /
     ModalFolder draw the disabled cap as a FLAT light grey with no edge at all
     (`background:#e0e0e0; color:#9a9a9a`), so the hairline border goes and the label
     drops to --ink-dim (#9a9a9a). The fill stays --surface-sunk rather than a literal
     #e0e0e0 — one step off the artboard, but it keeps a dark-theme value. */
  .btn:disabled {
    background: var(--surface-sunk);
    color: var(--ink-dim);
    border-color: transparent;
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
    color: #ffffff;
    font-size: var(--fs-btn);
    padding: var(--pad-btn);
    border-color: transparent;
    box-shadow: inset 0 -2px 0 var(--action-red-deep);
  }
  .action:hover:not(:disabled) {
    background: var(--action-red-deep);
  }

  /* Neutral — a white cap on a hairline edge. */
  .default {
    background: var(--surface);
    border: 1px solid var(--hairline);
    color: var(--ink-soft);
    box-shadow: none;
  }
  .default:hover:not(:disabled) {
    border-color: var(--ink-soft);
    color: var(--ink);
  }

  /* Ink — the neutral button with the dark edge and label. */
  .ink {
    background: var(--surface);
    border: 1px solid var(--ink);
    color: var(--ink);
    box-shadow: none;
  }
  .ink:hover:not(:disabled) {
    background: var(--surface-sunk);
  }

  /* Ink, filled. ReposDetail.dc.html's footer Activate: `background:#1b1b1b; color:#ffffff;
     font-size:14px; font-weight:600; padding:9px 26px; border-radius:5px;
     box-shadow: inset 0 -2px 0 #000000`. Same footer geometry as .action. */
  .ink-solid {
    background: var(--ink);
    color: var(--surface);
    font-size: var(--fs-btn);
    padding: var(--pad-btn);
    border-color: transparent;
    box-shadow: inset 0 -2px 0 rgba(0, 0, 0, 0.55);
  }
  .ink-solid:hover:not(:disabled) {
    background: var(--ink-soft);
  }

  /* Destructive — dark oxblood OUTLINE at rest; fills only on confirm.
     Audit A #15: every artboard drawing this control (BackupPatchCross.dc.html's
     `Patch anyway`, the Library dock's `Sync Library`) sets a 1.5px rule, not 1px. */
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

  /* Cancel — bare text, no chrome. Every modal artboard (ModalConnect, ModalFolder,
     ModalFilesBios, ModalFilesConvert, ModalInstallConfirm) draws the dismissal as
     `font-size: 14px; font-weight: 500; color: #5c5c5c` with no border and no underline.
     With the border gone it needs a real focus ring of its own. */
  .cancel {
    background: transparent;
    border: none;
    box-shadow: none;
    color: var(--ink-soft);
    font-size: var(--fs-caption);
    font-weight: 500;
    padding: 0.5rem 0;
  }
  .cancel:hover:not(:disabled) {
    color: var(--ink);
  }
  .cancel:disabled {
    background: transparent;
    border-color: transparent;
  }
  .cancel:focus-visible {
    outline: 2px solid var(--zelda-green);
    outline-offset: 2px;
    border-radius: var(--r-control);
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
