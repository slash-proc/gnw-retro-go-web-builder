<script lang="ts">
  /**
   * ACTIVITY — `docs/design/proposals/overview-v2/Activity.dc.html`.
   *
   * The destination that was missing. Everything the app did was reported in one line under
   * whatever row triggered it, so a converter's warning appeared under every homebrew and a
   * failure read the same weight as a note. This is where those go instead.
   *
   * WHERE IT LIVES. The board draws Activity as an item in an Overview rail (`CONSOLE: Status,
   * Details / LOGS: Activity, Device log`). That rail is a PROPOSAL and is not built. Rather
   * than half-build it, this is a section in the Overview tab, sitting immediately above the
   * device-log accordion — which is the very thing the rail's LOGS group pairs it with, in the
   * same order. When the rail lands, these two accordions become its two LOGS items and neither
   * one's internals move.
   *
   * IT DOES NOT NEED A DEVICE. Everything else on this tab is inside `{#if device.isConnected}`;
   * this is not, because the log is this session's record of what the APP did and is frequently
   * the most useful thing on screen when nothing is plugged in. The board's no-device state says
   * the same: the Activity rail item stays live while the console panes dim.
   *
   * COPY AND SAVE SIT ON THE COUNT LINE, not in a footer. They were in the page footer band in
   * the same button as Rescan, and the owner looked straight at them and reported them missing:
   * the eye goes header, filters, list, and never returns to the bottom of a long page. Beside
   * "Showing 8 of 34" they are next to the line stating what they act on — the filtered set,
   * which is what `auditLog.copyText()` renders.
   */
  import { auditLog, type AuditSession, type AuditSeverity, type AuditSource, type SeverityFilter } from "../auditLog.svelte.js";
  import { locale } from "../i18n/locale.svelte.js";
  import { renderEntry } from "../logEntry.js";
  import { download } from "../util.js";

  const t = $derived(locale.t.shared.auditLog);
  const rows = $derived(auditLog.filtered);

  /**
   * THE SESSIONS, DRAWN ONLY WHEN THERE IS MORE THAN ONE.
   *
   * A list of one row would filter to everything the pane already shows, which is a control with
   * nothing to do. Whether a second sitting exists is carried by the list being PRESENT or ABSENT
   * rather than by a row that says so (docs/UI_VOICE.md 3, the same rule that deleted
   * `chooseFiles`).
   */
  const sessions = $derived(auditLog.sessions);
  const showSessions = $derived(sessions.length > 1);

  /** `util.timestamp()` is `YYYY-MM-DD HH:MM:SS`. Split positionally rather than through `Date`:
   *  it was written from LOCAL parts, and re-parsing it only invites a zone shift on a value that
   *  is already local. */
  function dayOf(ts: string): string {
    return ts.split(" ")[0] ?? "";
  }
  function clockOf(ts: string): string {
    return ts.split(" ")[1] ?? ts;
  }

  /** `12 Sep`, in the reading language. A date is runtime text, not copy, so it is formatted here
   *  rather than carried as a string key -- the same rule byte counts and version numbers follow. */
  function dayLabel(ts: string): string {
    const [y, m, d] = dayOf(ts).split("-").map(Number);
    if (!y || !m || !d) return dayOf(ts);
    return new Intl.DateTimeFormat(locale.current, { day: "numeric", month: "short" }).format(
      new Date(y, m - 1, d),
    );
  }

  /** What a session row states as its start: the load time where one was recorded, and otherwise
   *  its first surviving entry. The fallback is the block that predates the stamp, and reading a
   *  real entry's time is the honest answer for it -- nothing is invented either way. */
  function startOf(s: AuditSession): string {
    return s.startedAt ?? s.firstAt;
  }

  const segments = $derived<{ id: SeverityFilter; label: string }[]>([
    { id: "all", label: t.sevAll },
    { id: "info", label: t.sevInfo },
    { id: "warning", label: t.sevWarning },
    { id: "error", label: t.sevError },
  ]);
  const chips = $derived<{ id: AuditSource; label: string }[]>([
    { id: "converter", label: t.srcConverter },
    { id: "device", label: t.srcDevice },
    { id: "sources", label: t.srcSources },
  ]);

  /** Errors carried by the CURRENT SCOPE, for the count the board draws inside the Error segment.
   *  Not `auditLog.unattended` — that is the bell's unseen count, a different question. Scoped
   *  rather than counted over the whole record, so picking a sitting does not leave the segment
   *  advertising errors from sittings that are no longer on screen. */
  const errorCount = $derived(auditLog.inScope.filter((e) => e.severity === "error").length);

  function copy(): void {
    void navigator.clipboard?.writeText(auditLog.copyText());
  }
  function save(): void {
    download(t.saveFilename, new Blob([auditLog.copyText()], { type: "text/plain" }));
  }
  function dotClass(s: AuditSeverity): string {
    return `dot sev-${s}`;
  }
</script>

<div class="activity">
  <div class="filters">
    <div class="segment" role="group" aria-label={t.sevAll}>
      {#each segments as s (s.id)}
        <button
          class="seg"
          class:on={auditLog.severityFilter === s.id}
          type="button"
          aria-pressed={auditLog.severityFilter === s.id}
          onclick={() => (auditLog.severityFilter = s.id)}
        >
          {s.label}{#if s.id === "error" && errorCount > 0}<span class="segcount">{errorCount}</span>{/if}
        </button>
      {/each}
    </div>

    <!-- Debug is a separate toggle rather than a peer in the segment: it is a capture mode, not
         another view of the same records, and it is off until asked for. That default is the
         precondition `auditLog`'s severity comment names for ever routing `dbg()` in here. -->
    <button
      class="chip dashed"
      class:on={auditLog.showDebug}
      type="button"
      aria-pressed={auditLog.showDebug}
      onclick={() => (auditLog.showDebug = !auditLog.showDebug)}
    >{t.sevDebug}</button>

    <span class="vrule" aria-hidden="true"></span>

    {#each chips as c (c.id)}
      <button
        class="chip"
        class:on={auditLog.sourceFilter.includes(c.id)}
        type="button"
        aria-pressed={auditLog.sourceFilter.includes(c.id)}
        onclick={() => auditLog.toggleSource(c.id)}
      >{c.label}</button>
    {/each}

    <span class="spacer"></span>

    <label class="search">
      <svg width="13" height="13" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true">
        <circle cx="9" cy="9" r="5.5" /><path d="M13.5 13.5L17 17" />
      </svg>
      <input type="search" placeholder={t.filterPlaceholder} aria-label={t.filterPlaceholder} bind:value={auditLog.query} />
    </label>
  </div>

  {#if showSessions}
    <!-- ONE ROW PER PAGE LOAD, oldest first, each stating the day and the clock time it ran
         between. Picking one narrows the list below to it; picking it again returns the whole
         record, so there is no separate "all" row to keep in step.

         THE LIVE SESSION HAS NO END, and is drawn that way: the row carries a start and stops,
         where a finished one carries both times, and an accent edge marks it as the one still
         running. No word says "ongoing" -- the missing half of the range is the statement
         (docs/UI_VOICE.md 3). -->
    <div class="sessions" role="group" aria-label={t.sessions}>
      {#each sessions as s (s.id)}
        <button
          class="session"
          class:on={auditLog.activeSession === s.id}
          class:live={s.live}
          type="button"
          aria-pressed={auditLog.activeSession === s.id}
          onclick={() => auditLog.selectSession(s.id)}
        >
          <span class="sday">{dayLabel(startOf(s))}</span>
          <span class="sclock">{clockOf(startOf(s))}</span>
          {#if !s.live}
            <span class="sto" aria-hidden="true">-</span>
            <!-- A session that ran across midnight names the end's day too, rather than letting
                 the row's single date quietly stand for both. -->
            {#if dayOf(s.lastAt) !== dayOf(startOf(s))}
              <span class="sday">{dayLabel(s.lastAt)}</span>
            {/if}
            <span class="sclock">{clockOf(s.lastAt)}</span>
          {/if}
        </button>
      {/each}
    </div>
  {/if}

  <div class="countline">
    <!-- THE TOTAL IS THE CHOSEN SESSION'S, not the whole record. Picking a session chooses which
         record is on screen; the segment, the chips and the search narrow inside it. Saying
         `of 312` while one sitting was selected is the defect the owner reported, and it was in
         this line rather than in the list below it. -->
    <span class="count">{t.showing(rows.length, auditLog.inScope.length)}</span>
    <span class="acts">
      <button class="mini" type="button" onclick={copy}>{t.copy}</button>
      <button class="mini" type="button" onclick={save}>{t.save}</button>
    </span>
  </div>

  {#if rows.length === 0}
    <p class="empty">{t.empty}</p>
  {:else}
    <!-- The list scrolls ITSELF. `.tabpane` is the app's only general scroll container and this
         is inside it, so an unbounded 500-row list would push the rest of the tab far below the
         fold. `overflow-y: auto` on this box only — never `overflow: hidden`, and never on a
         pane, shell or page, where the clip is invisible to every gate in the repo. -->
    <div class="list">
      {#each rows as e, i (e.id)}
        <div class="row">
          <span class="time">{e.time}</span>
          <span class={dotClass(e.severity)} aria-hidden="true"></span>
          <span class="body">
            {#if e.subject}<span class="subject">{e.subject}</span>{/if}
            {renderEntry(e.message, locale.t)}
          </span>
        </div>
        <!-- THE RELOAD BOUNDARY, at EVERY change of session rather than once.
             It used to key on `restored`, a boolean, so a record spanning five loads drew a single
             rule between "before this load" and "this load" and ran the other four together. The
             session an entry carries is what the loads actually are, so the rule falls wherever
             two neighbouring lines were written by different ones.

             Drawn from the FILTERED rows, so a filter that hides one side of a boundary hides the
             rule with it rather than marking a break that is not there. A rule and not a per-row
             marker, because a fact about a row is carried by the shape and never by its wording
             (docs/UI_VOICE.md 3). -->
        {#if rows[i + 1] !== undefined && rows[i + 1].session !== e.session}
          <div class="reload" role="separator">{t.reloaded}</div>
        {/if}
      {/each}
    </div>
  {/if}
</div>

<style>
  .activity {
    display: flex;
    flex-direction: column;
    gap: 0.85rem;
    min-width: 0;
  }
  .filters {
    display: flex;
    align-items: center;
    gap: 0.7rem;
    flex-wrap: wrap;
  }
  .segment {
    display: inline-flex;
    border: 1px solid var(--hairline);
    border-radius: 5px;
    overflow: hidden;
    background: var(--surface);
  }
  .seg {
    font: inherit;
    font-size: var(--fs-caption);
    font-weight: 500;
    padding: 0.32rem 0.85rem;
    background: none;
    border: none;
    border-inline-start: 1px solid var(--hairline);
    color: var(--ink);
    cursor: pointer;
  }
  .seg:first-child {
    border-inline-start: none;
  }
  .seg.on {
    background: var(--ink);
    color: var(--surface);
    font-weight: 600;
  }
  .segcount {
    color: var(--danger);
    font-weight: 700;
    margin-inline-start: 0.35rem;
  }
  .seg.on .segcount {
    color: var(--surface);
  }
  .chip {
    font: inherit;
    font-size: var(--fs-micro);
    font-weight: 600;
    padding: 0.28rem 0.75rem;
    border-radius: 999px;
    border: 1px solid var(--hairline);
    background: var(--surface);
    color: var(--ink-soft);
    cursor: pointer;
  }
  .chip.dashed {
    border-style: dashed;
  }
  .chip.on {
    background: var(--ink);
    border-color: var(--ink);
    color: var(--surface);
  }
  .vrule {
    width: 1px;
    height: 1.25rem;
    background: var(--hairline);
  }
  .spacer {
    flex-grow: 1;
  }
  .search {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    border: 1px solid var(--hairline);
    border-radius: 5px;
    background: var(--surface);
    padding: 0.3rem 0.7rem;
    min-width: 11rem;
    color: var(--ink-soft);
  }
  .search input {
    border: none;
    background: none;
    font: inherit;
    font-size: var(--fs-caption);
    color: var(--ink);
    min-width: 0;
    width: 100%;
  }
  .search input:focus {
    outline: none;
  }
  .search:focus-within {
    outline: 2px solid var(--model-accent);
    outline-offset: 1px;
  }
  /* The sessions list. Its own bordered box with its own scroll, the same shape as the entry
     list below it, and capped so a tab left open all day cannot push the entries off screen.
     Never `overflow: hidden` here or on anything above it. */
  .sessions {
    display: flex;
    flex-direction: column;
    background: var(--surface);
    border: 1px solid var(--hairline);
    border-radius: var(--r-card);
    padding: 0.2rem 0;
    max-height: 8rem;
    overflow-y: auto;
  }
  .session {
    display: flex;
    align-items: baseline;
    gap: 0.5rem;
    font: inherit;
    font-size: var(--fs-micro);
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
    text-align: start;
    color: var(--ink-soft);
    background: none;
    border: none;
    /* The accent edge the live row fills. Reserved on every row so selecting one does not
       shift the text of the others sideways. */
    border-inline-start: 2px solid transparent;
    padding: 0.3rem 1rem;
    cursor: pointer;
  }
  .session:hover {
    background: var(--surface-sunk);
  }
  .session.on {
    background: var(--ink);
    color: var(--surface);
  }
  .session.live {
    border-inline-start-color: var(--model-accent);
    color: var(--ink);
  }
  .session.live.on {
    color: var(--surface);
  }
  .sday {
    font-family: var(--font-sans);
    font-weight: 600;
  }
  .sto {
    opacity: 0.6;
  }
  .session:focus-visible {
    outline: 2px solid var(--model-accent);
    outline-offset: -2px;
  }
  .countline {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1.25rem;
  }
  .count {
    font-size: var(--fs-micro);
    color: var(--ink-soft);
    font-variant-numeric: tabular-nums;
  }
  .acts {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }
  .mini {
    font: inherit;
    font-size: var(--fs-micro);
    font-weight: 600;
    color: var(--ink);
    background: var(--surface);
    border: 1px solid var(--ink);
    border-radius: 4px;
    padding: 0.15rem 0.75rem;
    cursor: pointer;
  }
  .mini:hover {
    background: var(--surface-sunk);
  }
  .mini:focus-visible,
  .seg:focus-visible,
  .chip:focus-visible {
    outline: 2px solid var(--model-accent);
    outline-offset: 1px;
  }
  .empty {
    margin: 0;
    padding: 1.5rem 0;
    font-size: var(--fs-caption);
    color: var(--ink-soft);
  }
  .list {
    background: var(--surface);
    border: 1px solid var(--hairline);
    border-radius: var(--r-card);
    padding: 0.25rem 1.1rem;
    max-height: 26rem;
    overflow-y: auto;
  }
  .row {
    display: flex;
    align-items: flex-start;
    gap: 0.85rem;
    padding: 0.7rem 0;
    border-bottom: 1px solid var(--hairline);
  }
  .row:last-child {
    border-bottom: none;
  }
  /* The row above the boundary gives up its own rule, so the gap carries one line and not two. */
  .row:has(+ .reload) {
    border-bottom: none;
  }
  .time {
    font-size: var(--fs-micro);
    color: var(--ink-soft);
    font-family: var(--font-mono);
    padding-top: 0.1rem;
    flex-shrink: 0;
  }
  .dot {
    width: 5px;
    height: 5px;
    border-radius: 999px;
    margin-top: 0.5rem;
    flex-shrink: 0;
    background: var(--hairline);
  }
  .dot.sev-error {
    background: var(--danger);
  }
  .dot.sev-warning {
    background: var(--caution);
  }
  .body {
    font-size: var(--fs-caption);
    min-width: 0;
    flex-grow: 1;
    overflow-wrap: anywhere;
  }
  .subject {
    font-family: var(--font-mono);
    color: var(--ink-soft);
    margin-inline-end: 0.5rem;
  }
  /* The reload boundary: a hairline across the list carrying its own name. It replaces the row
     border above it rather than adding a second line, so the list keeps one rule per gap. */
  .reload {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    padding: 0.55rem 0;
    font-size: var(--fs-micro);
    color: var(--ink-soft);
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }
  .reload::after {
    content: "";
    flex-grow: 1;
    height: 1px;
    background: var(--hairline);
  }
</style>
