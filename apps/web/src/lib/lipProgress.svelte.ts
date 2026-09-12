/**
 * The face-plate lip's fill: how far along the device link is, right now.
 *
 * The owner's ask: "I would like the top golden lip to act as a progress bar for any and ALL
 * SWD read/writes... Obviously that doesn't count for the heartbeat."
 *
 * ## Where the numbers come from
 *
 * `@gnw/swd-transport` reports every BULK transfer to one observer (`setTransferObserver`).
 * That is the only layer that sees all of them: per-flow reporting covers the flows that opted
 * in, and the owner asked for the ones that did not. The transport already computes
 * `(done, total)` for its own `onProgress`, so observing costs no device traffic.
 *
 * ## The heartbeat is excluded structurally, not by a name check
 *
 * The liveness poll pings with `readWord` only (`engine/flasher.ts`'s `pingTarget` and
 * `isStubAlive`). The observer fires for `readMemory`/`writeMemory` alone. So the poll cannot
 * move the bar, and nothing has to recognise it to keep it out. A filter keyed on some "is this
 * the poll?" flag would rot the moment the poll grew a second call site.
 *
 * ## The fill is per TRANSFER, and that is a real limit worth stating
 *
 * Each bulk transfer fills 0 to 100%. A flow made of several transfers therefore sweeps once
 * per transfer rather than once overall -- a flash writes its payload in 256 KB context-buffer
 * loads, so the lip sweeps once per load.
 *
 * The alternative, summing every transfer in a burst, was rejected: `total` would grow as new
 * transfers were queued, so the bar would run backwards (80% and then 40% when the next region
 * arrived), and it would be claiming to know about work nobody had asked for yet. A bar that
 * goes backwards is worse than one that repeats, and this module refuses to state a total it
 * cannot know.
 *
 * VISIBILITY, however, spans the burst: the lip stays lit between adjacent transfers and clears
 * only once the link has been quiet for `IDLE_MS`, so a flash does not strobe the chrome off
 * and on between loads.
 */
import { setTransferObserver, type TransferEvent } from "@gnw/swd-transport";

/** How long the link must be quiet before the lip goes back to plain gold. Long enough to
 *  bridge the transport's own 10 ms inter-chunk pacing and the gaps between queued transfers,
 *  short enough that the lip is not still lit well after the device is done. */
export const IDLE_MS = 500;

class LipProgressStore {
  /** 0..1 within the CURRENT transfer, or null when the link is idle. Null is the difference
   *  between "not transferring" and "transferring, 0% done" -- the second must paint. */
  fraction = $state<number | null>(null);

  /** Non-reactive: only ever read inside the observer, and making it reactive would put a
   *  write-then-read in the same synchronous turn as the state it guards. */
  private idleTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * An OPERATION owns the lip while one is running, and per-transfer sweeps are ignored.
   *
   * The per-transfer fill is right for one long transfer and wrong for an operation built from
   * hundreds of small ones. A device scan issues ~1400 reads, so the lip swept ~1400 times for
   * a single 6.5 s scan, and the owner read that as the app scanning over and over. The count
   * is the giveaway: the reads are the sweeps.
   *
   * So an operation that knows its own progress declares it, and the lip draws THAT: one sweep
   * for one thing the user asked for. Everything else keeps the per-transfer behaviour, which
   * is still the honest picture for a flash region or a dump.
   */
  private operation: string | null = null;

  /**
   * Reads nobody asked for do not light the lip at all.
   *
   * Distinct from an operation, which OWNS the lip and draws its progress. This is for work the
   * user did not request and cannot act on -- the background FS-stat and core-version reads that
   * follow every scan, which walk the LittleFS tree and read each core, hundreds of block reads
   * for numbers that appear quietly in a panel. Drawing those is not informative, it is strobing.
   *
   * Counted rather than boolean: the background block starts several readers, and the first one
   * to finish must not un-quiet the lip while the others are still going.
   */
  private quiet = 0;

  get active(): boolean {
    return this.fraction !== null;
  }

  /** Percent for the paint. Rounded once here so the template and any test agree. */
  get percent(): number {
    return this.fraction === null ? 0 : Math.round(this.fraction * 100);
  }

  /**
   * Take the lip for the duration of `name`, driving it from `fraction` (0..1).
   *
   * Re-entrant by name: a nested operation does not steal the lip from the outer one, because
   * an install that rescans at the end is still one thing from where the user is standing.
   * Pass `null` as the fraction to end it.
   */
  operationProgress(name: string, fraction: number | null): void {
    if (fraction === null) {
      if (this.operation !== name) return; // an inner operation ending; the outer one still owns it
      this.operation = null;
      if (this.idleTimer) clearTimeout(this.idleTimer);
      this.idleTimer = setTimeout(() => {
        this.idleTimer = null;
        this.fraction = null;
      }, IDLE_MS);
      return;
    }
    if (this.operation === null) this.operation = name;
    if (this.operation !== name) return;
    this.fraction = Math.min(1, Math.max(0, fraction));
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = null;
  }

  /** Silence the lip for work the user did not ask for. Always pair the true with a false. */
  setQuiet(on: boolean): void {
    this.quiet = Math.max(0, this.quiet + (on ? 1 : -1));
  }

  observe(ev: TransferEvent): void {
    // An operation is driving the lip; its own transfers must not fight it.
    if (this.operation !== null) return;
    if (this.quiet > 0) return;
    if (ev.total <= 0) return; // a zero-length transfer has no proportion to draw
    this.fraction = Math.min(1, Math.max(0, ev.done / ev.total));
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null;
      this.fraction = null;
    }, IDLE_MS);
  }

  /** The link is gone. Drop the fill immediately rather than leaving it lit for IDLE_MS on a
   *  device that is no longer there. */
  reset(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = null;
    this.operation = null;
    this.quiet = 0;
    this.fraction = null;
  }
}

export const lipProgress = new LipProgressStore();

// Wired once, at module load, rather than in the device store's connect path: the observer is
// process-wide and stateless about connections, so there is no lifecycle to get wrong.
setTransferObserver((ev) => lipProgress.observe(ev));
