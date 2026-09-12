/**
 * THE GLOBAL AUDIT LOG — one channel for everything the app has to say about work it did.
 *
 * WHY THIS EXISTS. Conversion had no output channel at all. A converter module's `warnings[]`
 * are, per gwrg-dist-spec, "the only voice a module has" (`sources/homebrewConvert.ts`), and
 * the UI gave that voice exactly one destination: a line under a Library row, inline, at full
 * length. The owner saw an eleven-item lump inventory in body text under his game — and before
 * `prepareState` split its verdicts, that same line appeared under EVERY homebrew, because the
 * slot was store-wide. Three separate defects landed in the same pixel in one day, which is the
 * signature of a missing channel rather than three bugs.
 *
 * The device side never had this problem: `installProgress.svelte.ts` gives a flash phases,
 * sub-steps and an audit log, because someone designed it somewhere to speak. This is that,
 * for everything else.
 *
 * NOT `debug.ts`. That is a dev-only sink which POSTs to `/api/debug` so a developer can `tail`
 * a file; it has no in-app surface and the user never sees it.
 *
 * STORE-LEVEL SINGLETON, rendered at the App root — the same rule as `installProgress` and
 * `device.stubPrompt`. CLAUDE.md records that a component-local version of the progress modal
 * was destroyed mid-flash by an unrelated `{#if}` unmount elsewhere in the tree; a log that
 * vanished when the user changed tab would be the same mistake with a quieter failure.
 *
 * IT SURVIVES A RELOAD. `auditLogPersist.ts` mirrors the entries into `sessionStorage`, because
 * a refresh is how anyone escapes a wedged UI and the log is most wanted immediately after one.
 * Restored entries come back `seen`, so the bell cannot ring for a page load. Because it survives,
 * the record spans several sittings, and each entry carries the page load that wrote it -- see
 * `AuditSession` for what that buys and why the load time is kept apart from the entries.
 *
 * ENTRIES ARE DATA, NOT TEXT. The message is a `LogEntry` (`logEntry.ts`), rendered at DISPLAY
 * time: the user reads it in their own language and `copyText()` renders the same entries
 * against the English table, so a pasted bug report is the same for everyone. A module's own
 * warning is `literal()` — runtime text, never translated, in any locale.
 */
import { restore as restoreLog, save as saveLog } from "./auditLogPersist.js";
import { setDbgSink } from "./debug.js";
import { en, type Strings } from "./i18n/en.js";
import { locale } from "./i18n/locale.svelte.js";
import { literal, renderEntry, type LogEntry } from "./logEntry.js";
import { timestamp } from "./util.js";

/**
 * FOUR SEVERITIES. The owner chose these so the Activity pane's filter has something to filter
 * by, and so verbose capture has somewhere to live (`docs/design/proposals/overview-v2/`).
 *
 * This replaces a two-level `note | error`, whose comment argued against a third level on the
 * grounds that nothing emitted one. That was true of the store in isolation and wrong about the
 * product: a filter needs levels to select, and a bug report needs a place to put detail that
 * is normally hidden.
 *
 *   `debug`    Detail nobody reads until something is wrong. Hidden by default; the filter is
 *              what reveals it. FED BY `dbg()` — see the note below.
 *   `info`     A run that succeeded, reporting WHAT IT DID. A converter module's own warnings
 *              are this: `cropped 11 widescreen lumps to 320w` is a transformation performed,
 *              not a doubt about the outcome. The owner named this one himself, of the DOOM
 *              crop line: "This is essentially an info message from the doom wad converter."
 *   `warning`  A run that succeeded, reporting something about the RESULT the user may not have
 *              intended. A file used under `strict: false` is this: the gate could not identify
 *              it, used it anyway, and the output was named from the filename rather than from a
 *              declared variant. Nothing verified it is what the user believes it is, so if the
 *              converted game later misbehaves this is the line that explains why.
 *   `error`    Work that did not happen.
 *
 * The `info`/`warning` split is the one that carries judgement: both succeeded, and only one
 * casts doubt on its own output. Levels that merely restate "it worked" would not be worth
 * having.
 *
 * ONLY `error` NOTIFIES — see `notifications`. That is not a property of the ranking and must
 * not be re-derived from it: "warning and above" is a filter question, "does the bell ring" is
 * not.
 *
 * `debug` IS NOW WIRED, and the objection that held it back was only half answered by the pane.
 * Its feed is `debug.ts`'s `dbg()`, which carries developer-facing lines and POSTs them to
 * `/api/debug` — a DEV-ONLY endpoint, so in the deployed app those lines went nowhere at all.
 * That is the gap: the verbose capture a pasted bug report wants existed and was discarded in
 * exactly the build where a user might need it.
 *
 * The earlier note said connecting it before the pane existed would "push per-chunk device
 * chatter through `MAX_ENTRIES` and evict the levels that matter". The pane now exists, but the
 * pane only fixes VISIBILITY; eviction is a BUDGET property and hiding an entry does not stop it
 * consuming a slot. `dbg()` really is per-file (`RomManagementTab`'s SD sync calls it once per
 * game, cover, cheat and core), so a single sync of a full library would have flushed every
 * error out of a shared 500-entry ring. So the budgets are SEPARATE — see `MAX_DEBUG_ENTRIES`.
 * That, not the pane alone, is what makes the wiring safe.
 *
 * `notifications` excludes debug by construction, so none of this can make the bell ring.
 */
export type AuditSeverity = "debug" | "info" | "warning" | "error";

/**
 * Rank, so "warning and above" is one comparison rather than a set membership test repeated at
 * each call site. Gaps of ten for the same reason the z-index scale in `styles/tokens.css`
 * leaves them: a level can be inserted without renumbering the others.
 */
export const SEVERITY_RANK: Readonly<Record<AuditSeverity, number>> = Object.freeze({
  debug: 10,
  info: 20,
  warning: 30,
  error: 40,
});

/** True when `severity` is at least as severe as `min`. The filter's primitive. */
export function atLeast(severity: AuditSeverity, min: AuditSeverity): boolean {
  return SEVERITY_RANK[severity] >= SEVERITY_RANK[min];
}

/** Which part of the app spoke. Only `converter` is wired today — see the `installProgress`
 *  seam noted on `add()`. */
export type AuditSource = "converter" | "device" | "sources";

/**
 * ONE PAGE LOAD, named so a record spanning several of them can be read as several sittings.
 *
 * The log survives a reload (`auditLogPersist.ts`), so after a few refreshes the pane held one
 * undifferentiated run of lines with no way to tell where one sitting ended and the next began.
 * The owner asked for the boundary drawn and for the loads themselves listed. A session is one
 * page load, and nothing else: the id is stamped on an entry when it is WRITTEN, so the grouping
 * survives the reload that ends the session rather than being guessed afterwards from gaps
 * between timestamps.
 *
 * `startedAt` IS NOT THE FIRST ENTRY'S TIME. A load that sat idle for a minute before it logged
 * anything started when the page loaded, and eviction eats the OLDEST entries first, so a long
 * session's first surviving line drifts later and later. Recording the load time separately is
 * what keeps the listed start honest while entries bleed away underneath it. The END needs no
 * such record: eviction never touches a session's tail, so the last entry still held really is
 * the last thing that session did.
 *
 * NOT PERSISTED SEPARATELY. The starts ride inside the one `gnw.activityLog.v1` record and are
 * pruned to the sessions still holding entries, so nothing here adds a storage name.
 */
export interface AuditSession {
  /** Position in the record, oldest first: 1 is the oldest load still holding an entry. Renumbered
   *  on every restore, so an id is a grouping token for one page load and never an identity that
   *  outlives it. */
  id: number;
  /** When the load started, in `util.timestamp()` form. ABSENT for a block of entries written
   *  before this field existed -- see `restoreEntries()`. Absent is drawn as absent. */
  startedAt?: string;
  /** The first and last entry STILL HELD for this session. `firstAt` stands in for `startedAt`
   *  when that is absent; `lastAt` is the session's end. */
  firstAt: string;
  lastAt: string;
  /** The load the user is in now. It has not ended, so nothing may draw an end for it. */
  live: boolean;
}

export interface AuditEntry {
  /** Monotonic, so `{#each}` has a stable key even when two entries share a millisecond and
   *  identical text (two rows of one core failing the same way). */
  id: number;
  /** WHICH PAGE LOAD WROTE THIS. Stamped here, at write time, because it has to survive the
   *  reload that ends the session. See `AuditSession`. */
  session: number;
  /** Captured when logged, in the same `util.timestamp()` format the install log uses. */
  time: string;
  severity: AuditSeverity;
  source: AuditSource;
  /** What it is about, as the user would name it: a game's filename, a title's label. Runtime
   *  text, so it is never translated. Absent when an entry is about nothing in particular. */
  subject?: string;
  message: LogEntry;
  /** False until the user has opened the log since it arrived. Drives the header indicator. */
  seen: boolean;
  /** True for an entry read back from before a page reload.
   *
   *  STRUCTURE, NOT WORDING: the pane heads the restored block with a rule rather than marking
   *  each line, so nothing about a row's text changes with its age (`docs/UI_VOICE.md` 3). A
   *  restored entry is also always `seen` -- see `restoreEntries()`. */
  restored: boolean;
}

/**
 * Bounded so a long session cannot grow it without limit — preparing a shelf of ROMs one row at
 * a time emits a handful of entries per game, and nothing else trims it. 500 is far more than a
 * session produces in practice while staying small enough to render and to copy in one go; the
 * OLDEST are dropped, because the reason someone opens this is almost always the thing that
 * just happened.
 *
 * This caps the levels a person reads — info, warning, error. Debug is NOT counted against it.
 */
export const MAX_ENTRIES = 500;

/**
 * Debug's OWN budget, held apart from `MAX_ENTRIES` so verbose capture cannot evict evidence.
 *
 * `dbg()` is called once per file in the SD-sync loops, so one sync of a real library emits
 * thousands of lines. Against a single shared ring that flood would silently drop every error
 * recorded before it — the log would be emptiest at exactly the moment someone went looking for
 * why a sync misbehaved. Two budgets make a debug flood cost only older debug lines.
 *
 * Smaller than `MAX_ENTRIES` on purpose: these lines are the tail of a bug report, not the
 * record, and the newest are the ones next to whatever just failed.
 */
export const MAX_DEBUG_ENTRIES = 200;

/**
 * How long a burst of entries is allowed to coalesce before it is written.
 *
 * See `scheduleSave()`. Short enough that a failure's neighbouring lines survive a refresh taken
 * moments later, long enough that an SD sync writes a handful of times rather than once per file.
 */
export const SAVE_DEBOUNCE_MS = 1000;

/**
 * The severity segment's selection. `"all"` is every level EXCEPT `debug`, which the dashed
 * chip beside the segment reveals separately — `Activity.dc.html` draws it that way and says
 * why: debug "is a capture mode, not a view of the same records". So the segment is a floor and
 * the chip is a door, and neither is the other's peer.
 */
export type SeverityFilter = "all" | "info" | "warning" | "error";

class AuditLog {
  entries = $state<AuditEntry[]>([]);
  /** Whether the log surface is on screen. Store-level for the same reason the entries are. */
  open = $state(false);

  /**
   * THE FILTER LIVES IN THE STORE, NOT IN THE PANE, for two reasons that are not tidiness.
   *
   * `copyText()` must render what the user is looking at, because the count line beside Copy
   * and Save states the filtered set and not the whole record (`Activity.dc.html`). If the
   * filter were component-local, copy would have to be handed a list by the template, and the
   * one rule worth pinning — "what you copy is what you see" — would live in markup no node
   * suite can call. Every suite here stubs runes as identity functions, so a `$derived` inside
   * a `.svelte` file is not observable; a getter on this singleton is.
   *
   * THE FILTER IS NOT PERSISTED, even though the ENTRIES now are (`auditLogPersist.ts`). A
   * reload starts at "all sources, every level above debug", which is what someone opening a log
   * wants; restoring a narrowing they set an hour ago would hide the lines they refreshed to go
   * and read, and the hiding would be invisible.
   */
  severityFilter = $state<SeverityFilter>("all");
  /** Empty means every source. Chips COMBINE, so this is a set and not a single selection. */
  sourceFilter = $state<AuditSource[]>([]);
  /** Free text, matched against the rendered line and the subject. */
  query = $state("");
  /** The dashed `Debug` chip. Off by default: this pane is the thing that hides debug, which is
   *  the precondition `auditLog`'s severity comment names for wiring `dbg()` to it later. */
  showDebug = $state(false);
  /**
   * WHICH SESSION THE LIST IS NARROWED TO. `null` is every session, which is the default and what
   * someone opening the log wants.
   *
   * A SELECTOR, NOT A LEGEND. The sessions list could have marked the entries and left them all on
   * screen, but the pane already draws the boundary between sittings as a rule in the list, so a
   * second, purely decorative statement of the same fact would earn nothing. Picking a session
   * narrows the list to it, and the count line beside Copy and Save keeps stating the truth
   * because it already reads `filtered`.
   *
   * It COMPOSES with the severity segment, the debug chip, the source chips and the search rather
   * than replacing any of them: it is one more predicate in `filtered`, applied alongside them.
   *
   * THE DEFAULT IS THE LIVE SITTING, not the whole record, and that is the owner's report:
   * "Just opening up the activity after letting it load has the whole thing loaded still."
   * Someone opening the Activity log means "what is happening now"; the earlier sittings are there
   * to be reached deliberately, one click away in the list above the entries. `null` is still
   * reachable and still means every session at once -- clicking the selected row turns it off, the
   * same gesture as before -- and it is what the boundary rules between sittings are drawn for.
   *
   * Set in `restoreEntries()`, because the live id is not known until the restore has renumbered.
   *
   * Not persisted, the same rule as every other filter: a reload opens on the sitting it just
   * started, whatever was selected an hour ago.
   */
  sessionFilter = $state<number | null>(null);

  private nextId = 1;

  /**
   * THIS PAGE LOAD'S SESSION ID. 1 until `restoreEntries()` finds older sessions to sit after.
   *
   * `$state` because the pane reads it to know which row has no end; a plain field would leave
   * that row stale in a build where the restore ran after the first render.
   */
  currentSession = $state(1);

  /**
   * Load times by session id. Separate from the entries because eviction eats a session's oldest
   * lines and must not be allowed to move its start.
   *
   * NOT PRUNED HERE. A start for a session with no entries left is unreachable -- `sessions`
   * walks the entries, and `restoreEntries()` adopts a start only for an id the entries name --
   * so the only place it could cost anything is the stored record, and `serialize()` prunes it
   * there. Pruning in both would be code no check could hold.
   */
  private sessionStart = new Map<number, string>();

  /**
   * Append one entry.
   *
   * THE SEAM FOR `installProgress`: that store keeps its own `LogLine[]` for the duration of a
   * single device operation, tagged by phase, and its modal owns the copy/save affordances. It
   * is deliberately NOT merged here — a per-operation transcript and a session-wide record
   * answer different questions, and folding one into the other would either flood this log with
   * per-chunk device chatter or strip the phase tags that make that one readable. When the two
   * do converge, the join is this method with `source: "device"`, called from
   * `installProgress`'s own `log()` for the lines worth keeping past the modal — nothing here
   * needs to change for that.
   */
  add(
    severity: AuditSeverity,
    source: AuditSource,
    message: LogEntry,
    subject: string | undefined = undefined,
  ): void {
    const entry: AuditEntry = {
      id: this.nextId++,
      session: this.currentSession,
      time: timestamp(),
      severity,
      source,
      subject,
      message,
      seen: false,
      restored: false,
    };
    this.entries = AuditLog.trim([...this.entries, entry]);
    this.scheduleSave();
  }

  /**
   * PERSIST, SO A REFRESH IS NOT A COST.
   *
   * Written on `add()` and on `clear()`, and NOT on `dismiss()`/`markSeen()`: those move only
   * `seen`, and a restored entry is forced seen anyway, so writing for them would be pure cost.
   *
   * COALESCED, because `dbg()` fires once per game, cover, cheat and core -- a library sync
   * would otherwise serialize the whole log thousands of times. One second is short enough that
   * the lines next to a failure are already on disk by the time anyone reaches for the tab, and
   * long enough that a sync writes a handful of times rather than per file.
   *
   * FLUSHED ON `pagehide`, which is the reload itself. The debounce is what covers the case that
   * handler cannot: a tab killed outright, or a main thread too busy to run it.
   */
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  private scheduleSave(): void {
    if (this.saveTimer !== null) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      saveLog(this.entries, this.sessionStart);
    }, SAVE_DEBOUNCE_MS);
  }

  /** Write now, dropping any pending coalesced write. */
  flush(): void {
    if (this.saveTimer !== null) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    saveLog(this.entries, this.sessionStart);
  }

  /**
   * Adopt what the previous load wrote, ahead of anything this one logs.
   *
   * TWO RULES ARE APPLIED HERE AND BOTH ARE LOAD-BEARING.
   *
   * `seen: true`, ALWAYS. `notifications` is unseen-and-error, so restoring an unseen error
   * would ring the bell on every page load for something that already happened -- exactly the
   * "bell the user learns to ignore" this store's own comment argues against. A reload is not a
   * new event.
   *
   * `trim()`, AGAIN. The two budgets are enforced on the way back in as well as on the way out,
   * so a record written by a build with larger budgets cannot arrive over this one's, and debug
   * still cannot evict the levels a person reads.
   */
  restoreEntries(): void {
    const { entries: restored, starts } = restoreLog();
    // The live session's own start is recorded whether or not anything was restored: a first load
    // is session 1 and still has a real load time to list.
    const openedAt = timestamp();
    if (restored.length === 0) {
      this.sessionStart.set(this.currentSession, openedAt);
      this.sessionFilter = this.currentSession;
      return;
    }

    // RENUMBER, rather than adopting the stored ids. A stored id is a grouping token from a
    // record that has been trimmed since it was written, so its numbers are full of holes and its
    // highest is not a bound on anything. Mapping distinct ids to 1..n IN ORDER OF FIRST
    // APPEARANCE gives the sessions still holding entries a dense, oldest-first numbering, and
    // drops the ones eviction has emptied without a separate pruning step.
    //
    // AN ENTRY WITH NO STORED ID IS NOT THIS SESSION. It was written by a build from before the
    // stamp existed, and folding it into the live load would claim this page load did work it
    // never did. Every such entry shares one id of its own (`UNSTAMPED`), so it reads as one
    // earlier block sitting before the sessions that do have a start recorded. It has no
    // `startedAt`, and the pane draws that absence as absence rather than inventing a time.
    const renumbered = new Map<number, number>();
    for (const e of restored) {
      if (!renumbered.has(e.session)) renumbered.set(e.session, renumbered.size + 1);
    }
    for (const [was, now] of renumbered) {
      const at = starts.get(was);
      if (at !== undefined) this.sessionStart.set(now, at);
    }
    this.currentSession = renumbered.size + 1;
    this.sessionStart.set(this.currentSession, openedAt);
    // The pane opens on the sitting this load just started. See `sessionFilter`.
    this.sessionFilter = this.currentSession;

    const adopted: AuditEntry[] = restored.map((e) => ({
      id: this.nextId++,
      session: renumbered.get(e.session) ?? 1,
      time: e.time,
      severity: e.severity as AuditSeverity,
      source: e.source as AuditSource,
      ...(e.subject === undefined ? {} : { subject: e.subject }),
      message: e.message,
      seen: true,
      restored: true,
    }));
    this.entries = AuditLog.trim([...adopted, ...this.entries]);
  }

  /**
   * THE SESSIONS IN THE RECORD, NEWEST FIRST, with the live one always present.
   *
   * NEWEST FIRST because the owner asked for it: "The activity sessions list should be ordered
   * top-bottom newest-oldest." Only the DRAWN ORDER reverses. The ids stay 1..n oldest-first, so a
   * `session` stamped on an entry keeps meaning the same sitting; renumbering to suit a display
   * would make the stamp depend on how it happens to be shown. Note the ENTRY list inside the pane
   * is still oldest-first, which is the ordinary reading order of a log and what the `Reloaded`
   * rules read downward against. Index newest-first, record oldest-first: those answer different
   * questions and the difference is deliberate.
   *
   * A PAST SITTING IS DERIVED FROM THE ENTRIES, which is what makes an empty one impossible rather
   * than merely unlikely: it appears because an entry of its is present, so the row and the lines
   * it stands for can never disagree. Eviction removing its last entry removes its row in the same
   * pass, with nothing to prune.
   *
   * THE LIVE SITTING IS ALWAYS DRAWN, even before it has logged a line, and that is not a hole in
   * the rule above -- it is the rule's reason applied honestly. A past row with no entries would
   * claim a range for lines the log no longer holds. The live row claims nothing of the sort: the
   * page IS loaded, it started at a real time, and it has no end. Drawing it states a fact.
   *
   * It is also what makes the default selection work without a jump. `sessionFilter` starts on the
   * live sitting, and at load nothing has been logged into it yet: if the row only appeared with
   * its first line, the pane would open on a selection with no row, then silently snap when the
   * device scan wrote its first entry. With the row present from the first paint, the first line
   * simply lands in a sitting that is already there and already chosen. Nothing moves.
   *
   * `startedAt` comes from the separate record and `lastAt` from the entries, for the reason
   * `AuditSession` gives: eviction moves a session's head and never its tail.
   */
  get sessions(): AuditSession[] {
    const out: AuditSession[] = [];
    const at = new Map<number, AuditSession>();
    // THE DEBUG GATE APPLIES HERE TOO, so a row always stands for something the list can show. A
    // load that logged nothing but `dbg()` lines -- which is what a library scan looks like --
    // otherwise drew a selectable row that rendered "Nothing to report yet." when picked, because
    // the list hides debug and the row did not. The row and the lines it stands for now answer the
    // same question. The severity segment and the search are NOT applied: those narrow WITHIN a
    // sitting, and a session appearing and vanishing as the user typed would be unreadable.
    for (const e of this.entries) {
      if (e.severity === "debug" && !this.showDebug) continue;
      const found = at.get(e.session);
      if (found) {
        found.lastAt = e.time;
        continue;
      }
      const started = this.sessionStart.get(e.session);
      const row: AuditSession = {
        id: e.session,
        ...(started === undefined ? {} : { startedAt: started }),
        firstAt: e.time,
        lastAt: e.time,
        live: e.session === this.currentSession,
      };
      at.set(e.session, row);
      out.push(row);
    }
    if (!at.has(this.currentSession)) {
      const started = this.sessionStart.get(this.currentSession);
      const at0 = started ?? "";
      out.push({
        id: this.currentSession,
        ...(started === undefined ? {} : { startedAt: started }),
        // It holds no entry yet, so its range is its start and nothing else. The row draws no end
        // for a live sitting anyway, so `lastAt` is never read for this one.
        firstAt: at0,
        lastAt: at0,
        live: true,
      });
    }
    // Newest first for the DRAWN list only; `out` was built oldest-first from the entries and the
    // ids keep that order.
    return out.reverse();
  }

  /**
   * THE SELECTION, RESOLVED AGAINST THE ROWS THAT ACTUALLY EXIST.
   *
   * `sessionFilter` can outlive the sitting it names: a debug flood evicts the last entry of an
   * older sitting while its row is selected, and a raw comparison would then narrow to a session
   * with no row, hiding the log with the reason off screen.
   *
   * IT FALLS BACK TO THE LIVE SITTING, WHICH IS THE DEFAULT, and deliberately not to `null`.
   * Falling back to "every session" would put the pane back into exactly the state the owner
   * reported -- showing more than the row that looks chosen -- by a second door, and it would do
   * it silently, at the moment a flood happened to evict something. The live row always exists, so
   * this fallback always lands somewhere real.
   *
   * `null` still means every session, and only a deliberate toggle produces it.
   *
   * Everything that narrows or highlights reads this, never `sessionFilter` directly.
   */
  get activeSession(): number | null {
    if (this.sessionFilter === null) return null;
    const wanted = this.sessionFilter;
    return this.sessions.some((s) => s.id === wanted) ? wanted : this.currentSession;
  }

  /** Pick a session, or unpick the one already picked. Toggling is the whole control: there is no
   *  separate "all" row to keep in step with it. */
  selectSession(id: number): void {
    this.sessionFilter = this.sessionFilter === id ? null : id;
  }

  /**
   * THE RECORD THE OTHER FILTERS ARE NARROWING WITHIN, which is what the count line's total means.
   *
   * Picking a session does not hide part of one record; it CHOOSES a record. The severity segment,
   * the source chips and the search then narrow inside that. So the denominator beside Copy and
   * Save is the chosen session's own size, and `Showing 4 of 9` states the truth about the sitting
   * on screen.
   *
   * IT USED TO BE `entries.length`, THE WHOLE RECORD, and that was the defect the owner reported:
   * "The Activity log is still showing more than the currently selected session." The list itself
   * was right and had been from the start -- what was wrong was the pane SAYING, in words, beside
   * the buttons that act on it, that it held 312 lines while a single sitting was selected. Every
   * check written for the session filter read `filtered` and passed, because none of them read the
   * line that was making the false claim.
   *
   * `debug` is excluded unless its chip is on, for the same reason `filtered` excludes it: the
   * total must count the record the user has asked to see, or a capture mode nobody enabled would
   * inflate it.
   */
  get inScope(): AuditEntry[] {
    const session = this.activeSession;
    return this.entries.filter((e) => {
      if (session !== null && e.session !== session) return false;
      return e.severity !== "debug" || this.showDebug;
    });
  }

  /**
   * Enforce the two budgets, dropping the OLDEST of whichever class is over its own.
   *
   * Debug and everything-else are counted separately, so a `dbg()` flood costs only older debug
   * lines and an error recorded an hour ago is still there afterwards. A single shared ring
   * could not express that: the newest 500 entries of a library sync are all debug.
   *
   * Iterating oldest-first and skipping while a class is over budget drops exactly the front of
   * that class, which is the same "newest survive a flood" rule as before, now applied twice.
   */
  private static trim(next: AuditEntry[]): AuditEntry[] {
    let overDebug = -MAX_DEBUG_ENTRIES;
    let overKept = -MAX_ENTRIES;
    for (const e of next) {
      if (e.severity === "debug") overDebug++;
      else overKept++;
    }
    if (overDebug <= 0 && overKept <= 0) return next;
    const out: AuditEntry[] = [];
    for (const e of next) {
      if (e.severity === "debug") {
        if (overDebug > 0) {
          overDebug--;
          continue;
        }
      } else if (overKept > 0) {
        overKept--;
        continue;
      }
      out.push(e);
    }
    return out;
  }

  /** Entries the user has not seen since they arrived. */
  get unseen(): AuditEntry[] {
    return this.entries.filter((e) => !e.seen);
  }

  /**
   * WHAT THE BELL SHOWS, AND THEREFORE WHAT IT COUNTS. ERRORS ONLY.
   *
   * `debug`, `info` and `warning` all describe runs that WORKED — the DOOM converter cropping
   * widescreen lumps is the standing `info`, and a file used under `strict: false` the standing
   * `warning`. Those belong in Activity, and none of them may raise a notification: a bell that
   * rings for every successful conversion is a bell the user learns to ignore, which is the same
   * lesson the `Error:`-prefixed warning already taught. Note this is deliberately NOT
   * `atLeast(e.severity, "warning")` — a warning is worth reading, not worth interrupting for,
   * and the day a fifth level appears the bell must not silently start ringing for it.
   *
   * The list and the count are ONE rule on purpose. They were two before — the count filtered
   * to errors while the surface listed every entry, so the badge stayed dark while the panel
   * showed a crop warning. Anything drawing the bell reads this; nothing re-derives it.
   */
  get notifications(): AuditEntry[] {
    return this.entries.filter((e) => !e.seen && e.severity === "error");
  }

  /** The badge. Counts exactly what `notifications` lists, because it IS that list. */
  get unattended(): number {
    return this.notifications.length;
  }

  /**
   * WHAT THE ACTIVITY PANE SHOWS. The filter, applied.
   *
   * `debug` is excluded unless its own chip is on, whatever the segment says — "all" means
   * every level the user has asked to see, and they have not asked for debug. That is what
   * makes "hidden by default" true rather than aspirational, and it is the reason the pane had
   * to exist before `dbg()` could ever be routed here.
   */
  get filtered(): AuditEntry[] {
    const q = this.query.trim().toLowerCase();
    const session = this.activeSession;
    return this.entries.filter((e) => {
      if (session !== null && e.session !== session) return false;
      if (e.severity === "debug") {
        if (!this.showDebug) return false;
      } else if (this.severityFilter !== "all" && !atLeast(e.severity, this.severityFilter)) {
        return false;
      }
      if (this.sourceFilter.length > 0 && !this.sourceFilter.includes(e.source)) return false;
      if (q === "") return true;
      // One matcher, not two: `line()` already embeds the subject in brackets, so a separate
      // subject test would be dead code that no check could ever distinguish.
      return this.line(e).toLowerCase().includes(q);
    });
  }

  /** Turn one source chip on or off. Chips combine, so this toggles membership. */
  toggleSource(source: AuditSource): void {
    this.sourceFilter = this.sourceFilter.includes(source)
      ? this.sourceFilter.filter((s) => s !== source)
      : [...this.sourceFilter, source];
  }

  /**
   * DISMISS ONE, from the bell's panel.
   *
   * Marks the entry seen. It leaves `notifications` — which is what the panel lists and the
   * badge counts, one rule — and it stays in `entries`, so Activity keeps the whole record.
   * Dismissing takes something off the bell; it never destroys evidence. `clear()` is the
   * different, destructive thing and is not reachable from the panel.
   */
  dismiss(id: number): void {
    const hit = this.entries.find((e) => e.id === id);
    if (!hit || hit.seen) return;
    this.entries = this.entries.map((e) => (e.id === id ? { ...e, seen: true } : e));
  }

  /** Opening the log IS acknowledging it. */
  show(): void {
    this.open = true;
    this.markSeen();
  }

  hide(): void {
    this.open = false;
  }

  markSeen(): void {
    if (this.entries.every((e) => e.seen)) return;
    this.entries = this.entries.map((e) => (e.seen ? e : { ...e, seen: true }));
  }

  clear(): void {
    this.entries = [];
    // The sessions ARE the entries, so clearing the record clears them, and the selection with it.
    // `sessionStart` is left alone: the page is still loaded, the next line written belongs to the
    // live session, and `serialize()` writes a start only for a session that still has entries.
    this.sessionFilter = null;
    // Immediate, not coalesced: clearing is the one operation whose whole point is that the
    // record is gone, and a pending write holding the old entries would undo it.
    this.flush();
  }

  /** One rendered line, in whichever language the table is. */
  line(e: AuditEntry, t: Strings = locale.t): string {
    const body = renderEntry(e.message, t);
    return e.subject ? `${e.time} [${e.subject}] ${body}` : `${e.time} ${body}`;
  }

  /**
   * The log as text, **in English whatever the UI language** — the same rule
   * `installProgress.copyLog()` follows, so a pasted bug report reads identically for everyone.
   *
   * THE FILTERED SET, not the whole record. `Activity.dc.html` puts Copy and Save on the line
   * that reads "Showing 8 of 34" precisely so they sit beside the statement of what they act
   * on; copying 34 lines from a screen showing 8 would make that line a lie. With no filter set
   * this is every entry, which is the common case.
   */
  copyText(): string {
    return this.filtered.map((e) => this.line(e, en)).join("\n");
  }
}

export const auditLog = new AuditLog();

/**
 * ROUTE `dbg()` INTO THE DEBUG TIER.
 *
 * Registered here, at the store, rather than from `App.svelte`: this is a policy about what the
 * log contains, and putting it in a component would mean a build that never mounts that
 * component (a node suite) silently exercises a different store than the browser does.
 *
 * `source: "device"` for all of them, and that is a real limitation rather than a shrug. Every
 * `dbg()` call site today is device work — `[ensureStub]`, `[scan]`, `[scanSdCardGames]`,
 * `[install]`, `[sd-sync]`, and `romScan`'s one `[sd]` line about the card folder — so the tag
 * is true of the whole population. It is not derived from the line, because a fourth
 * `AuditSource` would need a fourth chip in `ActivityPane`, and a chip nobody drew is worse than
 * a source that is currently accurate. The scope tag stays at the head of the text, and the
 * pane's search matches the rendered line, so `[sd-sync]` still finds them.
 *
 * `literal()`, because these are runtime strings that never came from the string table — they
 * round-trip unchanged into an English bug report, which is the entire point of capturing them.
 */
setDbgSink((line) => auditLog.add("debug", "device", literal(line)));

/**
 * ADOPT THE PREVIOUS LOAD'S RECORD, AND MAKE SURE THIS ONE'S SURVIVES.
 *
 * At the store rather than in `App.svelte`, the same argument `setDbgSink` above makes: this is a
 * policy about what the log contains, and a build that never mounts a component -- every node
 * suite -- must not silently exercise a different store than the browser does.
 *
 * The restore runs BEFORE anything this load logs, so the restored block is the oldest and the
 * pane's rule sits at a real boundary rather than in the middle of a session.
 */
auditLog.restoreEntries();

if (typeof window !== "undefined") {
  // `pagehide` and not `beforeunload`: the latter is unreliable when a page is discarded and, on
  // some browsers, invites a confirmation dialog. Neither is a substitute for the debounce -- a
  // wedged main thread runs neither handler, which is precisely the case this exists for.
  window.addEventListener("pagehide", () => auditLog.flush());
}
