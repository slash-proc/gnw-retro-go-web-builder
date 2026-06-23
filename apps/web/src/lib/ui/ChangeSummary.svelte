<script module lang="ts">
  // A reusable, auditable list of changes/status rows. Shown inline (e.g. in a drop-down) and
  // re-used verbatim inside ConfirmModal (via its `summary` snippet) so the user audits the same
  // summary they confirm. Purely presentational.
  export interface ChangeItem {
    label: string;
    status: string;
    kind?: "ok" | "warn" | "muted" | "info";
    detail?: string;
  }
</script>

<script lang="ts">
  let { items }: { items: ChangeItem[] } = $props();
</script>

<ul class="summary">
  {#each items as it (it.label)}
    <li class="row">
      <span class="label">{it.label}</span>
      <span class="status {it.kind ?? 'info'}">{it.status}</span>
      {#if it.detail}<span class="detail">{it.detail}</span>{/if}
    </li>
  {/each}
</ul>

<style>
  .summary {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
    border: 1px solid var(--surface-sunk);
    border-radius: var(--r-control);
    background: var(--surface);
    padding: 0.5rem 0.65rem;
  }
  .row {
    display: grid;
    grid-template-columns: minmax(7rem, auto) 1fr;
    align-items: baseline;
    gap: 0.2rem 0.6rem;
    font-size: var(--fs-caption);
  }
  .label {
    font-weight: 600;
    color: var(--ink);
  }
  .status {
    font-size: var(--fs-micro);
    font-weight: 600;
  }
  .status.ok {
    color: var(--zelda-green);
  }
  .status.warn {
    color: var(--caution);
  }
  .status.muted {
    color: var(--ink-soft);
  }
  .status.info {
    color: var(--ink);
  }
  .detail {
    grid-column: 2;
    font-size: var(--fs-micro);
    color: var(--ink-soft);
  }
</style>
