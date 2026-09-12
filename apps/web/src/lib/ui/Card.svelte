<script lang="ts">
  // Surface card. A BORDER means "this card wraps a real object" (a bank, a game,
  // a choice). A card used as a plain grouping gets no border — pass `plain`.
  import type { Snippet } from "svelte";
  let {
    sharp = false,
    plain = false,
    children,
  }: { sharp?: boolean; plain?: boolean; children?: Snippet } = $props();
</script>

<section class="card" class:sharp class:plain>
  {@render children?.()}
</section>

<style>
  .card {
    background: var(--surface);
    border: 1px solid var(--hairline);
    border-radius: var(--r-card);
    padding: 1.25rem 1.5rem;
    transition: border-color 200ms ease;
  }
  /* Data tables / file panes stay sharp = "technical". */
  .sharp {
    border-radius: 0;
  }
  /* Plain grouping — no object, so no edge. */
  .plain {
    border-color: transparent;
  }
</style>
