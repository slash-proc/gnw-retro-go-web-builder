<script lang="ts">
  // Shared backdrop + modal box shell — the ~20-line CSS block and click-outside/Escape
  // handling that StubLoadModal, FolderGateModal, ConnectGateModal, ConfirmModal, and
  // RomManagementTab's inline space-alert dialog each used to copy-paste independently.
  // Deliberately does NOT unify the promise-gate vs open-flag gating idiom those callers use
  // — only the shell markup/CSS. See docs/AUDIT_NOTES.md item #7.
  import type { Snippet } from "svelte";

  let {
    onDismiss,
    borderColor = "var(--model-accent)",
    maxWidth = "26rem",
    zIndex = 100,
    children,
  }: {
    /** Called on backdrop click or Escape. Omit (or pass null) to make the modal
     *  non-dismissible that way — e.g. ConfirmModal's in-flight "running" phase. */
    onDismiss?: (() => void) | null;
    /** CSS color value for the modal's border (e.g. the danger-red space-alert variant). */
    borderColor?: string;
    maxWidth?: string;
    zIndex?: number;
    children: Snippet;
  } = $props();

  function dismiss() {
    onDismiss?.();
  }
</script>

<div
  class="backdrop"
  role="presentation"
  style="z-index: {zIndex};"
  onclick={(e) => e.target === e.currentTarget && dismiss()}
  onkeydown={(e) => e.key === "Escape" && dismiss()}
>
  <div class="modal" role="dialog" aria-modal="true" tabindex="-1" style="border-color: {borderColor}; max-width: {maxWidth};">
    {@render children()}
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
    border: 2px solid;
    border-radius: var(--r-card);
    box-shadow: 0 8px 30px rgba(0, 0, 0, 0.3);
    padding: 1.25rem 1.5rem;
    width: 100%;
  }
</style>
