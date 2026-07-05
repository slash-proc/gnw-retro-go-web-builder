<script lang="ts">
  // Small circular numbered/lettered badge (e.g. a step number). NOT used by
  // Wizard.svelte's `.step-num` — that one's styling is driven by ancestor
  // `.wizard-step.active`/`.done` classes (a 3-state cascade), a materially
  // different pattern from this static badge; forcing both through one
  // component would need a prop-driven variant system for two call sites.
  // See docs/AUDIT_NOTES.md item #13.
  let { children }: { children: import("svelte").Snippet } = $props();
</script>

<span class="badge">{@render children()}</span>

<style>
  .badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1.3rem;
    height: 1.3rem;
    border-radius: 50%;
    background: var(--model-accent);
    color: #fff;
    font-size: var(--fs-micro);
  }
</style>
