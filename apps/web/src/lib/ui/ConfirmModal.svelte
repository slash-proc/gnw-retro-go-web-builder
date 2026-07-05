<script lang="ts">
  import type { Snippet } from "svelte";
  import Button from "./Button.svelte";
  import Progress from "./Progress.svelte";
  import ModalShell from "./ModalShell.svelte";
  import { kb } from "../util.js";
  import { locale } from "../i18n/locale.svelte.js";

  let {
    open = false,
    title,
    body = "",
    summary,
    detail,
    confirmText = locale.t.shared.confirmModal.defaultConfirmText,
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

  // The dialog cannot be dismissed (backdrop click / Escape) while a write is in flight —
  // ModalShell's onDismiss is omitted entirely in that phase, matching its own contract for
  // "non-dismissible that way."
</script>

{#if open}
  <ModalShell onDismiss={phase !== "running" ? onClose : null}>
    {#snippet children()}
      <h3>{title}</h3>

      {#if phase === "confirm"}
        {#if summary}<div class="summary">{@render summary()}</div>{/if}
        {#if body}<p class="muted">{body}</p>{/if}
        <div class="actions">
          <Button onclick={onClose}>{locale.t.shared.common.cancel}</Button>
          <Button variant={danger ? "destructive" : "action"} onclick={confirm}>{confirmText}</Button>
        </div>
      {:else if phase === "running"}
        <p class="muted">{locale.t.shared.common.workingNotePre}<strong>{locale.t.shared.common.workingNoteBold}</strong>{locale.t.shared.common.workingNotePost}</p>
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
        <p class="ok">{locale.t.shared.common.done}</p>
        {#if detail}<div class="detail">{@render detail()}</div>{/if}
        <div class="actions"><Button variant="action" onclick={onClose}>{locale.t.shared.common.close}</Button></div>
      {:else}
        <p class="err">{error}</p>
        {#if detail}<div class="detail">{@render detail()}</div>{/if}
        <div class="actions"><Button onclick={onClose}>{locale.t.shared.common.close}</Button></div>
      {/if}
    {/snippet}
  </ModalShell>
{/if}

<style>
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
