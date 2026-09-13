// The global device-state object (UX §3.2). Written only by the connection
// layer; read everywhere. Drives the structural model accent.
import type { GnwFlasher, DeviceInfo } from "@gnw/gnw-flasher";
import type { LittlefsTreeNode } from "@gnw/fs-builders";
import { connectProbe, getKnownProbes, serialTransport, type ProbeHandle, type SerialTransport } from "./engine/transport.js";
import { bootStub, readInfo, dumpRegion, attachFlasher, isStubAlive, pingTarget } from "./engine/flasher.js";
import { scanExtflashPartitions, type ExtPartition } from "./engine/fsscan.js";
import { scanIntflashBanks, type IntflashBank } from "./engine/intflashscan.js";
import type { FirmwareAbi } from "./engine/firmwareAbi.js";
import { classifyDevice, type DeviceClass } from "./engine/classify.js";
import { captureScreenshot as _captureScreenshot } from "./engine/screenshot.js";
import { readInstalledFrogfs, type InstalledGame, type InstalledFrogfs } from "./engine/frogfsDevice.js";
import { classifySdScanKey, homebrewScanPrefixes, shadowedLegacyHomebrewKeys } from "./engine/devicePaths.js";
import { dbg, dbgLog } from "./debug.js";
import { fallbackLogLayout, loadDeviceLogLayout, readLogFromTransport, retroGoActivityFromLog } from "./engine/devicelog.js";
import { detectRuntime, type RuntimeKind } from "./engine/runtime.js";
import { raceWithFallback } from "./engine/timeout.js";
import { isDeadHandleError } from "@gnw/swd-transport";
import { loadSel, saveSel, saveDir, loadDir, deleteDir } from "./persist.js";

/**
 * The SD card's key in the `gnw-handles` store, beside `romDir` and `ofwBackupDir`.
 *
 * A key INSIDE that store, not a new store: `persist.ts` already scopes the database name
 * through `scoped()` and `test/storagescope.mjs` inventories it there, exactly as the other
 * two handle keys ride it without an inventory entry of their own.
 */
const SD_DIR_KEY = "sdDir";
import { installProgress, deviceSafety } from "./installProgress.svelte.js";
import { lipProgress } from "./lipProgress.svelte.js";
import type { CoreVersionCheck } from "./engine/coreVersion.js";
import { ensureUnlocked as runUnlockGate, type UnlockOutcome } from "./engine/unlockGate.js";
import { auditLog } from "./auditLog.svelte.js";
import { msg } from "./logEntry.js";

export type Connection = "disconnected" | "connecting" | "connected" | "attention" | "lost";
export type Model = "mario" | "zelda" | "unknown";
export type Firmware = "stock-ofw" | "retro-go" | "unknown";

/** Thrown by `ensureStub()` when the user dismissed `StubLoadModal` themselves. Distinct from
 *  every other failure so a caller can stay silent about a deliberate cancel while still
 *  surfacing real errors (see ui/DeviceControls.svelte's Recovery Mode item). */
export class StubLoadCancelled extends Error {}

/**
 * THE USER CLOSED THE BROWSER'S DEVICE CHOOSER. `navigator.usb.requestDevice()` rejects with a
 * `NotFoundError` DOMException both when no device matches AND when the person simply dismisses
 * the picker, and the two are indistinguishable from here. Treating it as a failure would ring
 * the bell every time someone opened Change Adapter and thought better of it, which is the way
 * an error channel gets trained out of the reader. The bell is errors only, so a cancel must
 * not reach it.
 */
function isPickerDismissal(e: unknown): boolean {
  return e instanceof DOMException && e.name === "NotFoundError";
}

/** Thrown by `ensureUnlocked()` when the user declined the one prompt that survives — the
 *  device is locked and has no backup, so unlocking would destroy the original firmware for
 *  good. Distinct from a hardware failure so a caller can stay silent about a deliberate
 *  decline while still surfacing real errors, exactly like `StubLoadCancelled`. */
export class UnlockDeclined extends Error {}

class DeviceStore {
  connection = $state<Connection>("disconnected");
  model = $state<Model>("unknown");
  locked = $state<boolean | null>(null);
  extSizeMB = $state<number | null>(null);
  /** Whether an SD card is present. null = not yet probed. TODO: the scan should set this by
   *  porting gnwmanager's SD-card detection (the RAM util probes the SD over SDMMC). The
   *  installer defaults to flash when this isn't true. */
  sdPresent = $state<boolean | null>(null);
  probeName = $state<string | null>(null);
  runtimeKind = $state<RuntimeKind>("unknown");
  runtimeBank = $state<1 | 2 | null>(null);
  retroGoActivity = $state<string | null>(null);
  error = $state<string | null>(null);
  /** True once we've connected at least once this session (never reset) — so a later
   *  disconnect keeps the user on the working view instead of the homepage. */
  everConnected = $state(false);

  // Workflow Config
  private _targetMedia = $state<"flash" | "sd">(loadSel<"flash" | "sd">("target-media", "flash"));
  get targetMedia() { return this._targetMedia; }
  set targetMedia(val: "flash" | "sd") {
    this._targetMedia = val;
    saveSel("target-media", val);
  }
  
  /**
   * THE PICKED SD CARD, AND THE ONE PLACE THAT REMEMBERS IT.
   *
   * `FileSystemDirectoryHandle` (typed `any` to avoid ts complaints if not in lib).
   *
   * WHY THIS IS A SETTER AND NOT A BARE FIELD. It was a bare `$state(null)`, and nothing
   * anywhere persisted it: `saveDir` had four callers (`romDir`, `ofwBackupDir`, the backup
   * folder, and `localFolders`' per-row keys) and none of them was the card. So a picked card
   * lived exactly as long as the tab, while `targetMedia` (above) and the stated capacity
   * (`sdCapacity.ts`) both persisted -- leaving a reload in SD mode with no card, which is
   * what made the folder gate ask again and the Sources SD page show nothing.
   *
   * Persisting on ASSIGNMENT rather than at the picker is deliberate. Both ways in already
   * converge on `pickSdCardFolder()` (the gate modal's SD row and the Sources pane both call
   * it), but a third caller that only assigns the field would silently do two thirds of the
   * job -- which is how the Sources pane itself arrived, setting the handle without setting
   * `targetMedia`. Writing through the setter is the registration; it cannot be bypassed.
   *
   * Only a native FSAA handle is stored. The `<input webkitdirectory>` shim is not
   * structured-cloneable (`library.svelte.ts` records the same rule for `romDir`), so
   * IndexedDB would reject it; the duck-type is `dirSupportsWriteBack`'s, inlined rather than
   * imported because `romScan.ts` reaches for `device` through a DYNAMIC import and a static
   * edge back would close that loop.
   */
  private _sdHandle = $state<any>(null);
  get sdHandle() { return this._sdHandle; }
  set sdHandle(val: any) {
    this._sdHandle = val;
    if (val && typeof val.getDirectoryHandle === "function") void saveDir(SD_DIR_KEY, val);
    else if (!val) void deleteDir(SD_DIR_KEY);
  }

  /**
   * Restoring it, EAGERLY and exactly once, started here at construction.
   *
   * Not lazy, and not from a getter. A lazy restore in this codebase has already produced the
   * bug twice: `localFolders` set its `loaded` flag before the awaits that load, and
   * `favorites` called its loader from a `$derived`, where assigning `$state` throws
   * `state_unsafe_mutation` -- so the store stayed empty for the life of the page and the next
   * write persisted that emptiness. A constructor is not a reactive context, which is what
   * makes this safe.
   *
   * IndexedDB is async, so the promise is the contract: `whenSdRestored()` is what a reader
   * awaits before concluding there is no card. `library.ensureFolders()` does exactly that --
   * without it the folder gate races the restore and asks for a card we already hold.
   *
   * A card picked while the read was in flight wins: the guard below never overwrites a
   * handle that arrived first.
   */
  private _sdRestored: Promise<void> = this._restoreSdHandle();
  private async _restoreSdHandle(): Promise<void> {
    try {
      const stored = await loadDir(SD_DIR_KEY);
      // Assign the FIELD, not the setter: this came from storage, and writing it back would
      // be a pointless round trip.
      if (stored && this._sdHandle === null) this._sdHandle = stored;
    } catch (e) {
      // Never fatal: a browser with IndexedDB blocked simply starts with no card. Through
      // `dbg()` so a deployed build can show it -- a console-only report is what
      // `errorsurface.mjs` now fails the build on.
      dbg(`[sd] restoring the remembered card failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  /** Resolves once the remembered card has been read back (or found absent). */
  whenSdRestored(): Promise<void> { return this._sdRestored; }

  /** Which sub-mode the Firmware Setup tab is showing: the Guided Setup wizard or the
   *  Advanced rail. Store-level singleton state (like `stubPrompt`/`connectGatePrompt`) rather
   *  than component-local `$state`, because it is *cross-view*: OverviewTab's "set up this
   *  device" prompt and App.svelte's post-scan auto-route both need to REQUEST Guided Setup,
   *  and neither is an ancestor of Advanced.svelte. Advanced.svelte mirrors it into the
   *  `#guided` / `#firmware` hash segments. */
  firmwareMode = $state<"wizard" | "advanced">("advanced");

  /** STM32 96-bit unique device ID, hex — read once per connection (see `_readDeviceUid`).
   *  This is the only per-UNIT identity we have: `model`/`extSizeMB`/`detectedStockFirmware`
   *  identify a device *class*, so two Marios would share them. null until read. */
  deviceUid = $state<string | null>(null);

  /** Reactive mirror of the persisted "the user has taken a backup of this unit's stock
   *  firmware" fact (localStorage, keyed by `deviceUid` — see `markBackupTaken`). */
  private _backupTaken = $state(false);
  /** When that backup was taken, epoch ms, or null when we don't know. The Overview Status
   *  pane prints a DATE in this row, never a verb, so the fact had to widen from a boolean.
   *  Older installs stored a bare `true` under the same key; those load as taken-with-no-date
   *  and the row says so rather than inventing one. */
  private _backupAt = $state<number | null>(null);
  /** True if a stock-firmware backup has been recorded for THIS unit (this session or an
   *  earlier one). False whenever the UID is unknown — never guess in the optimistic
   *  direction, since a wrong "already backed up" would hide the backup step. */
  get backupTaken(): boolean {
    return this._backupTaken;
  }
  /** Record that a stock-firmware backup of this unit now exists on the user's disk. Durable
   *  across reloads, and scoped to the unit by UID so a different Game & Watch does not
   *  inherit it. Plaintext on purpose: this is a boolean fact about the user's own device,
   *  not a secret — localCrypt.ts is for values that shouldn't sit around readable. */
  /** Epoch ms of this unit's stock-firmware backup, or null (never backed up, or backed up
   *  before this fact carried a date). */
  get backupAt(): number | null {
    return this._backupAt;
  }
  markBackupTaken(): void {
    this._backupTaken = true;
    this._backupAt = Date.now();
    if (this.deviceUid) saveSel(DeviceStore.backupKey(this.deviceUid), this._backupAt);
  }
  private static backupKey(uid: string): string {
    return `backup-taken:${uid}`;
  }


  // Non-reactive engine handles (held across operations while connected).
  private probe: ProbeHandle | null = null;
  /** Serialized transport (all calls FIFO-queued) so the liveness poll can share the link
   *  transparently without crashing the active caller. */
  public transport: SerialTransport | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private pinging = false;
  private lastRuntimeProbeAt = 0;
  private lastSettlingPollLogAt = 0;
  flasher: GnwFlasher | null = null;
  /** Reactive mirror of "the RAM util is loaded" — `flasher` itself is non-reactive, so the
   *  UI (LED/status) tracks this instead. Set when ensureStub boots it; cleared on disconnect. */
  utilLoaded = $state(false);
  info = $state<DeviceInfo | null>(null);
  /** When set, a confirmation modal is asking the user to load the RAM flash utility. */
  stubPrompt = $state<{ resolve: () => void; reject: (e: Error) => void } | null>(null);

  /** Set while `UnlockConfirmModal` is asking whether to unlock a device with no backup.
   *  Store-level singleton for the same reason `stubPrompt` is: it is rendered at the App
   *  root, so no unrelated `{#if}` elsewhere in the tree can unmount it mid-question. */
  unlockPrompt = $state<{ resolve: () => void; reject: (e: Error) => void } | null>(null);

  // Flash scan (docs/ARCHITECTURE.md "Device Scan & Classification") — populated on connect, non-blocking; re-run
  // after any big change.
  scanning = $state(false);
  scanProgress = $state(0); // 0..1
  scanError = $state<string | null>(null);
  partitions = $state<ExtPartition[]>([]);
  banks = $state<IntflashBank[]>([]);
  deviceClass = $state<DeviceClass | null>(null);
  /** Games currently installed in the device's FrogFS (read during runScan). */
  installedFrogfs = $state<InstalledFrogfs | null>(null);
  installedGames = $state<InstalledGame[]>([]);
  /** Full LittleFS tree (cached for snappy file browser/save mgmt). Null until read. */
  installedLfsTree = $state<LittlefsTreeNode | null>(null);
  /** Block cache for fast lazy LFS access */
  lfsBlockCache = new Map<number, Uint8Array>();
  /** Device SHA-256 per 256 KiB chunk, as it was when the cached blocks in that chunk were
   *  read. Lets a later mount PROVE a cached block is still what the device holds instead of
   *  discarding everything: see `engine/lfsWrite.ts`. Cleared with the block cache. */
  lfsChunkHashes = new Map<number, string>();
  /** Async computed FS statistics keyed by partition offset */
  fsStats = $state<Record<number, { usedBytes: number; freeBytes: number }>>({});
  /** Do installed cores agree with the installed retro-go version (and each other)?
   *  Populated in the background, after the scan's UI-critical results are already in — see
   *  `_doScan()`'s tail (Flash/LittleFS) and `scanSdCardGames()` (SD-card files). Null until
   *  the first check completes; best-effort, never blocks or fails a scan. */
  coreVersionCheck = $state<CoreVersionCheck | null>(null);
  /** Bumped on every disconnect/reconnect/rescan. Background FS-stat reads capture the
   *  generation they started in and drop their result if it's stale by the time they
   *  resolve (device gone, or a newer scan superseded them) — see [[swd-connection-model]]. */
  private _gen = 0;
  /** Reference count of ensureStub() stub boots that are CURRENTLY WRITING through
   *  `this.transport` — i.e. that still own the live USBDevice handle underneath it.
   *
   *  bootStub()'s target reset makes the probe re-enumerate, which fires the USB `disconnect`
   *  event → handleLost() → _teardownConnection() → probe.dispose() *while the boot is still
   *  mid-write*. bootStub captured the transport by value, so its next writeMemory() then hit
   *  a handle we had just closed ourselves: "InvalidStateError: The device must be opened
   *  first". _teardownConnection() therefore defers the dispose() (only the dispose — the
   *  handles are still nulled and the poll still stops) while this is non-zero. */
  private _stubBootDepth = 0;
  /** Set when a reconnect was suppressed because a stub boot owned the link (see connect()).
   *  Drained by _flushDeferredDispose() once the boot settles, so the link is re-established
   *  exactly once instead of by several racing callers. */
  private _reconnectAfterBoot = false;
  /** Probe handles whose dispose() a teardown deferred because a stub boot still owned them.
   *  Flushed when the last boot settles (see _flushDeferredDispose). */
  private _deferredDispose: ProbeHandle[] = [];
  /** Wall-clock time of the last successful intflash bank scan (Tier 1), 0 = never this
   *  connection. Used only to skip a redundant Tier-1 re-scan when a Tier-2 (deep) scan runs
   *  shortly after — e.g. ensureStub() boots the stub ~1 min after an intflash-only scan and
   *  nothing has written to flash in between (docs: "Scan-skip rule"). This is a time-window
   *  heuristic, not real write-tracking (no dirty-flag plumbing exists into the flash-write
   *  call sites in engine/flashInstall.ts, engine/ofw.ts, etc. — wiring that through would
   *  cross the engine/state layering boundary; left as a follow-up, see final report). */
  private _banksScannedAt = 0;
  /** Skip re-scanning intflash banks in _doScan() if the last scan is still this fresh. */
  private static readonly BANK_RESCAN_SKIP_WINDOW_MS = 90_000;
  /** Wall-clock time _doScan() last completed (attempted, even if it errored partway) — 0 =
   *  never this connection. Used ONLY to gate pollTick()'s passive "discovered the util
   *  already running" auto-scan trigger, so a device that already scanned recently doesn't
   *  get an unsolicited extra scan every time the poll happens to notice utilLoaded flip.
   *  Deliberate/directed runScan() calls elsewhere (post-install, an explicit Scan button,
   *  etc.) are NOT gated by this — they must always run regardless of freshness. */
  private _lastFullScanAt = 0;
  private static readonly AUTO_SCAN_FRESHNESS_WINDOW_MS = 60_000;
  /** True after an explicit device.disconnect() — auto-reconnect (handleLost's retry loop,
   *  connectSilent, the tab-navigation auto-probe) stays off until the user reconnects by
   *  hand. A lost link (USB yank / failed poll) does NOT set this — that path always retries. */
  private _suppressAutoRetry = false;

  /** Re-arms auto-reconnect without requiring a full manual `connect()` call. Landing's
   *  "Manage Device"/"Manage Games" buttons are a deliberate top-level re-entry point (the
   *  user explicitly chose to go manage the device again) — that's a strong enough signal to
   *  resume the normal silent-auto-probe behavior even if the device was explicitly
   *  disconnected earlier this session, unlike a passive background remount/tab-revisit,
   *  which must stay suppressed. Called from App.svelte's handleNavigate(). */
  allowAutoReconnect(): void {
    this._suppressAutoRetry = false;
    this._autoProbedRomsOnce = false;
  }

  /** The model that should tint the UI (null = unknown/neutral). */
  get accent(): Exclude<Model, "unknown"> | null {
    return this.model === "unknown" ? null : this.model;
  }

  /** Derived, NOT stored — `deviceClass` (Tier 1/2's bank-scan reduction) is the sole source
   *  of firmware classification. There is no independent "firmware" fact to race or forget to
   *  update: this is just deviceClass.kind reduced to the flat enum older UI code expects. */
  get firmware(): Firmware {
    const kind = this.deviceClass?.kind;
    if (!kind) return "unknown";
    if (kind.startsWith("retrogo")) return "retro-go";
    if (kind === "stock") return "stock-ofw";
    return "unknown";
  }

  get retroGoRunning(): boolean { return this.runtimeKind === "retro-go"; }
  private updateRetroGoActivity(text: string): void {
    this.retroGoActivity = retroGoActivityFromLog(text);
  }

  /** The firmware ABI table the connected device publishes, or null when we do not know:
   *  nothing connected, no scan yet, stock OFW, or a Retro-Go predating the table. Read
   *  during Tier 1 (the intflash bank scan) out of a buffer that scan already downloaded —
   *  no extra SWD traffic, and no Tier-2/stub dependency, so it is known as early as the
   *  firmware classification itself is.
   *
   *  Callers MUST treat null as "no claim". Unknown is not incompatible. */
  get firmwareAbi(): FirmwareAbi | null {
    if (!this.isConnected) return null;
    // Only one bank runs; the OFW/empty bank never carries a table, so "the bank that has
    // one" is unambiguous. Prefer the Retro-Go bank if both somehow answered.
    const banks = this.banks.filter((b) => b.abi);
    const rg = banks.find((b) => b.retroGoVersion);
    return (rg ?? banks[0])?.abi ?? null;
  }

  get isConnected(): boolean {
    return this.connection === "connected" || this.connection === "attention";
  }

  /** True while an in-flight device operation (currently: the flash-geometry scan) is
   *  running — the single device-level "don't let the user start another op" signal.
   *  Component-local busy flags (installing/building/flashing progress state) are NOT
   *  folded in here; they live in the component that owns the operation. */
  get busy(): boolean {
    return this.scanning;
  }

  /** Connected AND not busy — the common gate for "safe to kick off a new device op". */
  get readyToOperate(): boolean {
    return this.isConnected && !this.busy;
  }

  /** SD-mode target with a folder handle actually in hand (vs. just having picked "SD" as
   *  the target media, which the Firefox no-FSAA fallback path can still be true for). */
  get sdReady(): boolean {
    return this.targetMedia === "sd" && !!this.sdHandle;
  }

  /** Size of the device's external flash chip in bytes (0 if not yet scanned). */
  get extFlashBytes(): number {
    return this.info?.externalFlashSizeBytes ?? 0;
  }

  /** Does `bytes` of external-flash payload fit this device's chip? A hard guard for every
   *  external-flash write (OFW external, Retro-Go FrogFS/LittleFS, ROMs): a 4 MB image can't
   *  go on a 1 MB chip. Returns false until the chip size is known (scan first). */
  fitsExtFlash(bytes: number): boolean {
    const cap = this.extFlashBytes;
    return cap > 0 && bytes <= cap;
  }

  private _connectPromise: Promise<void> | null = null;

  /** Attach to a probe ONLY — the RAM util loads later, on demand (see ensureStub). */
  connect(log?: (m: string) => void, opts?: { forcePicker?: boolean }): Promise<void> {
    // Dedupe by the in-flight promise ALONE, not by `connection === "connecting"`. A lost link
    // starts reconnectLoop() while the USB `connect` event independently fires connectSilent();
    // connectSilent's "am I still lost?" guard is checked BEFORE its own await of
    // getKnownProbes(), so both could get past it and attach twice (two `DEVICE:` lines per
    // reconnect). `_connectPromise` is non-null for exactly the duration of one attempt.
    // forcePicker is excluded: "Change Adapter" must never be answered by an in-flight
    // pickerless attach.
    if (this._connectPromise && !opts?.forcePicker) return this._connectPromise;
    // A stub boot owns the USBDevice right now. bootStub()'s SWD target reset makes the probe
    // re-enumerate, which fires the USB `disconnect` event MID-BOOT — and the automatic
    // responses to that (handleLost's reconnectLoop, connectSilent, the USB `connect`
    // listener) would otherwise attach a SECOND WebStlink to the same physical device while
    // the first is still writing. Two handles, two independent serialTransport queues, one
    // USBDevice: the second one's halt/reset races the first's and WebUSB rejects it with
    // "An operation that changes the device state is in progress", after which whichever
    // handle is disposed first closes the device under the other ("The device must be opened
    // first"). Reported twice from the field as Recovery Mode flapping wildly between
    // connected and disconnected. `_stubBootDepth` already deferred the *dispose*; this is
    // the other half — nobody re-attaches until the boot that owns the link has finished.
    // An explicit forcePicker ("Change Adapter") is the user overriding deliberately.
    if (this._stubBootDepth > 0 && !opts?.forcePicker) {
      this._reconnectAfterBoot = true;
      return Promise.resolve();
    }
    // An explicit connect() call re-enables auto-retry (a manual disconnect suppresses it
    // until the user reconnects by hand — this is that reconnect).
    this._suppressAutoRetry = false;
    // A reconnect FROM "lost" reuses its last-known scan (general principle: never
    // speculatively blank a field — only a positive scan result changes one). Only a truly
    // fresh connect (from "disconnected") clears to "unknown / not scanned".
    const wasLost = this.connection === "lost";
    this.error = null;
    this.connection = "connecting";
    if (!wasLost) this.clearInfo();

    this._connectPromise = (async () => {
      try {
        // Attach (no halt/reset/stub boot — that's what hung past attempts). Then a SINGLE
        // safe mailbox RAM read to detect an already-running RAM util, raced against a short
        // timeout so a stalled read can never hang us. If the util's up, reuse it (no re-boot,
        // no modal) and scan; otherwise attach only and load it on demand via ensureStub().
        this.probe = await connectProbe(opts);
        this.probeName = this.probe.probeName;
        navigator.usb.addEventListener("disconnect", this.onUsbDisconnect);
        this.transport = serialTransport(this.probe.transport);
        const transport = this.transport;
        const utilUp = await Promise.race([
          isStubAlive(transport),
          new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 800)),
        ]);
        if (utilUp) {
          this.flasher = attachFlasher(transport);
          this.utilLoaded = true;
          // Tier 0 (RAM-safe): `locked` comes off the info struct. `extSizeMB` needs the stub
          // too (Tier 2), so it's fine to read both here — the stub is confirmed alive.
          this.info = await readInfo(this.flasher, log);
          this.locked = this.info.locked;
          this.extSizeMB = this.info.externalFlashSizeMiB;
        } else {
          this.flasher = null;
          this.utilLoaded = false;
        }
        this.connection = "connected";
        this.everConnected = true;
        this.startPoll();
        // AUTO: a reconnect can land mid-install (a stub boot re-enumerates the probe by
        // design), and a scan must never compete with the write that is already running.
        void this.runScan("connect", { auto: true }); // we can always scan intflash
      } catch (e) {
        this.error = e instanceof Error ? e.message : String(e);
        // INTO THE LOG TOO. `this.error` is write-only (no component reads it), and every
        // caller of connect() swallows the rethrow, so without this a failed connect left no
        // trace anywhere the user or a bug report could reach. A dismissed chooser is not a
        // failure and goes to the debug channel instead, where it costs nothing and cannot
        // ring the bell.
        if (isPickerDismissal(e)) dbg(`[connect] the device chooser was dismissed`);
        else auditLog.add("error", "device", msg((t) => t.shared.auditLog.connectFailed, this.error));
        // Plain teardown — NOT the public disconnect(): a failed connect attempt (bad probe,
        // WebUSB error) is not a "manual disconnect" and must not suppress auto-retry for a
        // caller (e.g. the reconnect loop below) that's about to try again.
        await this._teardownConnection();
        throw e;
      } finally {
        this._connectPromise = null;
      }
    })();
    return this._connectPromise;
  }

  /** Silently attach to a probe ONLY if exactly one trusted adapter is already authorized.
   *  Never shows a USB picker. Safe to call fire-and-forget on navigation or USB reconnect. */
  async connectSilent(): Promise<void> {
    if (this.connection !== "disconnected" && this.connection !== "lost") return;
    if (this._suppressAutoRetry) return; // manual disconnect — user must reconnect explicitly
    try {
      const known = await getKnownProbes();
      if (known.length !== 1) return; // 0 = nothing to auto-attach; 2+ = ambiguous
      // Re-check the guard AFTER the await. This is the second half of the "adapter reconnects
      // two or three times" report: the USB `connect` event fires connectSilent() at the same
      // moment handleLost()'s reconnectLoop is retrying. connectSilent passed its guard while
      // the link was still "lost", then getKnownProbes() awaited long enough for the loop to
      // finish attaching — so without this it would attach a SECOND time on top of a healthy
      // session (a second `DEVICE:` line, a second probe handle).
      if (this.connection !== "disconnected" && this.connection !== "lost") return;
      if (this._suppressAutoRetry) return;
      await this.connect();
    } catch {
      // auto-connect failure is non-fatal
    }
  }

  /**
   * Ensure the RAM flash utility is running, loading it on demand behind a confirmation
   * modal. Loading RESETS the device (and is the only safe way to read its flash / write),
   * so every util-requiring action funnels through here. Rejects if the user cancels.
   */
  /** Is the cached stub actually alive on-device (mailbox == IDLE)? RAM read, safe; time-boxed. */
  private async stubAlive(): Promise<boolean> {
    // The CACHED FLASHER's transport, not `this.transport`. They are not always the same
    // object, and the flasher is what the caller gets back: pinging through the store's
    // (possibly freshly reattached) transport answers "is a stub running on the target",
    // which is not the question. The question is "can THIS flasher still transfer".
    const transport = this.flasher?.transport ?? this.transport;
    if (!transport) return false;
    try {
      return await raceWithFallback(isStubAlive(transport), 2500, false);
    } catch {
      return false;
    }
  }

  /** Does the cached stub have a FREE flash context? A dirty/aborted flash leaves contexts wedged
   *  (READY!=0) even while the mailbox reads IDLE — getContext then hangs. Probe with a short
   *  timeout (read-only; just returns a free index or throws). */
  private async contextsFree(): Promise<boolean> {
    if (!this.flasher) return false;
    try {
      // raceWithFallback, NOT getContext's own timeout: getContext (like waitForIdle and
      // waitForContextComplete) checks its deadline only AFTER a transport read returns —
      // `for(;;) { await readWord(); ...; if (past deadline) throw }`. A wedged probe/target
      // leaves that read pending forever (see pollTick's note: a yanked device leaves reads
      // HANGING), so the deadline is unreachable and the call never returns. This probe runs
      // at the intflash→extflash handover, inside ensureStub, which flashImage invokes
      // OUTSIDE its 120s stall watchdog — so a hang here was covered by nothing at all and
      // simply stalled the flow forever. Mirrors stubAlive()'s protection directly above.
      return await raceWithFallback(this.flasher.getContext(3000).then(() => true), 3500, false);
    } catch {
      return false;
    }
  }

  /** @param forceReboot Skip cache-reuse entirely and always boot a fresh stub — this DOES
   *   reset the device every call, only use when a fresh stub is actually required (e.g. a
   *   confirmed-wedged stub). Do NOT use this just to suppress the confirmation modal — that's
   *   what `silent` is for; forcing unconditionally on every call of a repeatedly-invoked
   *   flasher-getter (e.g. once per flash chunk) resets the device far more often than
   *   necessary (this bit us once already — see docs/AUDIT_NOTES.md item #19's follow-up).
   *  @param silent Skip the `StubLoadModal` confirmation if a reboot turns out to be needed,
   *   WITHOUT forcing one — cache-reuse is still attempted first exactly as normal. Use this
   *   for a flasher-getter passed into an already-confirmed, already-in-flight operation
   *   (consent for Recovery Mode was already granted once for this operation; a reboot needed
   *   mid-operation to recover from a stale/dead stub should happen silently, not re-prompt). */
  async ensureStub(log?: (m: string) => void, forceReboot = false, silent = false): Promise<GnwFlasher> {
    if (!this.probe || !this.transport) throw new Error("Not connected.");
    // THE POLL MUST NOT RUN DURING A STUB BOOT, and this is the chokepoint that guarantees it.
    //
    // Seven call sites already wrap their own stub-booting flows in suspendPoll()/resumePoll()
    // (Wizard x3, FlashSection, EraseSection, RomSection, OfficialFirmwareSection,
    // RomManagementTab x2). The header's "Start Recovery Mode" did not -- it calls
    // startRecoveryMode() -> ensureStub() straight from DeviceControls with nothing silencing
    // the poll, which is why recovery mode was the one boot that intermittently failed.
    //
    // Why it matters: startStub() is nine SEPARATE awaited transport operations (reset, the
    // verified firmware load, two status writes, msp, pc, the pc read-back, resume, waitForIdle).
    // Between them the serial queue drains and `transport.busy()` is FALSE, so pollTick()'s
    // busy() guard passes and it issues a ping into the middle of the boot. That ping is
    // time-boxed at 300 ms by raceWithFallback but NOT cancelled, so if it lands behind one of
    // the load's chunks it blows the box, reports `false`, and calls handleLost() -- which sets
    // _reconnectAfterBoot, and from there any throw out of bootStub tears the connection down
    // and declares it lost. The device is left reset (black screen) with no stub. Same class of
    // interleaving the screenshot path documents in CLAUDE.md, and the same cure.
    //
    // Counted, so nesting under those seven existing suspensions is a no-op, which is exactly
    // what the counted design exists for. Wrapped over the WHOLE method (not just bootStub) so
    // the cached-flasher probes and readInfo are covered too.
    this.suspendPoll();
    try {
      return await this._ensureStubInner(log, forceReboot, silent);
    } finally {
      this.resumePoll();
    }
  }

  private async _ensureStubInner(log?: (m: string) => void, forceReboot = false, silent = false): Promise<GnwFlasher> {
    if (!this.probe || !this.transport) throw new Error("Not connected.");
    // Reuse the cached stub ONLY if it's alive AND has a free context. A wedged stub (after a failed
    // flash), dirty contexts, or a power-cycled device → re-boot a clean stub (clears contexts +
    // resets the context counter), otherwise the next flash hangs forever in getContext.
    let reboot = forceReboot;
    if (this.flasher && !forceReboot) {
      await new Promise(r => setTimeout(r, 100)); // USB settle delay
      // Identity first, and it is not redundant with the two liveness probes below. A cached
      // flasher captured its transport by value at boot time (`bootTransport`); a teardown +
      // reconnect in between builds a NEW ProbeHandle and a NEW transport and leaves the old
      // USBDevice handle closed. Every transfer through the stale flasher then throws
      // "InvalidStateError: The device must be opened first" forever, and the retry loops
      // above this call spend their whole budget -- one device-resetting stub reboot per
      // attempt -- on it. That is the observed failure. See isDeadHandleError (swd-transport).
      // Two questions, and the second is the one the owner's log answered. Identity: is the
      // cached flasher bound to the transport the store still uses. Openness: is the USBDevice
      // underneath actually open RIGHT NOW. `stubAlive()` and `contextsFree()` can both come
      // back true and the very next `transferOut` still throw "The device must be opened
      // first", because the probes read through the serial queue while something else (a
      // background scan racing the install) closed and reopened the handle. `USBDevice.opened`
      // is the browser's own answer and costs nothing.
      const sameHandle =
        this.flasher.transport === this.transport && this.probe.device.opened !== false;
      if (!sameHandle) {
        dbg("[ensureStub] cached flasher holds a superseded transport -> re-booting a fresh stub");
      }
      if (sameHandle && (await this.stubAlive()) && (await this.contextsFree())) {
        dbg("[ensureStub] reusing cached flasher (alive + context free)");
        return this.flasher;
      }
      dbg("[ensureStub] cached stub unusable (dead or wedged contexts) → re-booting a fresh stub");
      this.flasher = null;
      this.utilLoaded = false;
      reboot = true;
    }
    if (!reboot && !silent) {
      // First load — confirm via the modal (loading the util resets the device).
      dbg("[ensureStub] awaiting confirm → bootStub");
      await new Promise<void>((resolve, reject) => {
        this.stubPrompt = { resolve, reject };
      });
    }
    // bootStub()'s reset causes a real, brief USB disconnect/reconnect (ST-Link/probe
    // re-enumerates — see handleLost()'s doc comment), which can invalidate the underlying
    // USBDevice handle. Bump _gen so any in-flight background reads (core-version check, FS
    // stats, …) started before this reboot know to abandon their read loop rather than keep
    // issuing transferOut calls against a transport that's about to close out from under them.
    const gen = ++this._gen;
    // Booting the RAM stub resets the target and leaves it running our loader instead of its
    // own firmware — an unplug in this window is exactly as bad as one mid-flash. Held here as
    // well as in installProgress.confirm() because this path is also reachable straight from
    // the header's device menu ("Start Recovery Mode"), with no progress modal involved.
    // Reference-counted, so a nested call inside an in-flight install is a no-op.
    deviceSafety.hold();
    // Own the handle for the whole write (see _stubBootDepth): a teardown triggered by this
    // very boot's re-enumeration must not close the USBDevice under us. Transport captured by
    // value because _teardownConnection() nulls the field.
    this._stubBootDepth++;
    const bootTransport = this.transport;
    try {
      this.flasher = await bootStub(bootTransport, dbgLog("stub", log));
    } catch (e) {
      // A teardown/rescan bumped `_gen` under us — the link really did go away mid-boot, so
      // whatever the transport threw is a symptom. Report the cause instead.
      // The boot failed AND a drop was seen while it ran: the link really did go away
      // mid-write, so start the reconnect handleLost() deliberately did not.
      if (this._reconnectAfterBoot) {
        this._reconnectAfterBoot = false;
        await this._teardownConnection();
        this.connection = "lost";
        deviceSafety.linkGone();
    lipProgress.reset();
        void this.reconnectLoop("lost");
        throw DeviceStore._bootInterrupted();
      }
      if (gen !== this._gen) throw DeviceStore._bootInterrupted();
      throw e;
    } finally {
      this._stubBootDepth--;
      this._flushDeferredDispose();
      deviceSafety.release();
    }
    // Boot "succeeded" but the link was superseded meanwhile: the flasher we just built points
    // at a dead transport, so fail here rather than letting readInfo() below throw obscurely.
    if (gen !== this._gen) {
      this.flasher = null;
      this.utilLoaded = false;
      throw DeviceStore._bootInterrupted();
    }
    // The boot wrote through this handle successfully, so the drop handleLost() deferred was
    // the expected re-enumeration and the link is demonstrably fine. Resume the poll it
    // silenced; there is nothing to reconnect.
    if (this._reconnectAfterBoot) {
      this._reconnectAfterBoot = false;
      this.startPoll();
    }
    this.utilLoaded = true;
    // Fresh-boot path (Tier 0/2): the stub is now definitely alive, so both `locked`
    // (Tier 0) and `extSizeMB` (Tier 2) can be read off the same info struct.
    this.info = await readInfo(this.flasher, dbgLog("stub", log));
    this.locked = this.info.locked;
    this.extSizeMB = this.info.externalFlashSizeMiB;
    // A reboot invalidates any "banks already scanned this connection" freshness — force a
    // real re-scan of intflash on the next runScan() rather than trusting cached banks.
    this._banksScannedAt = 0;
    // THE DEVICE HAS ATTESTED. `readInfo` above is a completed exchange with no write in
    // flight -- the same class of evidence the liveness poll's ping provides, which is the only
    // other thing that clears the header's post-write warning.
    //
    // Without this the warning outlives the operation by however long the NEXT thing on the
    // link takes, because `pollTick` returns early while `transport.busy()` and so cannot
    // attest anything until the link is idle. Booting into Recovery Mode now rescans every
    // time, so "Finishing up. Do not disconnect" sat there for the whole walk of the chip.
    // A no-op when a hold is still outstanding (`markQuiet` checks), so a boot nested inside
    // an install cannot pull the warning down mid-flash.
    deviceSafety.markQuiet();
    dbg("[ensureStub] stub booted + info read");
    return this.flasher;
  }

  /**
   * The header's "Start Recovery Mode", and the ONE path that always re-reads the device.
   *
   * When the app opens, Retro-Go is usually running: the scan on connect describes the device
   * as it could be read THEN. Booting the RAM stub resets the target and changes what is
   * readable -- `locked` and the external flash size come off the stub's own info struct, the
   * bank scan's cached freshness is dropped (`_banksScannedAt = 0` in `ensureStub`), and the
   * partition walk is only meaningful with the stub up. Dropping the freshness only means the
   * NEXT scan will be real; it does not cause one, and nothing here was asking for one, so the
   * UI kept describing the pre-reset device until something else happened to trigger a scan.
   *
   * So this rescans every time, deliberately (not `auto`): the user asked for recovery mode,
   * the device is idle by definition once the boot returns, and a stale panel after an explicit
   * mode change is worse than the seconds a scan costs.
   *
   * A scan already in flight was started BEFORE this boot and describes the old state, so it is
   * awaited and discarded rather than joined -- `runScan` coalesces onto an in-flight promise,
   * which would otherwise hand back exactly the stale answer this exists to replace.
   *
   * Throws what `ensureStub` throws, including the user's own Cancel on `StubLoadModal`; the
   * rescan is skipped in that case because no boot happened.
   */
  async startRecoveryMode(): Promise<void> {
    // One structured line per attempt, in the shape of the `[summary]` and `[bios]`
    // diagnostics: a whole question answered by one entry. The owner reported this failing
    // intermittently with a black screen and no error, and it was undiagnosable from the
    // outside for two reasons that this line fixes together.
    //
    // First, a FAILED recovery boot is completely silent: DeviceControls catches the throw
    // into `device.error`, and `device.error` has NO renderer anywhere in the app (its own
    // comment records this, verified 2026-09-07). So the only difference between "the boot
    // failed" and "the click did nothing" was invisible, which is why the reported cure was
    // pressing the button again.
    //
    // Second, the interesting facts are spread across three objects. `drop` says whether
    // handleLost() fired during the boot (the poll race), `pollDepth` says whether the poll
    // was actually silenced, and `ms` says which step was slow. A failure that reports
    // drop:true is the race; one that reports drop:false with an error is something else.
    //
    // `dbg()` is safe here: this runs from a click handler, not from a `$derived` or an
    // `$effect` (see test/effectloop.mjs for why that distinction is load-bearing).
    const t0 = Date.now();
    let bootMs = 0;
    let outcome = "ok";
    // Deliberately untyped and empty-string rather than `string | null`: test/recoveryrescan.mjs
    // lifts this method's TEXT and compiles it on its own, stripping only the return annotation.
    // A type annotation in here makes that lift throw, and its armed guard then fails the whole
    // suite rather than silently testing nothing. Keep this body free of TS syntax.
    let err = "";
    try {
      // A probe can report as connected after its WebUSB handle has been closed by a prior
      // re-enumeration. That is exactly the failure Chrome reports as `transferOut ... must be
      // opened first`; retrying bootStub on the same transport can never work. Reattach the
      // authorized probe and retry automatically so a transient stale handle does not require
      // the user to press Start Recovery Mode several times.
      for (let attempt = 1; ; attempt++) {
        try {
          await this.ensureStub(undefined, true);
          break;
        } catch (e) {
          if (!isDeadHandleError(e) || attempt >= 3) throw e;
          dbg(`[recovery] stale USB handle during stub boot; reattaching (retry ${attempt}/2)`);
          await this._teardownConnection();
          this.connection = "lost";
          await new Promise((resolve) => setTimeout(resolve, 250));
          await this.connect();
          // connect() starts an automatic scan; finish it before the next boot so the scan
          // cannot take the freshly opened probe away from ensureStub again.
          if (this._scanPromise) await this._scanPromise.catch(() => {});
        }
      }
      bootMs = Date.now() - t0;
      if (this._scanPromise) await this._scanPromise.catch(() => {});
      await this.runScan("recovery mode");
    } catch (e) {
      bootMs = bootMs || Date.now() - t0;
      outcome = e instanceof StubLoadCancelled ? "cancelled" : "failed";
      err = e instanceof Error ? e.message : String(e);
      throw e;
    } finally {
      dbg(
        `[recovery] ${JSON.stringify({
          outcome,
          err: err || null,
          bootMs,
          totalMs: Date.now() - t0,
          drop: this._reconnectAfterBoot,
          pollDepth: this.pollSuspendDepth,
          connection: this.connection,
          utilLoaded: this.utilLoaded,
        })}`,
      );
    }
  }

  /**
   * Make this device writable before a flow writes to it. Call at the TOP of any flow that
   * changes the device; it is a no-op on an already-unlocked one.
   *
   * The owner: "the device should be unlocked if they're using this tool to change anything on
   * the device. It should just automatically happen. We don't care about locking because
   * there's no benefit to it." So there is no opt-in and no dead end — either this returns and
   * the flow proceeds, or it throws and the flow stops.
   *
   * The ordering (backup exists -> unlock -> proceed) and the single surviving prompt live in
   * `engine/unlockGate.ts`, which is where they are tested. This method is the wiring: real
   * flasher, real modal, real rescan, real audit log.
   *
   * @throws {UnlockDeclined} the user declined the destructive prompt.
   */
  async ensureUnlocked(): Promise<UnlockOutcome> {
    return runUnlockGate({
      locked: this.locked,
      backupTaken: this.backupTaken,
      confirmDestructive: () =>
        new Promise<void>((resolve, reject) => {
          this.unlockPrompt = { resolve, reject };
        }),
      unlock: async () => {
        const flasher = await this.ensureStub();
        // Unlocking resets the target and mass-erases both flashes, so the stub we just
        // booted does not survive it — drop the cached handle rather than letting the next
        // call reuse a flasher pointing at a device that has been wiped under it.
        try {
          await flasher.unlock();
        } finally {
          this.flasher = null;
          this.utilLoaded = false;
        }
      },
      // Everything the UI knows about this device described a locked, populated device; after
      // the mass erase none of it is true. Re-scan rather than patching `locked` to false.
      afterUnlock: async () => {
        await this.runScan("stub ready");
      },
      note: (n) => {
        if (n.kind === "unlocking")
          auditLog.add("warning", "device", msg((t) => t.officialFirmware.unlockErasing));
        else if (n.kind === "unlocked")
          auditLog.add("info", "device", msg((t) => t.officialFirmware.unlockDone));
        else if (n.kind === "declined")
          auditLog.add("info", "device", msg((t) => t.officialFirmware.unlockDeclined));
      },
    });
  }

  /** The unlock modal's "Unlock and erase". */
  confirmUnlock(): void {
    const p = this.unlockPrompt;
    this.unlockPrompt = null;
    p?.resolve();
  }

  /** The unlock modal's "Cancel". */
  cancelUnlock(): void {
    const p = this.unlockPrompt;
    this.unlockPrompt = null;
    p?.reject(new UnlockDeclined("Unlocking was cancelled."));
  }

  /** The stub-load modal's "Continue". */
  confirmStubLoad(): void {
    const p = this.stubPrompt;
    this.stubPrompt = null;
    p?.resolve();
  }

  /** The stub-load modal's "Cancel". */
  cancelStubLoad(): void {
    const p = this.stubPrompt;
    this.stubPrompt = null;
    p?.reject(new StubLoadCancelled("Loading the flash utility was cancelled."));
  }

  /**
   * Scan flash geometry over SWD (non-blocking; updates reactive state). intflash is a
   * direct read (fast), extflash is the gnwmanager-style stride walk via the stub's
   * memory-mapped extflash. Re-runnable after a big change. See docs/ARCHITECTURE.md "Device Scan & Classification".
   */
  private _scanPromise: Promise<void> | null = null;
  /** How many scans this session has run, and when the last one finished. Instrumentation only:
   *  `runScan` coalesces CONCURRENT callers, never back-to-back ones, and there are eight call
   *  sites. Three firing in sequence is three full walks of the chip, which is indistinguishable
   *  from one slow scan unless something counts them. */
  private _scanSeq = 0;
  private _lastScanEndedAt = 0;
  /**
   * @param reason WHO asked. Untranslated and diagnostic, like the flasher's device lines: it
   *  goes to the device log so a slow rescan can be attributed to its trigger rather than
   *  guessed at. Every call site passes one.
   */
  async runScan(reason = "unknown", opts: { auto?: boolean } = {}): Promise<void> {
    // AN AUTOMATIC SCAN WAITS FOR THE WRITE TO FINISH. Two logical operations on one link is
    // the bug the owner hit: an install parked at 0% with a scan frozen part-way through the
    // extflash walk. A USB re-enumeration -- which a mid-flash stub reboot causes by design --
    // fires `connect()`, and `connect()` fired this. The two then shared one `GnwFlasher`, both
    // claimed the same mailbox context, and the device stopped picking up contexts at all.
    // `packages/gnw-flasher`'s `claimContext` now keeps that from wedging the mailbox, but a
    // scan competing with a flash for the link is still pure cost with nothing to gain: the
    // flow that owns the device rescans when it is done.
    //
    // DELIBERATE scans are not gated. `runInstall` awaits `runScan("after ROM install")` from
    // INSIDE the install, where `deviceSafety` is still "writing" by construction -- gating on
    // the flag alone would deadlock the post-install rescan against the install that asked for
    // it. The distinction is who asked, which is why `auto` is passed rather than inferred.
    if (opts.auto && !(await this._awaitLinkIdle(reason))) return;
    if (this._scanPromise) {
      dbg(`[scan] ${reason}: joined the scan already running`);
      return this._scanPromise;
    }
    const seq = ++this._scanSeq;
    const sinceLast = this._lastScanEndedAt ? Date.now() - this._lastScanEndedAt : -1;
    // A scan that starts moments after one finished is the pattern worth seeing: it means two
    // triggers fired in sequence, and the user experiences it as one long scan.
    if (sinceLast >= 0 && sinceLast < 5000) {
      dbg(`[scan] #${seq} ${reason}: starting ${sinceLast} ms after scan #${seq - 1} ended`);
    }
    const t0 = Date.now();
    this._scanPromise = this._doScan();
    try {
      await this._scanPromise;
    } finally {
      this._scanPromise = null;
      this._lastScanEndedAt = Date.now();
      // A scan is a long series of completed device reads, so finishing one attests liveness
      // exactly as `readInfo` does -- and it is the thing most likely to be holding the link
      // immediately after a write (every install ends by rescanning). Same no-op-under-a-hold
      // rule: an install's own post-write scan runs while `deviceSafety` is still "writing",
      // and this must not clear the warning before that install releases it.
      deviceSafety.markQuiet();
      dbg(
        `[scan] #${seq} ${reason}: ${Date.now() - t0} ms, ` +
          `${this._scanReads} reads, ${this._scanBytes} B, ${this.partitions.length} partition(s)` +
          // The one fact that separates "the walk is slow" from "the walk was fighting a flash".
          (this._scanSawWrite ? ", OVERLAPPED A DEVICE WRITE" : ""),
      );
    }
  }
  /**
   * Hold an automatic scan until nothing is writing to the device.
   *
   * Same shape and budget as `_doScan`'s own `linkIdle()`, which already makes the background
   * FS-stat reads wait for exactly this. The scan itself was simply never given the same rule.
   * Returns false when the caller should drop the scan entirely rather than run it late.
   */
  private async _awaitLinkIdle(reason: string): Promise<boolean> {
    if (deviceSafety.state !== "writing") return true;
    const t0 = Date.now();
    for (let i = 0; i < 120 && deviceSafety.state === "writing"; i++) {
      await new Promise((r) => setTimeout(r, 250));
    }
    if (deviceSafety.state === "writing") {
      // 30 s of continuous writing is a long flash, not a stuck one, and the operation that
      // owns the link rescans when it finishes. Say so: a scan that silently never happened is
      // how stale geometry gets blamed on the scanner.
      dbg(`[scan] ${reason}: dropped, the device has been writing for ${Date.now() - t0} ms`);
      return false;
    }
    dbg(`[scan] ${reason}: waited ${Date.now() - t0} ms for the write to finish`);
    return true;
  }

  /** Reads and bytes the CURRENT scan has issued. Reset per scan by `_doScan`. */
  private _scanReads = 0;
  private _scanBytes = 0;
  /** Did a device WRITE overlap this scan? See the sampling note in `_doScan`'s `counted`. */
  private _scanSawWrite = false;
  private async _doScan(): Promise<void> {
    if (!this.transport) return;
    const flasher = this.flasher;
    const transport = this.transport;
    const gen = ++this._gen; // supersede any in-flight background reads from a prior scan
    this.scanning = true;
    this.scanProgress = 0;
    // CLAIM THE LIP for the whole scan, here, not at the first progress callback: the UID and
    // bank reads come first, and until something claims it every one of them is drawn as its
    // own 0-to-100 sweep. That is what a scan of ~1400 reads looked like.
    lipProgress.operationProgress("scan", 0);
    this._scanReads = 0;
    this._scanBytes = 0;
    this._scanSawWrite = deviceSafety.state === "writing";
    // Every read the scan issues, counted at the one place they all pass through. A count is
    // the difference between "the walk is slow" and "the walk ran three times".
    const counted = <T extends (off: number, len: number) => Promise<Uint8Array>>(fn: T): T =>
      (async (off: number, len: number) => {
        this._scanReads++;
        this._scanBytes += len;
        // OVERLAP WITNESS. A scan and a device write sharing the link is the shape of the
        // "install stuck at 0%, scan frozen part-way" report, and from the log alone the two
        // were indistinguishable from one slow scan. Sampled on every read because a write can
        // start at any point during the walk, not only before it.
        if (deviceSafety.state === "writing") this._scanSawWrite = true;
        return fn(off, len);
      }) as T;
    // ONE denominator for the whole scan, so the bar moves from the first read to the last.
    //
    // Only the partition walk used to report, so the bar sat at 0 through the UID and bank reads
    // -- which is what "the first scan is not shown" was: the lip claimed at 0 with nothing
    // moving it, i.e. invisible, until the walk started. The weights are how long each phase
    // takes RELATIVE to the others, not how much work it is in the abstract: the walk dominates
    // because it is the only phase whose cost scales with the chip.
    const W = { uid: 0.04, banks: 0.16, partitions: 0.64, games: 0.16 } as const;
    const before = { uid: 0, banks: W.uid, partitions: W.uid + W.banks, games: W.uid + W.banks + W.partitions };
    /** "Everything before this phase, plus this much of it." Monotonic: the bar never goes back. */
    const phase = (name: keyof typeof W, fraction: number): void => {
      const next = before[name] + W[name] * Math.max(0, Math.min(1, fraction));
      if (next > this.scanProgress) this.scanProgress = next;
      lipProgress.operationProgress("scan", this.scanProgress);
    };
    this.scanError = null;
    try {
      await this._readDeviceUid(transport);
      phase("uid", 1);
      // Tier 1 (safe, intflash-only) — skip re-scanning the banks if we scanned them very
      // recently in this same connection (see `_banksScannedAt`'s doc comment above); Tier 2
      // (below) still runs in full regardless.
      const banksFresh =
        this.banks.length > 0 &&
        this._banksScannedAt > 0 &&
        Date.now() - this._banksScannedAt < DeviceStore.BANK_RESCAN_SKIP_WINDOW_MS;
      if (!banksFresh) {
        // The bank scan has no progress of its own and is not quick: an unrecognised bank is
        // DOWNLOADED IN FULL to search it for Retro-Go strings (intflashscan.ts's
        // `read(base, len)`), so two banks can be half a megabyte over SWD. Reported at 4% with
        // nothing moving for a second or two, which is the stall the owner saw after the jump.
        //
        // There is no honest total here -- whether a bank is downloaded depends on what it turns
        // out to hold -- so the budget is the worst case, both banks in full. The bar therefore
        // advances truthfully and simply arrives early when a bank is recognised without a full
        // read, which `phase`'s monotonic clamp absorbs.
        const bankBudget = 2 * (256 << 10);
        let bankBytes = 0;
        this.banks = await scanIntflashBanks(
          counted(async (addr, len) => {
            // The transport reports its own chunk progress, which matters here because the big
            // read is ONE call of up to 256 KiB: without this the bar would only move between
            // reads, and the longest read is exactly the stretch that looked frozen.
            const data = await transport.readMemory(addr, len, (done) =>
              phase("banks", (bankBytes + done) / bankBudget),
            );
            bankBytes += len;
            phase("banks", bankBytes / bankBudget);
            return data;
          }),
        );
        this._banksScannedAt = Date.now();
      }
      const runtime = await detectRuntime(transport, this.banks);
      this.runtimeKind = runtime.kind;
      this.runtimeBank = runtime.bank;
      if (runtime.kind !== "retro-go") this.retroGoActivity = null;
      phase("banks", 1);
      // Tier 2 (deep, needs the stub) — extflash partitions + installed games.
      const extSize = this.info?.externalFlashSizeBytes ?? 0;
      if (flasher) {
        // A rescan is the app's only signal that the extflash may have been rewritten (every
        // install ends with one). The LittleFS block cache is not keyed to anything, so it has
        // to be dropped here or a later write mounts a partition layout that no longer exists.
        this.lfsBlockCache.clear();
        this.lfsChunkHashes.clear();
        this.installedLfsTree = null;
        this.partitions = await scanExtflashPartitions(
          counted((off, len) => dumpRegion(flasher, 0, off, len)),
          extSize,
          (done, total) => phase("partitions", total ? done / total : 0),
        );
      } else {
        this.partitions = [];
      }
      this.deviceClass = classifyDevice(this.info, this.banks, this.partitions);

      // `model` still gets a plain reactive mirror (used by `accent`/UI tinting); `firmware`
      // itself is now a pure derived getter off `deviceClass` (see its getter above) — nothing
      // to assign here.
      if (this.deviceClass.ofw) {
        this.model = this.deviceClass.ofw.model;
      }

      if (this.targetMedia === 'sd') {
        // For SD card mode, FrogFS doesn't exist. installedGames comes from the SD Card itself.
        // The Connect view populates device.sdHandle.
        await this.scanSdCardGames();
      } else {
        // Read the installed-games list from the device's FrogFS (metadata only). Best-effort:
        // no frogfs partition or an unreadable image → empty list, not a scan failure.
        const frogfs = this.partitions.find((p) => p.fs === "frogfs");
        if (frogfs) {
          // The installed-games read is the last thing the scan does and it is not instant: it
          // pulls the FrogFS metadata region. Move the bar into the phase before it starts, so
          // the last stretch is not a freeze at whatever the walk ended on.
          phase("games", 0.1);
          try {
            const res = await readInstalledFrogfs((off, len) => dumpRegion(flasher!, 0, off, len), frogfs.offset);
            this.installedFrogfs = res;
            this.installedGames = res.games;
          } catch (e) {
            // NOT SILENT ANY MORE. A failed parse leaves `installedFrogfs` null, and null is
            // not "no games" -- it is "we do not know", which the Library's install projection
            // reads as an empty before-side and reports as a removal of everything on the
            // device. That state cost a long diagnosis while this catch said nothing at all.
            dbg(`[scan] installed FrogFS parse failed: ${e instanceof Error ? e.message : String(e)}`);
            this.installedFrogfs = null;
            this.installedGames = [];
          }
        } else {
          this.installedGames = [];
        }
      }
    } catch (e) {
      this.scanError = e instanceof Error ? e.message : String(e);
      // `scanError` is drawn by exactly ONE surface (RomSection's advanced view), so a scan
      // that failed while the user was anywhere else in the app said nothing. Everything
      // downstream reads a half-filled device model without being told why.
      auditLog.add("error", "device", msg((t) => t.shared.auditLog.scanFailed, this.scanError));
    } finally {
      // Arrive. A scan that stops at 0.84 because its last phase threw looks like a hang.
      phase("games", 1);
      this.scanning = false;
      this._lastFullScanAt = Date.now();
      // Hand the lip back, whether the scan finished or threw. The background FS-stat reads
      // that follow are not part of what the user asked for, and they go back to sweeping
      // per transfer like any other read.
      lipProgress.operationProgress("scan", null);
    }

    // Background fetch of FS stats so we don't block the UI. Each read checks `gen`
    // before writing back — a disconnect or a newer scan bumps `_gen` and makes any
    // still-running read a no-op instead of racing a flash/screenshot or writing
    // stats for a device that's no longer connected.
    //
    // `gen` is checked when a read RETURNS, which is too late to stop it issuing transfers in
    // the meantime. A rescan runs at the end of every install, so these reads were still in
    // flight when the NEXT install started programming, and the owner's log is full of what
    // that costs: "An operation that changes the device state is in progress", then "The
    // device must be opened first", then a stub reboot, on a link that was fine. They are
    // never urgent, so they wait for the link to be idle instead of competing for it.
    const writing = (): boolean => deviceSafety.state === "writing";
    const linkIdle = async (): Promise<boolean> => {
      for (let i = 0; i < 120 && writing(); i++) {
        await new Promise((r) => setTimeout(r, 250));
        if (gen !== this._gen) return false;
      }
      return gen === this._gen && !writing();
    };
    void (async () => {
      if (!(await linkIdle())) {
        dbg("[scan] FS stats skipped: the link was busy or superseded");
        return;
      }
      this._startFsStatReads(gen);
    })();
  }

  /** The background FS-stat + core-version reads, once the link is idle. See `runScan`. */
  private _startFsStatReads(gen: number): void {
    // The lip stays dark for these. They are hundreds of block reads for numbers that appear
    // quietly in a panel -- the user did not ask for them and cannot act on them, so drawing
    // each read as its own sweep is strobing rather than feedback. Released when the last
    // reader settles, however it settles.
    lipProgress.setQuiet(true);
    let outstanding = 0;
    const started = <T>(pr: Promise<T>): Promise<T> => {
      outstanding++;
      return pr.finally(() => {
        outstanding--;
        if (outstanding === 0) lipProgress.setQuiet(false);
      });
    };
    for (const p of this.partitions) {
      if (p.fs === "fat") {
        void started(
          import("./engine/fsscan.js")
            .then(({ readFatUsedSpace }) =>
              readFatUsedSpace((off: number, len: number) => dumpRegion(this.flasher!, 0, off, len), p.offset, p.size),
            )
            .then((res) => {
              if (res && gen === this._gen) this.fsStats[p.offset] = res;
            })
            .catch((e) => dbg(`[scan] FAT usedSpace read failed: ${e}`)),
        );
      } else if (p.fs === "littlefs") {
        void started(
          import("./engine/lfsBrowser.js")
            .then(({ getLfsUsedSpace }) => getLfsUsedSpace())
            .then((res) => {
              if (res && gen === this._gen) this.fsStats[p.offset] = res;
            })
            .catch((e) => dbg(`[scan] LittleFS usedSpace read failed: ${e}`)),
        );
        // Core-version validation (Flash mode only — SD-mode's own equivalent runs from
        // scanSdCardGames()). Deliberately kicked off here, AFTER scanning=false and the
        // UI-critical partition/deviceClass results are already set, since it pulls every
        // core's full bytes over SWD (no partial-read primitive exists) and must never delay
        // the results the UI is waiting on.
        if (this.targetMedia !== "sd") {
          const firmwareVersion = this.banks.map((b) => b.retroGoVersion).find(Boolean) ?? null;
          void started(
            import("./engine/lfsBrowser.js")
              .then(({ checkCoreVersions }) => checkCoreVersions(firmwareVersion, () => gen !== this._gen))
              .then((res) => {
                if (gen === this._gen) this.coreVersionCheck = res;
              })
              .catch((e) => dbg(`[scan] Core version check failed: ${e}`)),
          );
        }
      }
    }
    // Nothing to wait for: release immediately rather than leaving the lip silenced forever.
    if (outstanding === 0) lipProgress.setQuiet(false);
  }

  async scanSdCardGames(): Promise<void> {
    if (this.targetMedia !== 'sd' || !this.sdHandle) {
      this.installedGames = [];
      return;
    }
    const gen = ++this._gen; // supersede any in-flight background reads from a prior SD scan
    this.scanning = true;
    try {
      const { scanRomDirectory, getValidRoot, checkSdCoreVersions } = await import("./romScan.js");
      const root = await getValidRoot(this.sdHandle);
      if (root) {
        // The card's homebrew directory is the manifest's (`/homebrews`); romScan deliberately
        // does not know that -- see LEGACY_HOMEBREW_PREFIXES for why it must not import it.
        const scan = await scanRomDirectory(root, null, homebrewScanPrefixes());
        const games: InstalledGame[] = [];
        // Classification is `devicePaths.ts`'s job, not this loop's: the directories are the
        // firmware's (manifest `paths`), and the asset skips and the system/name split have to
        // match what an SD sync WROTE. This used to read the key's top segment verbatim, which
        // made homebrew installed at the manifest's `/homebrews` arrive as system "homebrews"
        // and vanish from every "is it installed" check.
        // One title, one row: a legacy homebrew copy of something the manifest's directory
        // already holds is not listed. Computed over the whole key set because a single key
        // cannot know what the other directory holds, which is why this is not in
        // `classifySdScanKey`. See its comment for why nothing downstream reads it as a delete.
        const shadowed = shadowedLegacyHomebrewKeys(scan.userRoms.keys());
        for (const [path, data] of scan.userRoms.entries()) {
          if (shadowed.has(path)) continue;
          const g = classifySdScanKey(path);
          if (!g) continue;
          games.push({
            path: g.path,
            system: g.system,
            name: g.name,
            // Both a Uint8Array and an un-inflated zip entry report `length`; the zip entry's is
            // its UNCOMPRESSED size, which is what an installed-games listing means by size.
            size: data.length,
            dataOffs: 0,
          });
        }
        this.installedGames = games;
        // Core-version validation — background/non-blocking, like the Flash-mode equivalent in
        // _doScan()'s tail: never delay installedGames (what the UI is waiting on) for this.
        // Firmware version is only known if a device is actually connected and booted into
        // retro-go right now (same intflash read as Flash mode); a bare SD card with no live
        // device falls back to cross-checking cores against each other (see coreVersion.ts).
        const firmwareVersion = this.banks.map((b) => b.retroGoVersion).find(Boolean) ?? null;
        checkSdCoreVersions(root, firmwareVersion).then((res) => {
          if (gen === this._gen) this.coreVersionCheck = res;
        }).catch((e) => dbg(`[scanSdCardGames] Core version check failed: ${e}`));
      } else {
        this.installedGames = [];
      }
    } catch (e) {
      dbg(`[scanSdCardGames] SD scan failed: ${e}`);
      this.installedGames = [];
    } finally {
      this.scanning = false;
    }
  }

  /** Read retro-go's persistent printf log over the LIVE connection (the serialized
   *  transport, so it queues safely with the poll/ops). For the Overview page. */
  async readLog(manual = true): Promise<{ text: string; idx: number }> {
    if (!this.transport) throw new Error("Not connected.");
    const installed = this.banks.find((b) => b.retroGoVersion);
    dbg(`[devicelog] installed=${installed?.retroGoVersion ?? "none"} bank=${installed?.index ?? "none"}`);
    let layout = null;
    if (installed?.retroGoVersion) {
      // The debug ELF is the authority for RAM symbols. If the release is unavailable offline,
      // devicelog.ts still tries the current and legacy known layouts.
      layout = await loadDeviceLogLayout(installed.retroGoVersion, installed.index).catch((e) => {
        dbg(`[devicelog] ELF lookup failed: ${e instanceof Error ? e.message : String(e)}`);
        return null;
      });
      // Pre-v2 releases have no ELF asset. Select their DTCM layout first so stale bytes in the
      // other address pair cannot be mistaken for the current log.
      if (!layout) layout = fallbackLogLayout(installed.retroGoVersion);
    }
    dbg("[devicelog] selected layout", layout ?? "none; probing known layouts");
    const result = await readLogFromTransport(this.transport, layout, !manual);
    if (this.runtimeKind === "retro-go") this.updateRetroGoActivity(result.text);
    return result;
  }

  /** Capture a screenshot from the LTDC layer-1 framebuffer. Always halts the CPU
   *  for a clean, tear-free frame. The poll is suppressed for the duration so it
   *  cannot race against the in-flight halt/read/resume sequence. */
  async captureScreenshot(onProgress?: (done: number, total: number) => void): Promise<ImageData> {
    if (!this.transport) throw new Error("Not connected to a device.");
    // Counted suspend, not raw stopPoll/startPoll: if a screenshot is ever taken while a
    // flash holds its own suspend, the raw pair's finally would restart the poll mid-flash.
    this.suspendPoll();
    try {
      return await _captureScreenshot(this.transport, onProgress);
    } finally {
      this.resumePoll();
    }
  }

  /** Nesting depth of suspendPoll() calls. COUNTED, not a plain stop/start pair: the poll is
   *  one shared timer, so an inner resumePoll() would otherwise restart it while an OUTER
   *  flash is still running — silently reintroducing the very race suspendPoll exists to
   *  prevent, and doing it in the hardest place to reproduce. Only the outermost resume
   *  restarts the timer. */
  private pollSuspendDepth = 0;

  /** Public wrapper: suspend the liveness poll around a flash-writing operation that may
   *  trigger its own internal reset/reboot (e.g. a retry's forced RAM-stub reboot) — same
   *  reasoning as captureScreenshot's poll suppression, to prevent the poll's independent
   *  SWD traffic from racing a concurrent reset. Pair with resumePoll() in a finally.
   *  Safe to nest. */
  suspendPoll(): void {
    this.pollSuspendDepth++;
    this.stopPoll();
  }
  /** Public wrapper: resume the liveness poll after suspendPoll(). Only the outermost call
   *  actually restarts it. An unbalanced resume (more resumes than suspends) is ignored
   *  rather than force-starting the poll underneath a still-running outer operation. */
  resumePoll(): void {
    if (this.pollSuspendDepth === 0) return;
    if (--this.pollSuspendDepth === 0) this.startPoll();
  }

  // --- Liveness poll: catch the device being unplugged FROM the adapter (the adapter stays
  // on USB, so there's no disconnect event — only a failed read reveals it). Loss DURING an
  // op is caught by that op's own transport calls throwing; this poll covers idle moments.
  // The serialized transport lets it share the link with in-flight ops safely.
  private startPoll(): void {
    // Never start underneath an active suspendPoll() — otherwise any internal starter
    // (connect, a nested op's finally) would punch the poll back on mid-flash. The
    // outermost resumePoll() is what legitimately restarts it.
    if (this.pollSuspendDepth > 0) return;
    if (this.pollTimer) return;
    this.pollTimer = setInterval(() => void this.pollTick(), 300);
  }
  private stopPoll(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }
  private async pollTick(): Promise<void> {
    if (this.pinging || !this.transport) return;
    if (this.connection !== "connected" && this.connection !== "attention") return;
    if (this.transport.busy()) {
      if (deviceSafety.state === "settling" && Date.now() - this.lastSettlingPollLogAt >= 1000) {
        this.lastSettlingPollLogAt = Date.now();
        dbg("[poll] waiting for idle transport while settling");
      }
      return; // an op holds the link — it'll surface a loss itself
    }
    this.pinging = true;
    try {
      // Time-box the ping: a yanked device usually leaves the read HANGING (the adapter keeps
      // retrying — the blinking), so "no response in 300 ms while idle" == lost. Safe to
      // time-box because we only ping when the link is idle (never queued behind a long op).
      const pingStarted = Date.now();
      const ok = await raceWithFallback(pingTarget(this.transport), 300, false);
      const pingMs = Date.now() - pingStarted;
      if (deviceSafety.state === "settling" && (pingMs > 100 || !ok)) {
        dbg(`[poll] settling ping ok=${ok} elapsed=${pingMs}ms`);
      }
      if (!ok) {
        if (this.connection === "connected" || this.connection === "attention") {
          await this.handleLost();
        }
        return;
      }
      
      // Target answered while the link was idle, with no operation holding it. This is the
      // app's only device-attested "the write path is quiet and the device is alive" moment,
      // so it is what clears the header's post-write "still unsafe" warning. Note it can only
      // ever fire once the poll is running again — suspendPoll() keeps it silent for the whole
      // duration of a flash, which is precisely the behaviour we want.
      deviceSafety.markQuiet();

      // Check what is running to update UI state:
      const utilAlive = await isStubAlive(this.transport);
      if (utilAlive) {
        this.runtimeKind = "recovery";
        this.runtimeBank = null;
      } else if (this.banks.length > 0 && Date.now() - this.lastRuntimeProbeAt >= 2000) {
        // VTOR is a single live memory read, so this passive probe does not halt the target.
        // The full PC fallback is reserved for deliberate scans; polling must stay tiny.
        this.lastRuntimeProbeAt = Date.now();
        const runtime = await detectRuntime(this.transport, this.banks, { pcFallback: false });
        if (runtime.kind !== "unknown") {
          this.runtimeKind = runtime.kind;
          this.runtimeBank = runtime.bank;
          if (runtime.kind !== "retro-go") this.retroGoActivity = null;
          else this.updateRetroGoActivity((await readLogFromTransport(this.transport, undefined, true)).text);
        }
      }
      if (this.utilLoaded !== utilAlive) {
        // Newly discovered the util already running (e.g. left over from a prior session,
        // found passively here rather than via our own ensureStub() call) — ensureStub()
        // itself never scans (see _doScan()'s Tier 2, gated on `this.flasher` being set AT
        // SCAN TIME), so if this is the first time we're seeing the util alive, Tier 2 may
        // never have run with a flasher available and partitions could still be empty. Fire
        // a scan now rather than leaving the UI stuck showing "Enter Recovery Mode" prompts
        // for a device that's already in recovery mode (status bar already reflects this via
        // utilLoaded). Fire-and-forget: runScan() is a full deep scan, must not block the poll.
        // Freshness-gated (AUTO_SCAN_FRESHNESS_WINDOW_MS) — a scan within the last minute means
        // we already have current data, so skip the unsolicited extra scan and just adopt the
        // state; don't annoy the user with a scan they didn't ask for. This gate is local to
        // this passive/automatic trigger only — deliberate calls to runScan() elsewhere (after
        // an install, an explicit Scan button, etc.) always run regardless.
        const scanIsFresh = Date.now() - this._lastFullScanAt < DeviceStore.AUTO_SCAN_FRESHNESS_WINDOW_MS;
        if (utilAlive && !this.utilLoaded && !scanIsFresh) void this.runScan("liveness poll", { auto: true });
        this.utilLoaded = utilAlive;
      }
      // Runtime classification comes from the live VTOR probe above, never from the persistent
      // log buffer: old log text proves only that Retro-Go ran at SOME point.
    } finally {
      this.pinging = false;
    }
  }

  /** Fires when ANY WebUSB device is unplugged — if it's our probe, treat it as a lost link. */
  private onUsbDisconnect = (e: USBConnectionEvent): void => {
    if (this.probe && e.device === this.probe.device) void this.handleLost();
  };

  /** Reset the displayable device facts to "unknown / not scanned". Used on a fresh connect
   *  and on a manual disconnect — NOT on a lost link (those freeze the last-known info). */
  /**
   * Read the STM32H7's 96-bit unique device ID (RM0455 §60.1, UID base 0x1FF1E800) once per
   * connection. ONE 12-byte read of always-readable system memory — safe while the target is
   * running (same class of read as the liveness poll's CPUID word), and explicitly not a
   * per-item read loop, so it doesn't feed the ST-Link-clone saturation problem.
   *
   * Best-effort: a failure just leaves `deviceUid` null, which degrades every UID-scoped fact
   * (currently only `backupTaken`) to "unknown", never to a wrong device's value.
   */
  private async _readDeviceUid(transport: SerialTransport): Promise<void> {
    if (this.deviceUid) return;
    try {
      const raw = await transport.readMemory(0x1ff1e800, 12);
      const uid = Array.from(raw, (b) => b.toString(16).padStart(2, "0")).join("");
      if (/^0*$/.test(uid) || /^f*$/.test(uid)) return; // all-zero/all-ones → bad read, not an ID
      this.deviceUid = uid;
      // Legacy value is `true`; current value is an epoch-ms number. Both mean "taken".
      const rec = loadSel<boolean | number>(DeviceStore.backupKey(uid), false);
      this._backupTaken = rec !== false;
      this._backupAt = typeof rec === "number" ? rec : null;
    } catch {
      /* non-fatal */
    }
  }

  private clearInfo(): void {
    this.deviceUid = null;
    this._backupTaken = false;
    this._backupAt = null;
    this.info = null;
    this.model = "unknown";
    this.locked = null;
    this.extSizeMB = null;
    this.deviceClass = null;
    this.partitions = [];
    this.banks = [];
    this.installedGames = [];
    this.installedLfsTree = null;
    this.lfsBlockCache.clear();
    this.lfsChunkHashes.clear();
    this.scanProgress = 0;
    this.scanError = null;
    this._banksScannedAt = 0;
  }

  /** Drop the live handles/listeners without touching any user-visible device facts
   *  (`info`/`banks`/`deviceClass`/`installedGames` etc. are left exactly as they were —
   *  callers decide separately whether to freeze (lost link) or clear (manual disconnect,
   *  fresh connect) them). Shared by handleLost/disconnect/resetDevice/connect's failure path. */
  private async _teardownConnection(): Promise<void> {
    this.stopPoll();
    // The link is gone, so any outstanding suspend is moot. Clearing the depth stops a
    // suspend that never got its finally (lost device mid-flash) from permanently
    // disabling the poll for the next connection — connect()'s startPoll() would
    // otherwise be swallowed by the leftover depth.
    this.pollSuspendDepth = 0;
    if (typeof navigator !== "undefined" && navigator.usb) {
      navigator.usb.removeEventListener("disconnect", this.onUsbDisconnect);
    }
    const probe = this.probe;
    if (probe) {
      if (this._stubBootDepth > 0) {
        // An ensureStub() boot is still writing through this handle. Closing it now is the
        // documented race (see _stubBootDepth) — hand it to the boot's own finally instead.
        this._deferredDispose.push(probe);
      } else {
        try {
          await probe.dispose();
        } catch {
          /* already gone */
        }
      }
    }
    this.probe = null;
    this.transport = null;
    this.flasher = null;
    this.utilLoaded = false;
    this.scanning = false;
    this._gen++; // supersede any in-flight background FS-stat reads
  }

  /** Close any probe handles a teardown deferred while a stub boot owned them. Never closes
   *  the handle that is live NOW — by the time a boot settles, the reconnect cadence may
   *  already have attached, and disposing that would kill the fresh session. */
  private _flushDeferredDispose(): void {
    if (this._stubBootDepth > 0) return;
    const probes = this._deferredDispose;
    this._deferredDispose = [];
    for (const p of probes) {
      // Identity is not enough: the reconnect cadence attaches a NEW ProbeHandle wrapping the
      // SAME USBDevice, and disposing that closes the device out from under the live session
      // ("The device must be opened first" on its next write).
      if (p === this.probe || (this.probe && p.device === this.probe.device)) continue;
      void Promise.resolve()
        .then(() => p.dispose())
        .catch(() => {
          /* already gone */
        });
    }
  }

  /** The one error ensureStub() reports when its boot was cut short by a link drop. */
  private static _bootInterrupted(): Error {
    return new Error(
      "Recovery Mode boot was interrupted — the adapter's USB link dropped while the loader " +
        "was being written. Reconnecting…",
    );
  }

  /** Shared reconnect cadence (connection policy: "Two distinct disconnect states"): 10
   *  attempts @ 200ms, then continuous @ 1000ms forever, until reconnected, superseded (a
   *  newer teardown/connect bumped `_gen`), or auto-retry is suppressed (manual disconnect).
   *  `idleState` is what `connection` resets to between failed attempts — connect()'s own
   *  failure path always lands on "disconnected" via _teardownConnection, so we restore
   *  whichever state this caller wants displayed while retrying ("lost" for handleLost,
   *  "connecting" for resetDevice's deliberate reboot-and-rejoin). */
  private async reconnectLoop(idleState: Connection): Promise<void> {
    const gen = this._gen;
    for (let i = 0; ; i++) {
      await new Promise((r) => setTimeout(r, i < 10 ? 200 : 1000));
      if (this._suppressAutoRetry || this._gen !== gen) return; // manual disconnect, or superseded
      try {
        await this.connect();
        return;
      } catch {
        if (this._gen !== gen || this._suppressAutoRetry) return;
        this.connection = idleState;
        this.error = null;
      }
    }
  }

  /** The adapter's USB vanished — FREEZE the last-known info on screen (the user keeps seeing
   *  what was there), drop only the live handles, flip to "lost" so actions gray out until
   *  reconnected, and kick off the auto-retry cadence (see reconnectLoop). Stays on the
   *  current view (everConnected). */
  private async handleLost(): Promise<void> {
    if (this.connection === "disconnected" || this.connection === "lost") return;
    // A stub boot owns the link, so this `disconnect` IS that boot's own re-enumeration
    // (bootStub resets the target; the ST-Link re-enumerates; WebUSB fires the event). The
    // handle the boot captured is still open and still working — recovery.mjs check 1 pins
    // exactly that. Tearing the connection down here is what produced the owner-reported
    // flapping: teardown bumps `_gen` (failing an otherwise healthy boot as "interrupted"),
    // nulls the transport, and starts a reconnect cadence that attaches a SECOND handle to
    // the same adapter while the first is mid-write — WebUSB then rejects one of them with
    // "An operation that changes the device state is in progress". So: quiet the poll,
    // remember the drop, and let the boot decide. It holds the only evidence that matters —
    // whether its own writes still land.
    if (this._stubBootDepth > 0) {
      this.stopPoll();
      this._reconnectAfterBoot = true;
      installProgress.logActive("Link dropped (expected during Recovery Mode boot), continuing…");
      return;
    }
    if (this.stubPrompt) {
      this.stubPrompt.reject(new Error("Connection lost."));
      this.stubPrompt = null;
    }
    if (this.unlockPrompt) {
      this.unlockPrompt.reject(new Error("Connection lost."));
      this.unlockPrompt = null;
    }
    await this._teardownConnection();
    this.connection = "lost";
    deviceSafety.linkGone();
    lipProgress.reset();
    this.error = "Connection lost — the adapter was unplugged. Reconnecting…";
    // Say which drop this is. The branch above handles a stub boot's own re-enumeration and
    // returns; reaching here means NO boot owned the link, so calling it "expected during
    // Recovery Mode boot" was wrong whenever it mattered most -- it printed that mid-FrogFS
    // write, where the truth is an unexpected drop, and sent the reader looking for a stub boot
    // that never happened.
    installProgress.logActive(
      deviceSafety.state === "writing"
        ? "Link dropped mid-write, reconnecting…"
        : "Link dropped, reconnecting…",
    );
    // If a stub boot owns the link, this drop IS that boot's own re-enumeration. Starting the
    // cadence here is what produced the competing-handle race described in connect() above,
    // so defer it: ensureStub()'s finally starts exactly one reconnect once the boot settles.
    void this.reconnectLoop("lost");
  }

  /** Manual, user-initiated disconnect. Unlike handleLost, this suppresses ALL auto-reconnect
   *  (connectSilent, the tab-navigation auto-probe, and any handleLost retry loop already in
   *  flight) until the user explicitly reconnects (which re-enables it — see connect()). */
  async disconnect(): Promise<void> {
    this._suppressAutoRetry = true;
    if (this.stubPrompt) {
      this.stubPrompt.reject(new Error("Disconnected."));
      this.stubPrompt = null;
    }
    if (this.unlockPrompt) {
      this.unlockPrompt.reject(new Error("Disconnected."));
      this.unlockPrompt = null;
    }
    await this._teardownConnection();
    this.probeName = null;
    this.runtimeKind = "unknown";
    this.runtimeBank = null;
    this.retroGoActivity = null;
    this.clearInfo();
    this.connection = "disconnected";
    deviceSafety.linkGone();
    lipProgress.reset();
  }

  async resetDevice(): Promise<void> {
    // Trigger a CPU system reset. The SWD DAP drops immediately after — the throw is expected.
    if (this.transport) {
      try {
        await this.transport.writeWord(0xe000ed0c, 0x05fa0004);
      } catch {
        /* expected: target reset tears down the SWD link */
      }
    }
    // Tear down the now-dead SWD session without touching user-visible state.
    // (Don't call disconnect() — that would set connection="disconnected", suppress
    // auto-retry, and require the user to manually reconnect. Instead, clean up handles and
    // reconnect automatically via the shared cadence.)
    if (this.stubPrompt) {
      this.stubPrompt.reject(new Error("Device reset."));
      this.stubPrompt = null;
    }
    if (this.unlockPrompt) {
      this.unlockPrompt.reject(new Error("Device reset."));
      this.unlockPrompt = null;
    }
    await this._teardownConnection();
    this.connection = "connecting";
    this.error = null;
    await this.reconnectLoop("connecting");
  }

  /** Only ever attempts the silent auto-probe (and the connect-triggered scan that comes with
   *  it) ONCE per page load, even though `autoProbeRoms()` is called on every mount of the ROMs
   *  tab. Without this, revisiting the tab while genuinely disconnected/lost (connectSilent's
   *  own no-op guard only covers the "still connected" case) would keep silently reconnecting
   *  and rescanning on every visit — the user should be able to rely on "beyond the first time,
   *  nothing auto-rescans" and reach for the header's manual reconnect/rescan themselves. */
  private _autoProbedRomsOnce = false;

  /** Context-aware auto-probe (connection policy table): SD+ROMs never auto-connects (SD
   *  doesn't need a device at all); Flash+ROMs silently attempts the known/trusted adapter in
   *  the background, no modal — but only the first time this page session (see
   *  `_autoProbedRomsOnce`). Safe to call repeatedly/idempotently (e.g. on every mount of the
   *  ROMs tab). */
  autoProbeRoms(): void {
    if (this.targetMedia === "sd") return;
    if (this._autoProbedRomsOnce) return;
    this._autoProbedRomsOnce = true;
    void this.connectSilent();
  }

  /** When set, ConnectGateModal is asking the user to connect before proceeding (e.g. "Install
   *  ROMs" clicked in Flash mode while disconnected). Mirrors library.folderGatePrompt's
   *  promise-gate shape/pattern. */
  connectGatePrompt = $state<{ resolve: () => void; reject: (e: Error) => void } | null>(null);

  /** Resolves immediately if already connected. Otherwise, first tries a silent connect using
   *  a known/trusted adapter (no picker) — only if that fails or none exists does it surface
   *  ConnectGateModal and wait for the user to connect (or cancel). */
  async ensureConnectGate(): Promise<void> {
    if (this.isConnected) return;
    if (!this._suppressAutoRetry) {
      try {
        const known = await getKnownProbes();
        if (known.length === 1) await this.connect();
      } catch {
        // fall through to the modal
      }
    }
    if (this.isConnected) return;
    return new Promise<void>((resolve, reject) => {
      this.connectGatePrompt = { resolve, reject };
    });
  }

  /** ConnectGateModal's "Continue" — only enabled once `device.isConnected`. */
  resolveConnectGate(): void {
    const p = this.connectGatePrompt;
    this.connectGatePrompt = null;
    p?.resolve();
  }

  /** ConnectGateModal's "Cancel". */
  cancelConnectGate(): void {
    const p = this.connectGatePrompt;
    this.connectGatePrompt = null;
    p?.reject(new Error("Connection cancelled."));
  }

}

export const device = new DeviceStore();

// The disconnect-safety warning lives in installProgress.svelte.ts (which must not import this
// module — see that file's header), so the "is there even a link to corrupt?" question is
// answered by injection rather than an import. Used when a hold is released: with nothing
// connected (e.g. an SD-card-only sync), there will never be a liveness ping to attest that
// the device settled, so the warning would otherwise hang on "settling" forever.
deviceSafety.setNoLinkProbe(() => !device.isConnected);

// Auto-reconnect when a USB device (re-)connects and we have a lost or idle link.
// Handles the common case: device resets mid-flash → ST-Link USB briefly drops →
// probe re-enumerates → connectSilent() reattaches if it's the only trusted probe.
if (typeof navigator !== "undefined" && navigator.usb) {
  navigator.usb.addEventListener("connect", () => void device.connectSilent());
}

export const modelLabel = (m: Model): string =>
  m === "mario" ? "Mario" : m === "zelda" ? "Zelda" : "Game & Watch";
export const firmwareLabel = (f: Firmware): string =>
  f === "stock-ofw" ? "Stock firmware" : f === "retro-go" ? "retro-go" : "Unrecognized";
