<script lang="ts">
  import type { Snippet } from "svelte";
  import Button from "./Button.svelte";
  import Progress from "./Progress.svelte";
  import { kb } from "../util.js";

  let {
    open = false,
    title,
    body = "",
    summary,
    detail,
    confirmText = "Confirm",
    danger = false,
    run,
    onClose,
  }: {
    open?: boolean;
    title: string;
    body?: string;
    /** Optional rich summary (e.g. <ChangeSummary>) rendered above `body` in the confirm phase. */
    summary?: Snippet;
    /** Optional live detail (e.g. a flash log) rendered in the running/done/error phases. */
    detail?: Snippet;
    confirmText?: string;
    danger?: boolean;
    run: (
      report: (done: number, total: number, sub?: { value: number; max: number; label: string }) => void,
    ) => Promise<void>;
    onClose: () => void;
  } = $props();

  type Phase = "confirm" | "running" | "done" | "error";
  let phase = $state<Phase>("confirm");
  let done = $state(0);
  let total = $state(0);
  let sub = $state<{ value: number; max: number; label: string } | null>(null);
  let error = $state<string | null>(null);

  $effect(() => {
    if (open) {
      phase = "confirm";
      done = 0;
      total = 0;
      sub = null;
      error = null;
    }
  });

  async function confirm() {
    phase = "running";
    try {
      await run((d, t, s) => {
        done = d;
        total = t;
        sub = s ?? null;
      });
      phase = "done";
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
      phase = "error";
    }
  }

  // The dialog cannot be dismissed while a write is in flight.
  function tryClose() {
    if (phase !== "running") onClose();
  }
</script>

{#if open}
  <div
    class="backdrop"
    role="presentation"
    onclick={(e) => e.target === e.currentTarget && tryClose()}
    onkeydown={(e) => e.key === "Escape" && tryClose()}
  >
    <div class="modal" role="dialog" aria-modal="true" tabindex="-1">
      <h3>{title}</h3>

      {#if phase === "confirm"}
        {#if summary}<div class="summary">{@render summary()}</div>{/if}
        {#if body}<p class="muted">{body}</p>{/if}
        <div class="actions">
          <Button onclick={onClose}>Cancel</Button>
          <Button variant={danger ? "destructive" : "action"} onclick={confirm}>{confirmText}</Button>
        </div>
      {:else if phase === "running"}
        <p class="muted">Working — <strong>do not unplug your device</strong>.</p>
        {#if total > 0}
          <Progress value={done} max={total} label={`${kb(done)} / ${kb(total)} KB`} />
        {:else}
          <div class="indet"></div>
        {/if}
        {#if sub}
          <Progress value={sub.value} max={sub.max} label={sub.label} />
        {/if}
        {#if detail}<div class="detail">{@render detail()}</div>{/if}
      {:else if phase === "done"}
        <p class="ok">✓ Done.</p>
        {#if detail}<div class="detail">{@render detail()}</div>{/if}
        <div class="actions"><Button variant="action" onclick={onClose}>Close</Button></div>
      {:else}
        <p class="err">{error}</p>
        {#if detail}<div class="detail">{@render detail()}</div>{/if}
        <div class="actions"><Button onclick={onClose}>Close</Button></div>
      {/if}
    </div>
  </div>
{/if}

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 100;
    background: rgba(0, 0, 0, 0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 1.25rem;
  }
  .modal {
    background: var(--surface);
    border: 2px solid var(--model-accent);
    border-radius: var(--r-card);
    box-shadow: 0 8px 30px rgba(0, 0, 0, 0.3);
    padding: 1.25rem 1.5rem;
    max-width: 26rem;
    width: 100%;
  }
  h3 {
    font-size: var(--fs-lg);
    margin-bottom: 0.5rem;
  }
  .actions {
    display: flex;
    gap: 0.6rem;
    justify-content: flex-end;
    margin-top: 1.25rem;
  }
  .summary {
    margin-bottom: 0.6rem;
  }
  .ok {
    color: var(--zelda-green);
    font-weight: 600;
  }
  .indet {
    height: 0.5rem;
    border-radius: 2px;
    margin-top: 0.75rem;
    background: linear-gradient(90deg, var(--surface-sunk) 30%, var(--model-accent) 50%, var(--surface-sunk) 70%);
    background-size: 200% 100%;
    animation: slide 1.2s linear infinite;
  }
  @keyframes slide {
    from {
      background-position: 200% 0;
    }
    to {
      background-position: -200% 0;
    }
  }
</style>
