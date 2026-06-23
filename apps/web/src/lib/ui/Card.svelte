<script lang="ts">
  import type { Snippet } from "svelte";
  let { sharp = false, children }: { sharp?: boolean; children?: Snippet } = $props();
</script>

<section class="card" class:sharp>
  {@render children?.()}
</section>

<style>
  .card {
    background: var(--surface);
    border: 1.5px solid var(--model-accent);
    border-radius: var(--r-card);
    box-shadow: var(--shadow-card);
    padding: 1.25rem 1.5rem;
    transition: border-color 200ms ease;
  }
  /* Data tables / file panes stay sharp = "technical". */
  .sharp {
    border-radius: 0;
  }
</style>
