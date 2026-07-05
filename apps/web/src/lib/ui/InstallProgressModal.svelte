<script lang="ts">
  // Pure view over the installProgress store (apps/web/src/lib/installProgress.svelte.ts) — no
  // props of its own. Rendered exactly once, unconditionally, at App.svelte's root (alongside
  // StubLoadModal/FolderGateModal/ConnectGateModal) so no `{#if}`-driven unmount of a calling
  // component's subtree can ever hide/destroy an in-flight flash/SD-sync operation's UI. See
  // StubLoadModal.svelte for the reference pattern this follows.
  import { installProgress, type PhaseStatus, type SubstepStatus } from "../installProgress.svelte.js";
  import ModalShell from "./ModalShell.svelte";
  import Button from "./Button.svelte";
  import Progress from "./Progress.svelte";
  import { locale } from "../i18n/locale.svelte.js";

  const prompt = $derived(installProgress.prompt);
  const modalPhase = $derived(installProgress.modalPhase);
  const states = $derived(installProgress.phaseState);
  const error = $derived(installProgress.error);
  const auditLog = $derived(installProgress.auditLog);
  const logOpen = $derived(installProgress.logOpen);

  function icon(status: PhaseStatus | SubstepStatus): string {
    if (status === "done") return "✓";
    if (status === "error") return "✗";
    if (status === "active") return "●";
    return "○";
  }

  /** Keep the shared audit log pinned to its newest line as more get appended. */
  function autoScroll(node: HTMLElement, lines: string[]) {
    const scroll = () => { node.scrollTop = node.scrollHeight; };
    scroll();
    return {
      update(newLines: string[]) {
        lines = newLines;
        scroll();
      },
    };
  }
</script>

{#if prompt}
  <ModalShell onDismiss={modalPhase !== "running" ? () => installProgress.close() : null}>
    {#snippet children()}
      <h3>{prompt.title}</h3>

      {#if modalPhase === "confirm"}
        {#if prompt.body}<p class="muted">{prompt.body}</p>{/if}
        {#if prompt.checkboxes.length > 0}
          <div class="confirm-checkboxes">
            {#each prompt.checkboxes as cb (cb.id)}
              <label>
                <input
                  type="checkbox"
                  checked={installProgress.checkboxValues[cb.id]}
                  onchange={(e) => installProgress.setCheckbox(cb.id, e.currentTarget.checked)}
                />
                {cb.label}
              </label>
            {/each}
          </div>
        {/if}
        <div class="actions">
          <Button onclick={() => installProgress.cancel()}>{locale.t.shared.common.cancel}</Button>
          {#if prompt.confirmGate && !prompt.confirmGate.ready()}
            <Button variant="action" onclick={() => prompt.confirmGate?.onClick()}>
              {prompt.confirmGate.label}
            </Button>
          {:else}
            <Button variant={prompt.danger ? "destructive" : "action"} onclick={() => installProgress.confirm()}>
              {prompt.confirmText}
            </Button>
          {/if}
        </div>
      {:else}
        {#if modalPhase === "running"}
          <p class="muted">{locale.t.shared.common.workingNotePre}<strong>{locale.t.shared.common.workingNoteBold}</strong>{locale.t.shared.common.workingNotePost}</p>
        {/if}
        <ul class="checklist">
          {#each prompt.phases as p (p.id)}
            {@const s = states[p.id]}
            {#if s}
              <li class="phase status-{s.status}">
                {#if s.substeps.length > 0}
                  <!-- Collapsed by default — click to peek at the sub-step checklist; auto-collapses
                       again once the phase finishes (see installProgress.svelte.ts finish()). -->
                  <button
                    type="button"
                    class="phase-row clickable"
                    aria-expanded={s.expanded}
                    onclick={() => installProgress.toggle(p.id)}
                  >
                    <span class="icon" class:spin={s.status === "active"} aria-hidden="true">{icon(s.status)}</span>
                    <span class="label">{p.label}</span>
                    <span class="chevron" aria-hidden="true">{s.expanded ? "▾" : "▸"}</span>
                  </button>
                {:else}
                  <div class="phase-row">
                    <span class="icon" class:spin={s.status === "active"} aria-hidden="true">{icon(s.status)}</span>
                    <span class="label">{p.label}</span>
                  </div>
                {/if}
                {#if s.progress}
                  <!-- Live numeric sub-progress ("Flashing chunk 6/23") — visible while set. -->
                  <div class="phase-sub">
                    <Progress value={s.progress.value} max={s.progress.max} label={s.progress.label ?? ""} />
                  </div>
                {/if}
                {#if s.substeps.length > 0 && s.expanded}
                  <ul class="substeps">
                    {#each s.substeps as sub (sub.id)}
                      {@const subStatus = s.substepStatus[sub.id] ?? "pending"}
                      {@const subProgress = s.substepProgress[sub.id]}
                      <li class="substep status-{subStatus}">
                        <span class="icon sub-icon" class:spin={subStatus === "active"} aria-hidden="true">{icon(subStatus)}</span>
                        {#if subStatus === "active" && subProgress}
                          <!-- Transient bar — only ever shown on the ONE currently-active
                               sub-step, moving down the list as each finishes (owner: "the
                               progress bar is transient... goes from task to task"). -->
                          <span class="sub-bar"><Progress value={subProgress.value} max={subProgress.max} label="" /></span>
                        {/if}
                        <span class="label">{sub.label}</span>
                        {#if subProgress}
                          <span class="count mono">[{subProgress.value}/{subProgress.max}]</span>
                        {/if}
                      </li>
                    {/each}
                  </ul>
                {/if}
              </li>
            {/if}
          {/each}
        </ul>

        {#if auditLog.length > 0}
          <div class="log-section">
            <button
              type="button"
              class="log-toggle clickable"
              aria-expanded={logOpen}
              onclick={() => installProgress.toggleLog()}
            >
              <span class="chevron" aria-hidden="true">{logOpen ? "▾" : "▸"}</span>
              <span class="label">{locale.t.shared.installProgressModal.logLabel(auditLog.length)}</span>
            </button>
            {#if logOpen}
              <pre class="log-box mono" use:autoScroll={auditLog}>{auditLog.join("\n")}</pre>
            {/if}
          </div>
        {/if}

        {#if modalPhase === "done"}
          <p class="ok">{locale.t.shared.common.done}</p>
          <div class="actions"><Button variant="action" onclick={() => installProgress.close()}>{locale.t.shared.common.close}</Button></div>
        {:else if modalPhase === "error"}
          <p class="err">{error}</p>
          <div class="actions"><Button onclick={() => installProgress.close()}>{locale.t.shared.common.close}</Button></div>
        {/if}
      {/if}
    {/snippet}
  </ModalShell>
{/if}

<style>
  h3 {
    font-size: var(--fs-lg);
    margin-bottom: 0.5rem;
  }
  .muted {
    color: var(--ink-soft);
    font-size: var(--fs-caption);
  }
  .confirm-checkboxes {
    display: flex;
    gap: 1rem;
    font-size: var(--fs-caption);
    color: var(--ink-soft);
    margin-top: 0.5rem;
  }
  .confirm-checkboxes label {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    cursor: pointer;
  }
  .actions {
    display: flex;
    gap: 0.6rem;
    justify-content: flex-end;
    margin-top: 1.25rem;
  }
  .ok {
    color: var(--zelda-green);
    font-weight: 600;
  }
  .err {
    color: var(--action-red);
    font-weight: 600;
  }
  .checklist {
    list-style: none;
    margin: 0.75rem 0 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
  }
  .phase {
    border-radius: var(--r-control);
  }
  .phase-row {
    display: flex;
    align-items: center;
    gap: 0.55rem;
    width: 100%;
    text-align: left;
    padding: 0.35rem 0.3rem;
    color: var(--ink);
  }
  button.phase-row {
    font: inherit;
    background: none;
    border: none;
    border-radius: var(--r-control);
  }
  button.phase-row.clickable {
    cursor: pointer;
  }
  button.phase-row.clickable:hover {
    background: var(--surface-sunk);
  }
  .chevron {
    color: var(--ink-soft);
    font-size: var(--fs-micro);
    flex-shrink: 0;
  }
  .icon {
    width: 1.1rem;
    text-align: center;
    color: var(--ink-soft);
  }
  .status-done .icon {
    color: var(--zelda-green);
  }
  .status-error .icon {
    color: var(--action-red);
  }
  .status-active .icon {
    color: var(--model-accent);
  }
  .icon.spin {
    display: inline-block;
    animation: spin 1s linear infinite;
  }
  @keyframes spin {
    from {
      transform: rotate(0deg);
    }
    to {
      transform: rotate(360deg);
    }
  }
  .label {
    flex: 1;
    font-size: var(--fs-caption);
  }
  .status-done .label {
    color: var(--ink-soft);
  }
  .phase-sub {
    padding: 0 0.3rem 0.2rem 1.9rem;
  }
  /* Nested sub-step checklist — indented under its phase. */
  .substeps {
    list-style: none;
    margin: 0;
    padding: 0 0 0.25rem 1.9rem;
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
  }
  .substep {
    display: flex;
    align-items: center;
    gap: 0.45rem;
  }
  .substep .label {
    font-size: var(--fs-micro);
    color: var(--ink-soft);
  }
  .substep.status-done .label {
    color: var(--ink-soft);
    opacity: 0.75;
  }
  .substep.status-active .label {
    color: var(--ink);
  }
  .sub-icon {
    width: 0.9rem;
    font-size: var(--fs-micro);
  }
  .sub-bar {
    width: 4.5rem;
    flex-shrink: 0;
  }
  .count {
    font-size: var(--fs-micro);
    color: var(--ink-soft);
    flex-shrink: 0;
  }
  .log-section {
    margin-top: 0.75rem;
  }
  .log-toggle {
    display: flex;
    align-items: center;
    gap: 0.45rem;
    width: 100%;
    text-align: left;
    font: inherit;
    font-size: var(--fs-caption);
    background: none;
    border: none;
    color: var(--ink-soft);
    padding: 0.35rem 0.3rem;
    border-radius: var(--r-control);
  }
  .log-toggle.clickable {
    cursor: pointer;
  }
  .log-toggle.clickable:hover {
    background: var(--surface-sunk);
  }
  .log-box {
    margin: 0.4rem 0 0;
    padding: 0.6rem 0.7rem;
    border: 1px solid var(--hairline);
    border-radius: var(--r-control);
    background: var(--surface-sunk);
    font-size: var(--fs-micro);
    color: var(--ink-soft);
    white-space: pre-wrap;
    word-break: break-all;
    max-height: 220px;
    overflow-y: auto;
  }
  .mono {
    font-family: var(--font-mono);
  }
</style>
