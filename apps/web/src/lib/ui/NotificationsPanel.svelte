<script lang="ts">
  /**
   * THE BELL'S PANEL — `docs/design/proposals/overview-v2/Notifications.dc.html`.
   *
   * ERRORS ONLY, list and count alike: `auditLog.notifications` is the one rule both read, and
   * they were two rules once — the badge filtered to errors while the surface listed every
   * entry, so the badge stayed dark while a DOOM crop warning sat in the panel. The owner saw
   * exactly that and said "I want to see a notification ONLY if we're seeing an error."
   *
   * DISMISSAL IS ABOUT THE BELL, NOT THE RECORD. The per-row control and the footer's Clear both
   * set `seen`, so an entry leaves this list and stays in Activity. Nothing here can destroy
   * evidence; `auditLog.clear()` is the destructive one and is deliberately not reachable from
   * this panel.
   *
   * EMPTY IS THIS SAME PANEL. The board is explicit that there is no separate empty popover —
   * the bell opens the panel it always opens, with nothing in it. The count disappears rather
   * than reading 0 and Clear disappears rather than sitting there disabled, because there is
   * nothing to count and nothing to clear. `Open Activity` stays: the full record still exists,
   * which is the whole point of the distinction.
   */
  import { auditLog } from "../auditLog.svelte.js";
  import { locale } from "../i18n/locale.svelte.js";

  let { onOpenActivity }: { onOpenActivity: () => void } = $props();

  const items = $derived(auditLog.notifications);
  const t = $derived(locale.t.shared.auditLog);
</script>

<div class="panel" role="dialog" aria-label={t.notificationsTitle}>
  <div class="phead">
    <span class="ptitle">{t.notificationsTitle}</span>
    {#if items.length > 0}<span class="pcount">{items.length}</span>{/if}
  </div>

  {#if items.length === 0}
    <div class="pempty">{t.noneWaiting}</div>
  {:else}
    <!-- The list scrolls itself rather than growing the popover past the viewport. `overflow-y`
         only, never `overflow: hidden`, and never on a pane, shell or page: that clip is
         invisible to every gate in this repo. Same shape as `.lang-menu` two controls over. -->
    <div class="plist">
      {#each items as e (e.id)}
        <div class="prow">
          <span class="dot" aria-hidden="true"></span>
          <div class="ptext">
            {#if e.subject}<span class="psubject">{e.subject}</span>{/if}
            <span class="pline">{auditLog.line(e)}</span>
          </div>
          <button
            class="pdismiss"
            type="button"
            title={t.dismissNotification}
            aria-label={t.dismissNotification}
            onclick={() => auditLog.dismiss(e.id)}
          >
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" aria-hidden="true">
              <path d="M1 1l8 8M9 1l-8 8" />
            </svg>
          </button>
        </div>
      {/each}
    </div>
  {/if}

  <div class="pfoot">
    <button class="plink" type="button" onclick={onOpenActivity}>{t.openActivity}</button>
    {#if items.length > 0}
      <button class="pclear" type="button" onclick={() => auditLog.markSeen()}>{t.clearNotifications}</button>
    {/if}
  </div>
</div>

<style>
  .panel {
    position: absolute;
    top: 100%;
    inset-inline-end: 0;
    margin-top: 0.5rem;
    width: 380px;
    max-width: min(380px, calc(100vw - 2rem));
    box-sizing: border-box;
    background: var(--surface);
    border: 1px solid var(--hairline);
    border-radius: var(--r-card);
    box-shadow: var(--shadow-card, 0 8px 24px rgba(0, 0, 0, 0.14));
    z-index: var(--z-popover);
    display: flex;
    flex-direction: column;
    text-align: start;
  }
  .phead {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    padding: 0.85rem 1.1rem;
    border-bottom: 1px solid var(--hairline);
  }
  .ptitle {
    font-size: var(--fs-caption);
    font-weight: 700;
    letter-spacing: 0.11em;
    text-transform: uppercase;
    color: var(--ink-soft);
  }
  .pcount {
    font-size: var(--fs-caption);
    color: var(--ink-soft);
    font-variant-numeric: tabular-nums;
  }
  .pempty {
    padding: 1.9rem 1.1rem;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: var(--fs-caption);
    color: var(--ink-soft);
  }
  .plist {
    padding: 0.25rem 1.1rem;
    max-height: 22rem;
    overflow-y: auto;
  }
  .prow {
    display: flex;
    align-items: flex-start;
    gap: 0.75rem;
    padding: 0.8rem 0;
    border-bottom: 1px solid var(--hairline);
  }
  .prow:last-child {
    border-bottom: none;
  }
  .dot {
    width: 5px;
    height: 5px;
    border-radius: 999px;
    background: var(--danger);
    margin-top: 0.45rem;
    flex-shrink: 0;
  }
  .ptext {
    display: flex;
    flex-direction: column;
    gap: 0.18rem;
    min-width: 0;
    flex-grow: 1;
  }
  .psubject {
    font-family: var(--font-mono);
    font-size: var(--fs-caption);
    color: var(--ink-soft);
    overflow-wrap: anywhere;
  }
  .pline {
    font-size: var(--fs-caption);
    color: var(--ink);
    overflow-wrap: anywhere;
  }
  .pdismiss {
    flex-shrink: 0;
    margin-top: 0.35rem;
    background: none;
    border: none;
    padding: 2px;
    cursor: pointer;
    color: var(--ink-soft);
    display: flex;
    line-height: 0;
  }
  .pdismiss:hover {
    color: var(--ink);
  }
  .pdismiss:focus-visible {
    outline: 2px solid var(--model-accent);
    outline-offset: 1px;
  }
  .pfoot {
    border-top: 1px solid var(--hairline);
    background: var(--surface-sunk);
    padding: 0.65rem 1.1rem;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    border-radius: 0 0 var(--r-card) var(--r-card);
  }
  .plink,
  .pclear {
    background: none;
    border: none;
    padding: 0;
    font: inherit;
    font-size: var(--fs-caption);
    font-weight: 600;
    cursor: pointer;
  }
  .plink {
    color: var(--zelda-green);
  }
  .pclear {
    color: var(--ink-soft);
  }
  .plink:focus-visible,
  .pclear:focus-visible {
    outline: 2px solid var(--model-accent);
    outline-offset: 2px;
  }
</style>
