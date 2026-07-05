<script lang="ts">
  import AccordionSection from "./AccordionSection.svelte";
  import { locale } from "../i18n/locale.svelte.js";

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
    {locale.t.expertCorner.warnBanner}
  </p>

  <AccordionSection
    id="lock"
    title={locale.t.expertCorner.manualRelockTitle}
    open={openSet.has("lock")}
    chipKind="deferred"
    chipText={locale.t.expertCorner.manualRelockChip}
    onToggle={toggle}
  >
    <div class="inner">
      <p class="will">{locale.t.expertCorner.manualRelockWill}</p>
      <p class="needs"><strong>{locale.t.deferredSection.needsLabel}</strong> {locale.t.expertCorner.manualRelockNeeds}</p>
      <div><button class="inert" disabled>{locale.t.expertCorner.relockButton}</button></div>
    </div>
  </AccordionSection>

  <AccordionSection
    id="patch"
    title={locale.t.expertCorner.rawPatchTitle}
    open={openSet.has("patch")}
    chipKind="deferred"
    chipText={locale.t.expertCorner.rawPatchChip}
    onToggle={toggle}
  >
    <div class="inner">
      <p class="will">{locale.t.expertCorner.rawPatchWill}</p>
      <p class="needs">
        <strong>{locale.t.expertCorner.rawPatchNeedsBold}</strong>
        {locale.t.expertCorner.rawPatchNeedsMid}
        <code class="mono">patchModel(model, internal, external)</code>
        {locale.t.expertCorner.rawPatchNeedsBody}
      </p>
      <div><button class="inert" disabled>{locale.t.expertCorner.patchWithOptionsButton}</button></div>
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
