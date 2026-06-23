<script lang="ts">
  import AccordionSection from "./AccordionSection.svelte";

  // Honest deferred panel (§5.4): a designed section header + "what this will do
  // + what unblocks it" copy + disabled controls. NOT a fake live button.
  let {
    id,
    title,
    open = false,
    chipText = "not yet available",
    will,
    needs,
    control,
    onToggle,
  }: {
    id: string;
    title: string;
    open?: boolean;
    chipText?: string;
    will: string; // what this section will do
    needs: string; // what unblocks it
    control?: string; // label for the inert disabled control
    onToggle?: (id: string) => void;
  } = $props();
</script>

<AccordionSection {id} {title} {open} chipKind="deferred" {chipText} {onToggle}>
  <div class="stack">
    <p class="will">{will}</p>
    <p class="needs"><strong>Needs:</strong> {needs}</p>
    {#if control}
      <div><button class="inert" disabled>{control}</button></div>
    {/if}
    <span class="soon">Coming soon</span>
  </div>
</AccordionSection>

<style>
  .stack {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
  }
  .will {
    margin: 0;
    font-size: var(--fs-caption);
    color: var(--ink);
  }
  .needs {
    margin: 0;
    font-size: var(--fs-micro);
    color: var(--ink-soft);
  }
  .inert {
    font: inherit;
    font-size: var(--fs-caption);
    font-weight: 600;
    background: var(--surface-sunk);
    color: var(--ink-soft);
    border: 1px solid var(--hairline);
    border-radius: var(--r-control);
    padding: 0.4rem 0.9rem;
    cursor: not-allowed;
  }
  .soon {
    align-self: flex-start;
    font-size: var(--fs-micro);
    color: #161616;
    background: var(--gold);
    border: 1px solid #161616;
    border-radius: var(--r-control);
    padding: 0.05rem 0.4rem;
  }
</style>
