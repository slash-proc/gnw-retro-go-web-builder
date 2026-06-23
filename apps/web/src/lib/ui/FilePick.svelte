<script lang="ts">
  let {
    accept = "",
    disabled = false,
    label = "Choose file",
    onpick,
  }: { accept?: string; disabled?: boolean; label?: string; onpick?: (f: File | null) => void } = $props();

  let name = $state<string | null>(null);
  function change(e: Event) {
    const f = (e.target as HTMLInputElement).files?.[0] ?? null;
    name = f?.name ?? null;
    onpick?.(f);
  }
</script>

<label class="pick" class:disabled>
  <span class="cap">{label}</span>
  <span class="name">{name ?? "No file chosen"}</span>
  <input type="file" {accept} {disabled} onchange={change} />
</label>

<style>
  .pick {
    display: inline-flex;
    align-items: center;
    gap: 0.6rem;
    cursor: pointer;
  }
  .pick.disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }
  input {
    display: none;
  }
  /* Silver button cap with black-on-silver legend, like the device buttons. */
  .cap {
    background: var(--silver);
    color: #161616;
    border: 1.5px solid var(--model-accent);
    box-shadow: inset 0 -2px 0 var(--silver-edge);
    border-radius: 5px;
    padding: 0.4rem 0.9rem;
    font-weight: 600;
    font-size: var(--fs-caption);
    white-space: nowrap;
  }
  .name {
    font-size: var(--fs-caption);
    color: var(--ink-soft);
    overflow: hidden;
    text-overflow: ellipsis;
  }
</style>
