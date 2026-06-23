<script lang="ts">
  import AccordionSection from "./AccordionSection.svelte";

  // §2.1.1 / §3.5 — the deliberately-hidden Expert surface. Reached only via the
  // `#expert` hash (unobvious, never linked from Easy setup). Deferred panels:
  // Manual re-lock and the raw patch-option schema. Maximum-friction by spec.
  let openSet = $state(new Set<string>(["lock"]));
  function toggle(id: string) {
    const next = new Set(openSet);
    next.has(id) ? next.delete(id) : next.add(id);
    openSet = next;
  }
</script>

<div class="stack">
  <p class="warn">
    Expert surface — almost nobody needs anything here. These controls are dangerous or
    pointless for most users and are kept only so the capability isn&rsquo;t lost.
  </p>

  <AccordionSection
    id="lock"
    title="Manual re-lock"
    open={openSet.has("lock")}
    chipKind="deferred"
    chipText="not yet available"
    onToggle={toggle}
  >
    <div class="inner">
      <p class="will">Re-enable read-out protection (RDP) on the device. The single place lock is a deliberate action.</p>
      <p class="needs"><strong>Needs:</strong> the power-cycle handshake; <code class="mono">GnwFlasher.lock()</code> is notImplemented. Will ship behind a typed acknowledgement + blocking confirm.</p>
      <div><button class="inert" disabled>Re-lock device…</button></div>
    </div>
  </AccordionSection>

  <AccordionSection
    id="patch"
    title="Raw firmware patch options"
    open={openSet.has("patch")}
    chipKind="deferred"
    chipText="expert / unsupported"
    onToggle={toggle}
  >
    <div class="inner">
      <p class="will">
        The <code class="mono">/dev</code> patch-option schema (<code class="mono">no_smb2</code>,
        <code class="mono">sleep_time</code>, <code class="mono">slim</code>, bootloader repo/tag, …),
        exposed verbatim and explicitly unsupported.
      </p>
      <p class="needs">
        <strong>You probably don&rsquo;t need this.</strong> The knob-free
        <code class="mono">patchModel(model, internal, external)</code> in Easy setup is what everyone should use.
        This panel only exists so the capability isn&rsquo;t lost.
      </p>
      <div><button class="inert" disabled>Patch with options…</button></div>
    </div>
  </AccordionSection>
</div>

<style>
  .stack {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }
  .warn {
    margin: 0;
    font-size: var(--fs-caption);
    color: var(--caution);
    background: var(--surface-sunk);
    border-radius: var(--r-control);
    padding: 0.6rem 0.7rem;
  }
  .inner {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
  }
  .will {
    margin: 0;
    font-size: var(--fs-caption);
  }
  .needs {
    margin: 0;
    font-size: var(--fs-micro);
    color: var(--ink-soft);
  }
  .mono {
    font-family: var(--font-mono);
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
</style>
