<script lang="ts">
  // Shared backdrop + modal box shell — the ~20-line CSS block and click-outside/Escape
  // handling that StubLoadModal, FolderGateModal, ConnectGateModal, ConfirmModal, and
  // RomManagementTab's inline space-alert dialog each used to copy-paste independently.
  // Deliberately does NOT unify the promise-gate vs open-flag gating idiom those callers use
  // — only the shell markup/CSS. See docs/AUDIT_NOTES.md item #7.
  import type { Snippet } from "svelte";
  import { pushDismiss } from "../nav.js";

  let {
    onDismiss,
    borderColor = "var(--hairline)",
    maxWidth = "26rem",
    zIndex = "var(--z-modal)",
    padded = true,
    lip = "gold",
    children,
  }: {
    /** Called on backdrop click or Escape. Omit (or pass null) to make the modal
     *  non-dismissible that way — e.g. ConfirmModal's in-flight "running" phase. */
    onDismiss?: (() => void) | null;
    /** CSS color value for the modal's border (e.g. the danger-red space-alert variant). */
    borderColor?: string;
    maxWidth?: string;
    /** A CSS value from the stacking scale in styles/tokens.css, never a bare number. The
     *  default is `--z-modal`; the two callers that must sit ABOVE another open modal pass
     *  `--z-modal-prompt` (StubLoadModal, reachable while an install runs) and
     *  `--z-modal-alert` (the space alert). */
    zIndex?: string;
    /** The shell's own body padding. Pass `false` when the modal needs a full-bleed band
     *  inside the frame — FilePromptModal's footer bar is ruled edge-to-edge, which a
     *  padded body cannot express. Such a caller pads its own head/body/footer. */
    padded?: boolean;
    /** The 3px face-plate lip's colour. `"gold"` (default) is the app-header gold every
     *  modal artboard opens with; `"danger"` is the solid `--danger` band
     *  docs/design/mockups/FlashFailure.dc.html:84 draws over the failed-install dialog —
     *  same 3px height, no crawl, no layout shift, so switching it moves nothing. */
    lip?: "gold" | "danger";
    children: Snippet;
  } = $props();

  function dismiss() {
    onDismiss?.();
  }

  // Back closes the modal instead of navigating — for exactly the modals that answer "yes, you
  // may close me right now", since `onDismiss` is the same answer the backdrop click and
  // Escape already use. A modal that must survive an operation passes `null` there
  // (InstallProgressModal while a device write runs, ConfirmModal's running phase,
  // FilePromptModal while submitting) and is therefore not Back-dismissable either. Reading
  // the prop inside the effect is what keeps that live: the modal becomes Back-dismissable the
  // moment its operation finishes and hands the shell a dismisser.
  $effect(() => {
    const fn = onDismiss;
    if (!fn) return;
    return pushDismiss(fn);
  });
</script>

<div
  class="backdrop"
  role="presentation"
  style="z-index: {zIndex};"
  onclick={(e) => e.target === e.currentTarget && dismiss()}
  onkeydown={(e) => e.key === "Escape" && dismiss()}
>
  <div class="modal" role="dialog" aria-modal="true" tabindex="-1" style="border-color: {borderColor}; max-width: {maxWidth};">
    <!-- Same 3px gold face-plate lip the app header carries, as the modal's FIRST child —
         every artboard modal opens with it. `overflow: hidden` on .modal clips it to --r-card. -->
    <div class="lip" class:danger={lip === "danger"} aria-hidden="true"></div>
    <div class="modal-body" class:padded>
      {@render children()}
    </div>
  </div>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 1.25rem;
  }
  .modal {
    background: var(--surface);
    border: 1px solid;
    border-radius: var(--r-card);
    box-shadow: 0 12px 40px rgba(0, 0, 0, 0.32);
    width: 100%;
    overflow: hidden;
  }
  .lip {
    height: 3px;
    background: var(--grad-gold);
  }
  /* FlashFailure.dc.html:84 — `height: 3px; background: #8a241b`, flat, replacing the gold. */
  .lip.danger {
    background: var(--danger);
  }
  /* The body padding used to live on .modal itself; it moved here so the lip stays full-bleed. */
  .modal-body.padded {
    /* 22px 24px 20px — every modal artboard's body band. */
    padding: 1.375rem 1.5rem 1.25rem;
  }
</style>
