<script lang="ts">
  let { value = 0, max = 1, label = "" }: { value?: number; max?: number; label?: string } = $props();
  const pct = $derived(max > 0 ? Math.min(100, Math.round((100 * value) / max)) : 0);
</script>

<div class="wrap">
  <div class="track">
    <div class="fill" style:width="{pct}%"></div>
  </div>
  {#if label}<span class="label mono">{label}</span>{/if}
</div>

<style>
  .wrap {
    display: flex;
    align-items: center;
    gap: 0.6rem;
  }
  .track {
    flex: 1;
    height: 0.6rem;
    background: var(--surface-sunk);
    border: 1px solid var(--silver-edge);
    border-radius: 2px;
    overflow: hidden;
  }
  .fill {
    height: 100%;
    background: var(--action-red);
    transition: width 150ms ease;
  }
  .label {
    font-size: var(--fs-micro);
    color: var(--ink-soft);
    white-space: nowrap;
  }
</style>
