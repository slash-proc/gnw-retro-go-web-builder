<script lang="ts">
  // Pure view over the installProgress store (apps/web/src/lib/installProgress.svelte.ts) — no
  // props of its own. Rendered exactly once, unconditionally, at App.svelte's root (alongside
  // StubLoadModal/FolderGateModal/ConnectGateModal) so no `{#if}`-driven unmount of a calling
  // component's subtree can ever hide/destroy an in-flight flash/SD-sync operation's UI. See
  // StubLoadModal.svelte for the reference pattern this follows.
  import {
    installProgress,
    type PhaseState,
    type PhaseStatus,
    type SubstepProgress,
    type SubstepStatus,
  } from "../installProgress.svelte.js";
  import ModalShell from "./ModalShell.svelte";
  import Button from "./Button.svelte";
  import RefreshButton from "./RefreshButton.svelte";
  import { locale } from "../i18n/locale.svelte.js";
  import { formatSizePair } from "../util.js";
  import { device } from "../device.svelte.js";
  import { extflashSegments, intflashSegments, regionLabelForBlock } from "../engine/classify.js";

  const prompt = $derived(installProgress.prompt);
  const modalPhase = $derived(installProgress.modalPhase);
  const states = $derived(installProgress.phaseState);
  const error = $derived(installProgress.error);
  const auditLog = $derived(installProgress.auditLog);
  // Entries are data (key + params); the text is produced HERE, against the active locale, so
  // switching language re-renders the whole log rather than leaving already-logged lines frozen
  // in the language they happened to be logged in.
  const auditText = $derived(installProgress.logText(locale.t));
  const logOpen = $derived(installProgress.logOpen);
  const errorBlocks = $derived(installProgress.errorBlocks);

  // The failed blocks are named against the SAME GeoSegment[] the geometry bars draw, so the
  // table's region column reads in the settled segment vocabulary ("Games & Homebrew" /
  // "Cores, saves") rather than inventing a second naming scheme. Bank 0 is external
  // flash, banks 1/2 are the internal banks.
  const extSegs = $derived(extflashSegments(device.partitions, device.info?.externalFlashSizeBytes ?? 0));
  const intSegs = $derived(intflashSegments(device.banks));

  /** `0x9038_0000` — FlashFailure.dc.html:84's address form: 8 lowercase hex digits, split
   *  into two groups of four. */
  function addr(n: number): string {
    const h = (n >>> 0).toString(16).padStart(8, "0");
    return `0x${h.slice(0, 4)}_${h.slice(4)}`;
  }

  /** The board's failure sentence, composed from the real error. There is exactly one block
   *  per FlashVerifyError today (flash() aborts at the first failing chunk) where the board
   *  drew three, so both counts are interpolated and neither is hardcoded. Anything that is
   *  not a verify failure keeps its raw message. */
  const headline = $derived.by(() => {
    const t = locale.t.shared.installProgressModal;
    const blocks = errorBlocks;
    if (!blocks || blocks.length === 0) return error;
    const bank = blocks[0].bank;
    const where = bank === 0 ? t.partlyWrittenExt : t.partlyWrittenBank(bank);
    return `${t.verifyHeadline(blocks.length, Math.max(0, installProgress.errorAttempts - 1))} ${where}`;
  });

  function icon(status: PhaseStatus | SubstepStatus): string {
    if (status === "done") return "✓";
    if (status === "error") return "✗";
    if (status === "active") return "●";
    return "○";
  }

  /** Percent shown inline on a phase row (and driving its bar). Mirrored from whichever
   *  declared sub-step is currently active — the artboard's "Flashing Retro-Go 46%" over
   *  "Games, BIOS, languages [1.6/3.4 MB]" is exactly that mirror — and otherwise taken from
   *  the phase's own counter. The active sub-step wins so that a phase which reports at BOTH
   *  levels (Wizard step 2's flash: intflash at phase level, frogfs/littlefs per sub-step)
   *  doesn't keep showing the stale phase-level total once a sub-step takes over. Null =
   *  nothing measurable to show. */
  function phasePct(s: PhaseState): number | null {
    const active = s.substeps.find((sub) => s.substepStatus[sub.id] === "active");
    let p: SubstepProgress | undefined = active ? s.substepProgress[active.id] : undefined;
    if (!p) p = s.progress;
    if (!p || p.max <= 0) return null;
    return Math.min(100, Math.round((100 * p.value) / p.max));
  }

  /** `[137/137]` for item counters, `[1.6/3.4 MB]` for byte counters — both forms are the
   *  artboard's; the unit is named once, on the total. */
  function counter(p: SubstepProgress): string {
    if (p.unit !== "bytes") return `[${p.value}/${p.max}]`;
    return `[${formatSizePair(p.value, p.max)}]`;
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
  <!-- GuidedFlashing.dc.html:81 draws this dialog at `width: 480px`; ModalShell's default
       is 26rem/416px. -->
  <ModalShell maxWidth="480px" lip={modalPhase === "error" ? "danger" : "gold"} onDismiss={modalPhase !== "running" ? () => installProgress.close() : null}>
    {#snippet children()}
      <!-- ModalInstallConfirm.dc.html:243 sets the title→body gap at 4px; the running and
           failure boards (FlashingCancel.dc.html:85, FlashFailure.dc.html:84) both draw the
           same head at `gap: 6px`. Keyed on the phase rather than picking one, since the two
           readings belong to two different states of this one dialog. -->
      <h3 class:head-6={modalPhase !== "confirm"}>{prompt.title}</h3>
      <!-- FlashFailure.dc.html:84 puts the failure sentence in the head band directly under
           the title, 14px regular in the soft ink — the state's red is carried by the shell's
           danger lip, not by this line. -->
      {#if modalPhase === "error"}<p class="muted">{headline}</p>{/if}

      {#if modalPhase === "confirm"}
        {#if prompt.body}<p class="muted">{prompt.body}</p>{/if}
        <!-- Above the checkboxes on purpose: the version is WHAT is being installed and the
             checkboxes are what survives it, so the page reads target then terms. The refresh
             sits immediately after the picker because it acts on the picker's list, not on the
             dialog. -->
        {#if prompt.versionPicker}
          {@const vp = prompt.versionPicker}
          <div class="confirm-version">
            <label for="install-version">{vp.label}</label>
            <select
              id="install-version"
              value={vp.selected()}
              onchange={(e) => vp.onSelect(e.currentTarget.value)}
            >
              {#each vp.options() as o (o.value)}
                <option value={o.value}>{o.label}</option>
              {/each}
            </select>
            <RefreshButton onRefresh={vp.onRefresh} label={vp.refreshLabel} />
          </div>
        {/if}
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
          <Button variant="cancel" onclick={() => installProgress.cancel()}>{locale.t.shared.common.cancel}</Button>
          {#if prompt.confirmGate && !prompt.confirmGate.ready()}
            <Button variant="action" onclick={() => prompt.confirmGate?.onClick()}>
              {prompt.confirmGate.label}
            </Button>
          {:else}
            <Button variant={prompt.danger ? "destructive" : "action"} onclick={() => installProgress.confirm()}>
              {typeof prompt.confirmText === "function" ? prompt.confirmText() : prompt.confirmText}
            </Button>
          {/if}
        </div>
      {:else}
        {#if modalPhase === "running"}
          <p class="muted">{locale.t.shared.common.workingNotePre}<strong>{locale.t.shared.common.workingNoteBold}</strong>{locale.t.shared.common.workingNotePost}</p>
        {/if}
        <!-- Flat, always-visible checklist — every phase and every declared sub-step is a row
             at all times (done ✓ / active ● / pending ○), with its counter inline on the row.
             There is deliberately no expand/collapse: docs/design/mockups/GuidedFlashing.dc.html
             shows one flat list, and the old collapsed-by-default disclosure hid the real byte
             progress of the longest writes (docs/audit-write-progress.md). -->
        <div class="checklist">
          {#each prompt.phases as p (p.id)}
            {@const s = states[p.id]}
            {#if s}
              <!-- GuidedFlashing.dc.html's DONE phase rows carry no counter ("✓ Read existing
                   state", bare), while a done SUB-STEP keeps its own ("✓ Migrate installed games
                   [137/137]"). The two levels differ on purpose; only phases drop it. -->
              {@const pct = s.status === "done" ? null : phasePct(s)}
              <div class="row phase status-{s.status}">
                <!-- The spin follows the RUN, not the row: a stopped run leaves its in-flight
                     phase marked active (it neither finished nor failed, and saying either
                     would be a lie), and a spinner on a frozen checklist reads as still working. -->
                <span class="icon" class:spin={s.status === "active" && modalPhase === "running"} aria-hidden="true">{icon(s.status)}</span>
                <span class="label">{p.label}</span>
                {#if pct !== null}<span class="count mono">{pct}%</span>{/if}
              </div>
              {#if s.status === "active" && pct !== null}
                <div class="bar-row"><div class="track"><div class="fill" style:width="{pct}%"></div></div></div>
              {/if}
              {#each s.substeps as sub (sub.id)}
                {@const subStatus = s.substepStatus[sub.id] ?? "pending"}
                {@const subProgress = s.substepProgress[sub.id]}
                <div class="row substep status-{subStatus}">
                  <span class="icon" class:spin={subStatus === "active" && modalPhase === "running"} aria-hidden="true">{icon(subStatus)}</span>
                  <span class="label">{sub.label}</span>
                  {#if subProgress}<span class="count mono">{counter(subProgress)}</span>{/if}
                </div>
              {/each}
            {/if}
          {/each}
        </div>

        <!-- FlashingCancel.dc.html:85 draws ONE ruled footer row: the log disclosure hard left,
             and the caption + Cancel hard right. So the row exists while the operation runs even
             with nothing logged yet -- gating the whole section on the log having lines (as it
             was) would take the only way out with it, which is exactly the state the owner got
             stuck in. -->
        {#if auditLog.length > 0 || modalPhase === "running"}
          <div class="log-section">
           <div class="foot-row">
            {#if auditLog.length > 0}
            <button
              type="button"
              class="log-toggle clickable"
              aria-expanded={logOpen}
              onclick={() => installProgress.toggleLog()}
            >
              <!-- GuidedFlashing.dc.html:81 draws a 12px stroked chevron `M7 4l6 6-6 6`
                   (stroke-width 1.8), rotated down when the log is open. -->
              <svg
                class="chevron"
                class:open={logOpen}
                aria-hidden="true"
                width="12" height="12" viewBox="0 0 20 20"
                fill="none" stroke="currentColor" stroke-width="1.8"
                stroke-linecap="round" stroke-linejoin="round"
              >
                <path d="M7 4l6 6-6 6" />
              </svg>
              <span class="label">{locale.t.shared.installProgressModal.logLabel(auditLog.length)}</span>
            </button>
            {:else}
              <span></span>
            {/if}
            <!-- The way out. A text link, not a button: FlashingCancel.dc.html:21-27 is explicit
                 that "the primary act on this screen is waiting, and a filled control would
                 compete with the progress it sits under." It is never disabled while running;
                 once the stop is confirmed the pair collapses to the state word, because the
                 link has already done its one job and a second press does nothing. -->
            {#if modalPhase === "running"}
              <div class="cancel-group">
                {#if installProgress.cancelling}
                  <span class="cancel-caption">{locale.t.shared.installProgressModal.cancelPending}</span>
                {:else}
                  <span class="cancel-caption">{locale.t.shared.installProgressModal.cancelCaption}</span>
                  <button
                    type="button"
                    class="cancel-link clickable"
                    onclick={() => installProgress.requestCancel()}
                  >{locale.t.shared.common.cancel}</button>
                {/if}
              </div>
            {/if}
           </div>
            {#if logOpen && auditLog.length > 0}
              <pre class="log-box mono" use:autoScroll={auditText}>{auditText.join("\n")}</pre>
            {/if}
          </div>
        {/if}

        {#if modalPhase === "done"}
          <p class="ok">{locale.t.shared.common.done}</p>
          <div class="actions"><Button variant="action" onclick={() => installProgress.close()}>{locale.t.shared.common.close}</Button></div>
        {:else if modalPhase === "cancelled"}
          <!-- A stop is neither success nor failure, so it gets neither's treatment: no green
               line and no danger lip. It DOES get the failure footer's quiet Save log / Copy log
               pair, because the run that someone stopped is the run whose log they want -- the
               owner's report of this gap was that a stuck modal cost him the log entirely. -->
          <p class="muted">{locale.t.shared.installProgressModal.cancelledNote}</p>
          <div class="actions split">
            <div class="quiet-actions">
              <button type="button" class="save-log" onclick={() => installProgress.saveLog()}>
                {locale.t.shared.installProgressModal.saveLog}
              </button>
              <button type="button" class="save-log" onclick={() => void installProgress.copyLog()}>
                {locale.t.shared.installProgressModal.copyLog}
              </button>
            </div>
            <Button onclick={() => installProgress.close()}>{locale.t.shared.common.close}</Button>
          </div>
        {:else if modalPhase === "error"}
          {#if errorBlocks && errorBlocks.length > 0}
            <!-- FlashFailure.dc.html:84's "Blocks that failed" table: house 11px/700/0.11em
                 uppercase caption over an #e0e0e0 header rule, then one row per block —
                 a 62px mono danger "Block n" column, the region label, and the address in
                 mono. Row count follows the error; the board's three rows are a drawing. -->
            <div class="blocks">
              <div class="blocks-cap">{locale.t.shared.installProgressModal.blocksFailed}</div>
              {#each errorBlocks as b (b.bank + ":" + b.offset)}
                {@const region = regionLabelForBlock(b.bank === 0 ? extSegs : intSegs, b)}
                <div class="block-row">
                  <span class="block-id mono">{locale.t.shared.installProgressModal.blockLabel(b.blockIndex)}</span>
                  <span class="block-region">{region ?? ""}</span>
                  <span class="block-addr mono">{addr(b.address)}</span>
                </div>
              {/each}
            </div>
            <!-- The board's advice aside: a danger-tinted wash with a 2px danger left rule. -->
            <div class="advice">{locale.t.shared.installProgressModal.wiringAdvice}</div>
          {/if}
          <!-- FlashFailure.dc.html draws the failure footer split: the quiet "Save log" / "Copy log"
               pair hard left, the closing actions hard right. Both are local: Save log downloads
               the audit log this store already holds, Copy log puts the English rendering of it
               on the clipboard. Neither touches the device. The board's block-failure
               table IS here now (5e6f658): the engine carries per-block detail on
               `FlashVerifyError` (bank, offset, address, size, blockIndex, hashes) and
               `regionLabelForBlock()` supplies the label. Only the board's "Retry install"
               action is still absent — a retry after a partial write is a behaviour decision,
               not paint. -->
          <div class="actions split">
            <div class="quiet-actions">
              <button type="button" class="save-log" onclick={() => installProgress.saveLog()}>
                {locale.t.shared.installProgressModal.saveLog}
              </button>
              <!-- Copy log is Save log's sibling, same quiet treatment, and copies the log in
                   ENGLISH whatever the UI language so a bug report always reads the same.
                   The promise is deliberately not awaited here: the store handles a rejected
                   clipboard write itself (it falls back to the download) and never throws. -->
              <button type="button" class="save-log" onclick={() => void installProgress.copyLog()}>
                {locale.t.shared.installProgressModal.copyLog}
              </button>
            </div>
            <Button onclick={() => installProgress.close()}>{locale.t.shared.common.close}</Button>
          </div>
        {/if}
      {/if}
    {/snippet}
  </ModalShell>

  <!-- FlashingCancelConfirm.dc.html: 416px, a solid --danger lip (the board's #8a241b is exactly
       that token), over a lighter scrim than the modal beneath it. `--z-modal-prompt` is the
       scale's slot for a dialog that must sit above another open modal.

       DISMISSING THIS IS NOT CANCELLING. Backdrop, Escape and Back all land on `dismissCancel`,
       which leaves the run alone -- so this dialog IS dismissable while the running modal below
       it stays deliberately un-dismissable. Only the Stop button aborts. -->
  {#if installProgress.cancelPrompt}
    <ModalShell
      maxWidth="416px"
      lip="danger"
      zIndex="var(--z-modal-prompt)"
      onDismiss={() => installProgress.dismissCancel()}
    >
      {#snippet children()}
        <h3 class="head-6">{locale.t.shared.installProgressModal.cancelTitle}</h3>
        <p class="muted">{locale.t.shared.installProgressModal.cancelBody}</p>
        <div class="actions">
          <Button variant="cancel" onclick={() => installProgress.dismissCancel()}>
            {locale.t.shared.installProgressModal.cancelKeep}
          </Button>
          <Button variant="destructive" onclick={() => installProgress.confirmCancel()}>
            {locale.t.shared.installProgressModal.cancelStop}
          </Button>
        </div>
      {/snippet}
    </ModalShell>
  {/if}
{/if}

<style>
  /* ModalInstallConfirm.dc.html:243 — 18px/600/-0.01em, with a 4px gap to the body line. */
  h3 {
    font-size: var(--fs-title);
    font-weight: 600;
    letter-spacing: -0.01em;
    margin-bottom: 4px;
  }
  h3.head-6 {
    margin-bottom: 6px;
  }
  .muted {
    color: var(--ink-soft);
    font-size: var(--fs-caption);
  }
  /* GuidedFlashing.dc.html:81 sets the "do not unplug your device" run in the caution ink
     (`#8a6508`) rather than letting it inherit the muted grey. --band-busy-ink is that exact
     hex and already carries a dark-theme sibling. */
  .muted strong {
    color: var(--band-busy-ink);
  }
  /* Label, picker, refresh on one line. `align-items: center` rather than baseline, because the
     refresh is a 28px box and a baseline row would hang it below the text it sits beside. */
  .confirm-version {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: var(--fs-caption);
    color: var(--ink-soft);
    margin-top: 0.75rem;
  }
  /* The picker carries the release tags, which are data rather than prose, so it takes the
     mono face the artboards use wherever a version is shown. `min-width: 0` because a long tag
     must shorten the control rather than widen the dialog. */
  .confirm-version select {
    min-width: 0;
    flex: 1 1 auto;
    max-width: 22ch;
    font-family: var(--font-mono);
    font-size: var(--fs-caption);
    color: var(--ink);
    background: var(--surface);
    border: 1px solid var(--hairline);
    border-radius: 6px;
    padding-block: 0.25rem;
    padding-inline: 0.4rem;
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
  /* ModalInstallConfirm.dc.html:243 — the action row sits 22px below the body with a 20px
     gap between Cancel and the confirm button. */
  .actions {
    display: flex;
    gap: 20px;
    justify-content: flex-end;
    margin-top: 22px;
  }
  /* FlashFailure.dc.html:84 draws the failure footer as a full-bleed band ruled off from the
     body — `border-top: 1px solid #d8d8d8; margin-top: 20px; padding: 16px 24px` — with the
     quiet action hard left and the closing actions hard right. The negative margins cancel
     ModalShell's padded body (22px 24px 20px) so the rule reaches both frame edges; the
     default .actions row stays right-aligned and unruled everywhere else. */
  .actions.split {
    justify-content: space-between;
    align-items: center;
    margin: 20px -1.5rem -1.25rem;
    padding: 16px 1.5rem;
    border-top: 1px solid var(--hairline);
  }
  /* Board: 13px/500 in the soft ink, no button chrome. */
  /* FlashFailure.dc.html:84 puts the two quiet actions in one left-hand group at `gap: 18px`.
     The 0.3rem of horizontal padding on each button's hover target eats into that, so the gap
     is set a touch under the board's figure to keep the drawn spacing between the words. */
  .quiet-actions {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .save-log {
    font: inherit;
    font-size: var(--fs-btn-sm);
    font-weight: 500;
    color: var(--ink-soft);
    background: none;
    border: none;
    padding: 0.35rem 0.3rem;
    border-radius: var(--r-control);
    cursor: pointer;
  }
  .save-log:hover {
    background: var(--surface-sunk);
    color: var(--ink);
  }
  .ok {
    color: var(--zelda-green);
    font-weight: 600;
  }
  /* FlashFailure.dc.html:84 — caption 11px/700/0.11em uppercase over a header rule, rows at
     `gap: 14px; padding: 9px 0` divided by 1px #ededed with none under the last. The board's
     header rule is #e0e0e0, which has no token; --hairline (#d8d8d8) and --rule (#ededed)
     bracket it and --rule is the nearer, and is already the divider used one line below. */
  .blocks {
    display: flex;
    flex-direction: column;
    margin-top: 18px;
  }
  .blocks-cap {
    font-size: var(--fs-label);
    font-weight: 700;
    letter-spacing: var(--label-track);
    text-transform: uppercase;
    color: var(--ink-soft);
    padding-bottom: 8px;
    border-bottom: 1px solid var(--rule);
  }
  .block-row {
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 9px 0;
    border-bottom: 1px solid var(--rule);
  }
  .block-row:last-child {
    border-bottom: none;
  }
  .block-id {
    font-size: var(--fs-chip);
    font-weight: 600;
    color: var(--danger);
    width: 62px;
    flex-shrink: 0;
  }
  /* Artboard is 13px; no 13px prose token exists — nearest is --fs-btn-sm (13px), which is a
     control face, so the quiet-caption --fs-micro (12px) is used, as elsewhere in this file. */
  .block-region {
    font-size: var(--fs-micro);
    color: var(--ink);
    flex-grow: 1;
  }
  .block-addr {
    font-size: var(--fs-chip);
    font-weight: 400;
    color: var(--ink-soft);
    flex-shrink: 0;
  }
  /* `background: #fbf1ef; border-left: 2px solid #8a241b; border-radius: 0 3px 3px 0;
     padding: 10px 12px` — --tint-danger is that exact wash and carries a dark-theme sibling. */
  .advice {
    margin-top: 16px;
    background: var(--tint-danger);
    border-inline-start: 2px solid var(--danger);
    border-radius: 0 3px 3px 0;
    padding: 10px 12px;
    font-size: var(--fs-micro);
    color: var(--ink);
  }
  /* Flat checklist — geometry lifted from docs/design/mockups/GuidedFlashing.dc.html:
     12px icon column, 11px/10px gaps, 7px phase / 5px sub-step row padding, 23px sub-step
     indent, 4px bar. */
  .checklist {
    display: flex;
    flex-direction: column;
    margin-top: 0.75rem;
  }
  .row {
    display: flex;
    align-items: center;
  }
  .row.phase {
    gap: 0.7rem;
    padding: 7px 0;
  }
  .row.substep {
    gap: 0.65rem;
    /* An indent under its phase row, so it is an inline-start concept, not a left one. */
    padding-block: 5px;
    padding-inline: 23px 0;
  }
  .icon {
    width: 12px;
    text-align: center;
    flex-shrink: 0;
    font-size: var(--fs-caption);
    color: var(--ink-dim);
  }
  .row.substep .icon {
    font-size: var(--fs-micro);
  }
  .status-done .icon {
    color: var(--zelda-green);
  }
  .status-error .icon {
    color: var(--action-red);
  }
  .status-active .icon {
    color: var(--ink);
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
  }
  .row.phase .label {
    font-size: var(--fs-caption);
    font-weight: 500;
    color: var(--ink);
  }
  .row.phase.status-active .label {
    font-weight: 600;
  }
  .row.phase.status-pending .label {
    font-weight: 400;
    color: var(--ink-dim);
  }
  /* Artboard is 13px; no 13px token exists — nearest is --fs-micro (12px). */
  .row.substep .label {
    font-size: var(--fs-micro);
    color: var(--ink-soft);
  }
  .row.substep.status-pending .label {
    color: var(--ink-dim);
  }
  .count {
    font-size: var(--fs-micro);
    color: var(--ink-soft);
    flex-shrink: 0;
  }
  .bar-row {
    /* Indented to line up with `.row.substep` above, and mirrors with it. */
    padding-block: 2px 8px;
    padding-inline: 23px 0;
  }
  .track {
    height: 4px;
    border-radius: 2px;
    background: var(--surface-sunk);
    overflow: hidden;
  }
  .fill {
    height: 100%;
    background: var(--zelda-green);
    transition: width 150ms ease;
  }
  .log-section {
    margin-top: 14px;
    padding-top: 14px;
    border-top: 1px solid var(--rule);
  }
  /* FlashingCancel.dc.html:85's footer: the disclosure hard left, the caption and the way out
     hard right, on one line. `align-items: baseline` is the board's own alignment for the right
     pair, so the 12px caption sits on the same baseline as the 14px link rather than centred
     against it. */
  .foot-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
  }
  .cancel-group {
    display: flex;
    align-items: baseline;
    gap: 12px;
  }
  /* Board: 12px `#9a9aa0`. That is `--ink-dim` (#9a9a9a, "de-emphasised captions"), NOT
     `--ink-faint`, whose own token comment says it is "NOT for anything that must be read" --
     and this caption is the one place the block-boundary behaviour is stated. */
  .cancel-caption {
    font-size: var(--fs-micro);
    color: var(--ink-dim);
  }
  /* Board: 14px/500 in the soft ink, no button chrome. Deliberately NOT a Button: a filled
     control here would compete with the progress it sits under (FlashingCancel.dc.html:21-27). */
  .cancel-link {
    background: none;
    border: 0;
    padding: 0;
    font: inherit;
    font-size: var(--fs-btn-sm);
    font-weight: 500;
    color: var(--ink-soft);
  }
  .cancel-link:hover {
    color: var(--ink);
  }
  .log-toggle {
    display: flex;
    align-items: center;
    gap: 9px;
    /* `auto`, not `100%`: it is now one half of `.foot-row`, and a full-width child would push
       the cancel group off the end of the row. */
    width: auto;
    text-align: start;
    font: inherit;
    /* GuidedFlashing.dc.html:81 — `font-size: 13px; font-weight: 500; color: #5c5c5c`. */
    font-size: var(--fs-btn-sm);
    font-weight: 500;
    background: none;
    border: none;
    color: var(--ink-soft);
    padding: 0.35rem 0.3rem;
    border-radius: var(--r-control);
  }
  .log-toggle.clickable {
    cursor: pointer;
  }
  .chevron {
    flex: 0 0 auto;
    transition: transform 120ms ease;
  }
  .chevron.open {
    transform: rotate(90deg);
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
