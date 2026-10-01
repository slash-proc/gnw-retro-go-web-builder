// The global device-state object (UX §3.2). Written only by the connection
// layer; read everywhere. Drives the structural model accent.
import type { GnwFlasher, DeviceInfo } from "@gnw/gnw-flasher";
import type { LittlefsTreeNode } from "@gnw/fs-builders";
import { connectProbe, getKnownProbes, serialTransport, chooseProbe, type ProbeHandle, type SerialTransport } from "./engine/transport.js";
import { bootStub, readInfo, dumpRegion, attachFlasher, isStubAlive, pingTarget, readRdpLocked } from "./engine/flasher.js";
import { scanExtflashPartitions, scanExtflashPartitionsLazy, type ExtPartition } from "./engine/fsscan.js";
import { scanIntflashBanks, retroGoInfo, INT_BANK_BASES, type IntflashBank } from "./engine/intflashscan.js";
import type { FirmwareAbi } from "./engine/firmwareAbi.js";
import { classifyDevice, type DeviceClass } from "./engine/classify.js";
import { captureScreenshot as _captureScreenshot } from "./engine/screenshot.js";
import { readInstalledFrogfs, type InstalledGame, type InstalledFrogfs } from "./engine/frogfsDevice.js";
import { classifySdScanKey, homebrewScanPrefixes, shadowedLegacyHomebrewKeys } from "./engine/devicePaths.js";
import { dbg, dbgLog } from "./debug.js";
import { fallbackLogLayout, loadDeviceLogLayout, readLogFromTransport, retroGoActivityFromLog } from "./engine/devicelog.js";
import { detectRuntime, type RuntimeKind, type RuntimeState } from "./engine/runtime.js";
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
import { probeModelFromItcm } from "./engine/itcmModel.js";
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
  /** The selected programmer is available independently of the console's SWD connection. */
  adapterAvailable = $state(false);
  private selectedAdapter: USBDevice | null = null;
  private adapterPollTimer: ReturnType<typeof setInterval> | null = null;
  private adapterPollBusy = false;
  /** SWD clock used when attaching to the debug adapter. Persisted as a user preference. */
  adapterFrequencyHz = $state<number>((() => {
    const saved = loadSel("adapterFrequencyHz", 4_000_000);
    return saved >= 1_000_000 && saved <= 10_000_000 ? saved : 4_000_000;
  })());
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

  /** In-session latch that the guided flow verified or selected a stock backup. This is not
   *  persisted or keyed by device identity; backup presence on disk is checked from the files. */
  private _backupTaken = $state(false);
  /** True after this session's guided flow has verified or selected a stock backup. */
  get backupTaken(): boolean {
    return this._backupTaken;
  }
  /** Mark the guided-flow step only; verified backup files are the durable source of truth. */
  markBackupTaken(): void {
    this._backupTaken = true;
  }


  // Non-reactive engine handles (held across operations while connected).
  private probe: ProbeHandle | null = null;
  /** Serialized transport (all calls FIFO-queued) so the liveness poll can share the link
   *  transparently without crashing the active caller. */
  public transport: SerialTransport | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private pollIntervalMs = 0;
  private pinging = false;
  private targetUnresponsive = false;
  private targetReconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private powerCycleReconnectMode = false;
  private powerCycleReconnectPromise: Promise<void> | null = null;
  private targetPingStalled = false;
  private lastTargetAnswerAt = 0;
  private firstRecoveryAnswerAt = 0;
  private lastItcmRuntimeCheckAt = 0;
  private lastRecoveryBootAttemptAt = 0;
  /** Unlocked stock OFW needs only ITCM + VTOR monitoring; suppress intrusive diagnostics. */
  private stockMonitorMode = $state(false);
  private static readonly TARGET_SILENCE_MS = 15_000;
  private static readonly TARGET_RECOVERY_MS = 1_500;
  private static readonly ACTIVE_POLL_INTERVAL_MS = 300;
  /** While debug access is disabled, retry only the lightweight target ping frequently so
   *  standby wake/recovery is reflected promptly. This does not enable address scanning. */
  private static readonly DEBUG_DISABLED_POLL_INTERVAL_MS = 750;
  private static readonly STOCK_MONITOR_POLL_INTERVAL_MS = 2_000;
  private static readonly RECOVERY_POLL_INTERVAL_MS = 750;
  private static readonly RETRY_POLL_INTERVAL_MS = 2_000;
  private lastRuntimeProbeAt = 0;
  private lastSettlingPollLogAt = 0;
  flasher: GnwFlasher | null = null;
  /** Reactive mirror of "the RAM util is loaded" — `flasher` itself is non-reactive, so the
   *  UI (LED/status) tracks this instead. Set when ensureStub boots it; cleared on disconnect. */
  utilLoaded = $state(false);
  info = $state<DeviceInfo | null>(null);
  /** When set, a confirmation modal is asking the user to load the RAM flash utility. */
  stubPrompt = $state<{ resolve: () => void; reject: (e: Error) => void } | null>(null);
  /** Confirmation gate for gnwmanager's cold-power-cycle payload backup on locked stock units. */
  lockedBackupPrompt = $state<{ resolve: () => void; reject: (e: Error) => void } | null>(null);
  /** After an internal-read failure, let the user restore stock or leave the temporary payload for a later retry. */
  lockedBackupFailurePrompt = $state<{
    error: string;
    nextSwdClockHz: number;
    resolve: (choice: "retry" | "restore" | "stop") => void;
  } | null>(null);
  /** The probe is attached, but target debug reads are unavailable until Recovery Mode boots. */
  debuggingDisabled = $state(false);

  /** Set while `UnlockConfirmModal` is asking whether to unlock a device with no backup.
   *  Store-level singleton for the same reason `stubPrompt` is: it is rendered at the App
   *  root, so no unrelated `{#if}` elsewhere in the tree can unmount it mid-question. */
  unlockPrompt = $state<{ resolve: () => void; reject: (e: Error) => void } | null>(null);

  // Flash scan (docs/ARCHITECTURE.md "Device Scan & Classification") — populated on connect, non-blocking; re-run
  // after any big change.
  libraryScanStartupPending = $state(false);
  scanning = $state(false);
  scanProgress = $state(0); // 0..1
  scanError = $state<string | null>(null);
  partitions = $state<ExtPartition[]>([]);
  banks = $state<IntflashBank[]>([]);
  deviceClass = $state<DeviceClass | null>(null);
  /** Exact GnWManager ITCM signature match used as a stock model hint when protected
   *  internal flash cannot be classified. Full bank classification remains authoritative
   *  whenever it can identify stock or patched OFW. */
  itcmOfwModel = $state<Model>("unknown");
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
  /** True after the current flash-mode core inventory scan settles, even if LittleFS was corrupt. */
  coreInventoryReady = $state(false);
  /** True when that scan failed, so an unreadable inventory is not mistaken for an empty one. */
  coreInventoryFailed = $state(false);
  /** Paths seen on the selected SD card during its last scan (covers included). */
  sdInstalledPaths = $state<Set<string>>(new Set());
  /** Distinguishes a completed scan of an empty card from a card that has not been scanned. */
  sdInstalledPathsReady = $state(false);
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
  private _extflashGeometryScanned = false;
  private _extflashGeometrySize = 0;
  private _quickScanReady = false;
  private _useQuickBanks = false;
  /** Skip re-scanning intflash banks in _doScan() if the last scan is still this fresh. */
  private static readonly BANK_RESCAN_SKIP_WINDOW_MS = 90_000;
  /** Wall-clock time the last device scan succeeded — 0 = never this connection. Used to gate
   *  startup reuse and pollTick()'s passive "discovered the util
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
    this._manageDeviceStartup = null;
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
  get canCaptureScreenshot(): boolean { return this.isConnected && !this.stockMonitorMode; }
  get canReadDeviceLog(): boolean {
    return this.isConnected && this.retroGoRunning && !this.stockMonitorMode &&
      this.pollSuspendDepth === 0 && this._stubBootDepth === 0 && !deviceSafety.unsafe;
  }
  noteBankStarted(bank: 1 | 2): void {
    this.utilLoaded = false;
    this.runtimeBank = bank;
    const record = this.banks.find((b) => b.index === bank);
    this.runtimeKind = record?.retroGoVersion ? "retro-go" : record?.ofw ? "stock-ofw" : "unknown";
  }
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

  get isTargetUnresponsive(): boolean {
    return this.targetUnresponsive;
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

  private _manageStartupSeq = 0;
  private _manageStartupTrace: { id: string; startedAt: number } | null = null;
  private _manageStartupSawActiveLip = false;
  private _manageStartupDeviceDone = false;
  private startupTrace(phase: string, detail = ""): void {
    const trace = this._manageStartupTrace;
    if (!trace) return;
    const elapsed = Math.round(performance.now() - trace.startedAt);
    dbg(`[startup ${trace.id} +${elapsed}ms] ${phase}${detail ? ` ${detail}` : ""}`);
  }

  /** Called by the app shell when the shared top progress lip changes. Diagnostic only. */
  observeManageStartupLip(active: boolean): void {
    if (!this._manageStartupTrace) return;
    if (active) {
      this._manageStartupSawActiveLip = true;
    } else if (this._manageStartupSawActiveLip && this._manageStartupDeviceDone) {
      this.startupTrace("UI-lip-idle");
      this._manageStartupTrace = null;
      this._manageStartupSawActiveLip = false;
      this._manageStartupDeviceDone = false;
    }
  }

  private markManageStartupDeviceDone(startupId?: string, detail = "", succeeded = true): void {
    if (!startupId || this._manageStartupTrace?.id !== startupId || this._manageStartupDeviceDone) return;
    this._manageStartupDeviceDone = true;
    this.startupTrace(succeeded ? "device-inventory-ready" : "device-scan-failed", detail);
    this.observeManageStartupLip(lipProgress.active);
  }

  /** Internal-flash reads are allowed only when RDP is confirmed clear. */
  private intflashScanIsSafe(): boolean {
    // Locked flash remains unreadable even with the RAM utility running. Do not infer
    // protection from an ITCM pattern; the RDP option byte is the authority.
    if (this.locked !== false) return false;
    return true;
  }

  /** Attach to a probe; recoveryOnly skips target reads for stock firmware with SWD disabled. */
  connect(log?: (m: string) => void, opts?: { forcePicker?: boolean; reconnect?: boolean; swdClockHz?: number; recoveryOnly?: boolean; backgroundRetry?: boolean }): Promise<void> {
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
    // An explicit Connect must recover a stale SWD session. Reusing its liveness poll can
    // return immediately forever when a target disconnect left the serial queue busy.
    // Silent background connects already skip live probe handles in connectSilent().
    if (this.targetUnresponsive && this.probe && !opts?.forcePicker) {
      opts = { ...opts, reconnect: true };
    }
    // An explicit connect() call re-enables auto-retry (a manual disconnect suppresses it
    // until the user reconnects by hand — this is that reconnect).
    this._suppressAutoRetry = false;
    // A reconnect FROM "lost" reuses its last-known scan (general principle: never
    // speculatively blank a field — only a positive scan result changes one). Only a truly
    // fresh connect (from "disconnected") clears to "unknown / not scanned".
    const wasLost = this.connection === "lost";
    const previousConnection = this.connection;
    this.error = null;
    if (!opts?.forcePicker) this.connection = "connecting";
    if (!wasLost) this.clearInfo();

    this._connectPromise = (async () => {
      try {
        let selectedDevice: USBDevice | undefined;
        if (opts?.forcePicker) {
          selectedDevice = await chooseProbe();
          this.selectedAdapter = selectedDevice;
          if (this.probe) await this._teardownConnection();
          this.connection = "connecting";
        } else if (opts?.reconnect && this.probe) {
          selectedDevice = this.selectedAdapter ?? this.probe.device;
          await this._teardownConnection();
          this.connection = "connecting";
        }
        if (!selectedDevice && !this.selectedAdapter) {
          const known = await getKnownProbes();
          selectedDevice = known.length === 1 ? known[0] : await chooseProbe();
        }
        if (selectedDevice) {
          this.selectedAdapter = selectedDevice;
          this.probeName = selectedDevice.productName || "CMSIS-DAP";
        }
        // Attach (no halt/reset/stub boot — that's what hung past attempts). Then a SINGLE
        // safe mailbox RAM read to detect an already-running RAM util, raced against a short
        // timeout so a stalled read can never hang us. If the util's up, reuse it (no re-boot,
        // no modal) and scan; otherwise attach only and load it on demand via ensureStub().
        this.probe = await connectProbe({
          forcePicker: false,
          device: selectedDevice ?? this.selectedAdapter ?? undefined,
          swdClockHz: opts?.swdClockHz ?? this.adapterFrequencyHz,
        });
        this.selectedAdapter = this.probe.device;
        this.adapterAvailable = true;
        this.probeName = this.probe.probeName;
        navigator.usb.addEventListener("disconnect", this.onUsbDisconnect);
        this.transport = serialTransport(this.probe.transport);
        this.startupTrace("probe-attached", `adapter=${this.probeName ?? "unknown"}`);
        this.stockMonitorMode = false;
      // A reattached probe may now see a different image after a power cycle. Force new
      // first-wave lock/variant reads and refresh runtime/version state on every attach.
        this._banksScannedAt = 0;
        const transport = this.transport;
        if (opts?.recoveryOnly) {
          // Stock firmware can disable debug reads while still allowing the adapter to
          // reset the target and load our RAM utility. Do not probe its mailbox or memory
          // first: those reads fail (or can stall) and leave the user unable to start recovery.
          this.flasher = null;
          this.utilLoaded = false;
          this.debuggingDisabled = true;
          this.everConnected = true;
          this.connection = "attention";
          return;
        }
        // These two reads are the first-wave probes: variant from ITCM, protection from the
        // read-only option status register. Neither reads internal flash or halts the core.
        await this.refreshItcmOfwHint(transport);
        const rdpLocked = await readRdpLocked(transport);
        this.locked = rdpLocked;
        dbg(`[connect] RDP status ${rdpLocked === null ? "unavailable" : rdpLocked ? "locked" : "unlocked"}`);

        // Always check the SRAM mailbox before treating an ITCM signature as stock. A live
        // Recovery utility may be running over that still-readable stock ITCM image.
        const utilProbeStartedAt = performance.now();
        this.startupTrace("recovery-mailbox-probe-start");
        const mailboxReadStartedAt = performance.now();
        const utilUp = await Promise.race([
          isStubAlive(transport).then((alive) => {
            this.startupTrace("recovery-mailbox-status-read-done", `alive=${alive} elapsed=${Math.round(performance.now() - mailboxReadStartedAt)}ms`);
            return alive;
          }),
          new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 800)),
        ]);
        if (utilUp) {
          this.flasher = attachFlasher(transport);
          this.utilLoaded = true;
          // Tier 0 (RAM-safe): `locked` comes off the info struct. `extSizeMB` needs the stub
          // too (Tier 2), so it's fine to read both here — the stub is confirmed alive.
          this.info = await readInfo(this.flasher, log, {
            locked: rdpLocked,
            // Recovery Mode marks IDLE before the utility finishes drawing its splash and
            // publishes flash_size. Do one read here; the intflash probe gives that setup
            // work time to finish, then we refresh the value once before scanning extflash.
            flashSizeTimeoutMs: 0,
            onTiming: (phase, elapsedMs, detail) => this.startupTrace(
              `recovery-info-${phase}`,
              `elapsed=${Math.round(elapsedMs)}ms${detail ? ` ${detail}` : ""}`,
            ),
          });
          if (rdpLocked === null) this.locked = this.info.locked;
          this.extSizeMB = this.info.externalFlashSizeMiB;
        } else {
          this.flasher = null;
          this.utilLoaded = false;
        }
        this.startupTrace("recovery-mailbox-probe-done", `recovery=${utilUp} elapsed=${Math.round(performance.now() - utilProbeStartedAt)}ms`);

        if (rdpLocked === true && !utilUp) {
          // Locked flash cannot be scanned. The mailbox check proved no utility was alive, so
          // start one immediately without showing a second confirmation prompt.
          await this.ensureStub(undefined, false, true);
          this.enterRecoveryMode();
          this.startPoll(DeviceStore.RECOVERY_POLL_INTERVAL_MS);
          void this.runScan("locked Recovery Mode", { auto: true, startupId: this._manageStartupTrace?.id }).catch((e) =>
            dbg(`[scan] locked Recovery Mode background scan failed: ${e instanceof Error ? e.message : String(e)}`),
          );
          return;
        }

        if (utilUp) {
          this.enterRecoveryMode();
          this.startPoll(DeviceStore.RECOVERY_POLL_INTERVAL_MS);
          void this.runScan("Recovery Mode", { auto: true, startupId: this._manageStartupTrace?.id }).catch((e) =>
            dbg(`[scan] Recovery Mode background scan failed: ${e instanceof Error ? e.message : String(e)}`),
          );
          return;
        }

        this.everConnected = true;
        this.connection = "connected";
        this.debuggingDisabled = false;
        // Do not gate the adapter handshake on a target ping here. A preceding mailbox
        // probe may still be queued after its timeout; pingTarget would then wait behind it
        // and falsely time out. The regular poll checks only when the transport is idle.
        this.lastTargetAnswerAt = Date.now();
        // Second wave begins with non-halting VTOR only. Unlocked stock stays on this
        // lightweight path; Retro-Go/unknown can proceed to vector, bank and PC diagnostics.
        this.startupTrace("quick-runtime-probe-start", "phase=vtor");
        await this.quickRuntimeProbe(transport, { allowIntflash: false });
        this.startupTrace("quick-runtime-probe-done", `runtime=${this.runtimeKind}`);
        const vtorBank = this.runtimeBank;
        // ITCM's positive stock signature plus VTOR anywhere in bank 1 is stronger evidence
        // than the generic bootloader subrange classification. Keep stock polling on the
        // low-risk ITCM+VTOR path instead of falling through to disabled-debug retry polling.
        if (this.itcmOfwModel !== "unknown" && vtorBank === 1) {
          this.runtimeKind = "stock-ofw";
        }
        if (this.runtimeKind === "stock-ofw") {
          this.enterStockMonitor(
            this.itcmOfwModel === "unknown" ? this.model : this.itcmOfwModel,
            rdpLocked,
          );
          return;
        }
        const intflashSafe = rdpLocked === false;
        if (intflashSafe && this.runtimeKind !== "stock-ofw") {
          await this.quickRuntimeProbe(transport, { allowIntflash: true });
        }
        const infoAfterFastRead = this.info;
        if (this.flasher && infoAfterFastRead?.externalFlashSizeBytes === 0) {
          const sizeStartedAt = performance.now();
          const flashSize = await this.flasher.externalFlashSize(0, (attempts, value, elapsedMs, timedOut) => {
            this.startupTrace("flash-size-refresh-after-runtime-probe", `attempts=${attempts} bytes=${value} timedOut=${timedOut} elapsed=${Math.round(elapsedMs)}ms`);
          });
          this.info = {
            ...infoAfterFastRead,
            externalFlashSizeBytes: flashSize,
            externalFlashSizeMiB: flashSize / (1 << 20),
          };
          this.extSizeMB = this.info.externalFlashSizeMiB;
          this.startupTrace("flash-size-refresh-done", `bytes=${flashSize} elapsed=${Math.round(performance.now() - sizeStartedAt)}ms`);
        }
        const targetResponding = await raceWithFallback(pingTarget(transport), 300, false);
        if (!targetResponding) {
          // The adapter is attached and can still reset/load the RAM utility, even when
          // stock firmware refuses normal debug transactions. Keep this actionable as a
          // recovery state instead of turning it into a lost-device wait screen.
          this.connection = "attention";
          this.debuggingDisabled = !this.utilLoaded;
          this.targetUnresponsive = false;
          this.error = null;
          // Keep checking at a low rate. A failed initial ping can mean standby or a
          // temporarily unavailable debug port; it is not proof that the adapter is gone.
          this.startPoll(this.debuggingDisabled
            ? DeviceStore.DEBUG_DISABLED_POLL_INTERVAL_MS
            : DeviceStore.RETRY_POLL_INTERVAL_MS);
          return;
        }
        this.lastTargetAnswerAt = Date.now();
        this.debuggingDisabled = false;
        this.startPoll();
        // A reconnect can land mid-install (a stub boot re-enumerates the probe by design).
        // A live stub normally means a deliberate Recovery Mode scan, except while an operation
        // owns the link: that scan must wait/drop like every other automatic scan, or it can
        // overwrite the operation's mailbox context. A rejected background scan is already
        // recorded by _doScan in the audit log; consume the rejection here so it cannot escape
        // as a separate unhandled browser error.
        void this.runScan("connect", { auto: true, startupId: this._manageStartupTrace?.id }).catch((e) =>
          dbg(`[scan] connect background scan failed: ${e instanceof Error ? e.message : String(e)}`),
        );
      } catch (e) {
        this.error = e instanceof Error ? e.message : String(e);
        // INTO THE LOG TOO. `this.error` is write-only (no component reads it), and every
        // caller of connect() swallows the rethrow, so without this a failed connect left no
        // trace anywhere the user or a bug report could reach. A dismissed chooser is not a
        // failure and goes to the debug channel instead, where it costs nothing and cannot
        // ring the bell.
        if (isPickerDismissal(e)) dbg(`[connect] the device chooser was dismissed`);
        else {
          // A probe can remain enumerated while the console is powered off. The first
          // transaction then reports "Transfer count mismatch"; that is an expected
          // unavailable-device state, not failed work and must not raise an error notification.
          const unavailable = /Transfer count mismatch/i.test(this.error);
          const expectedLockedBackupPowerCycle = unavailable &&
            this.lockedBackupPrompt !== null && this.powerCycleReconnectMode;
          if (expectedLockedBackupPowerCycle || (unavailable && opts?.backgroundRetry)) {
            // The adapter stays connected while the user removes console power. Reattach
            // attempts during this prompt are expected to fail until the blue screen returns;
            // recording each retry as a warning currently raises a notification per attempt.
            dbg(opts?.backgroundRetry
              ? "[connect] target unavailable during automatic reconnect"
              : "[connect] expected target disconnect during locked-backup power-cycle");
          } else {
            auditLog.add(unavailable ? "warning" : "error", "device", msg((t) => t.shared.auditLog.connectFailed, this.error));
          }
        }
        // Plain teardown — NOT the public disconnect(): a failed connect attempt (bad probe,
        // WebUSB error) is not a "manual disconnect" and must not suppress auto-retry for a
        // caller (e.g. the reconnect loop below) that's about to try again.
        const pickerCancelledWithLiveHandle = isPickerDismissal(e) && opts?.forcePicker && this.probe;
        if (pickerCancelledWithLiveHandle) this.connection = previousConnection;
        else {
          const adapterResponded = this.probe !== null || /Transfer count mismatch|Transfer response (?:FAULT|WAIT|NO_ACK)/i.test(this.error);
          await this._teardownConnection();
          const known = await getKnownProbes();
          this.adapterAvailable = adapterResponded && this.selectedAdapter !== null && known.includes(this.selectedAdapter);
          this.targetUnresponsive = this.adapterAvailable;
          this.connection = this.adapterAvailable || wasLost ? "lost" : "disconnected";
          // Startup can fail before a live transport exists. The selected programmer still
          // needs target retries when the console is plugged in later.
          if (!isPickerDismissal(e) && this.selectedAdapter) this.scheduleTargetReconnect();
        }
        throw e;
      } finally {
        this._connectPromise = null;
      }
    })();
    return this._connectPromise;
  }

  /** Authorize a probe without attempting to connect to the console. */
  async chooseAdapter(): Promise<void> {
    const selected = await chooseProbe();
    this.selectedAdapter = selected;
    this.probeName = selected.productName || "CMSIS-DAP";
    this.adapterAvailable = true;
    this._suppressAutoRetry = false;
    if (!this.isConnected) this.scheduleTargetReconnect();
  }

  /** Look for the selected, authorized adapter without opening a chooser. */
  startAdapterPoll(): void {
    if (this.adapterPollTimer) return;
    this.adapterPollTimer = setInterval(() => {
      if (this.adapterPollBusy || this.probe || this.isConnected || this.connection === "connecting") return;
      this.adapterPollBusy = true;
      void getKnownProbes().then((known) => {
        if (this.probe || this.isConnected || known.length === 0) return;
        const probe = this.selectedAdapter && known.includes(this.selectedAdapter)
          ? this.selectedAdapter
          : known.length === 1 ? known[0] : null;
        if (!probe) return;
        this.selectedAdapter = probe;
        return this.connectSilent();
      }).catch(() => {}).finally(() => { this.adapterPollBusy = false; });
    }, 1000);
  }

  private async quickRuntimeProbe(
    transport: typeof this.transport,
    options: { allowIntflash?: boolean } = {},
  ): Promise<void> {
    if (!transport) return;
    const t0 = Date.now();
    const startupT0 = performance.now();
    this.startupTrace("runtime-probe-start", `intflash=${options.allowIntflash ? "allowed" : "deferred"}`);
    dbg(`[quickscan] start`);
    try {
      if (!options.allowIntflash) {
        const runtime = await detectRuntime(transport, this.banks, { pcFallback: false });
        let kind = runtime.kind;
        let bank = runtime.bank;
        if (runtime.vtor !== null &&
            runtime.vtor >= 0x08000000 && runtime.vtor < 0x08100000 &&
            this.itcmOfwModel !== "unknown") {
          kind = "stock-ofw";
          bank = 1;
        }
        if (kind !== "unknown") {
          this.runtimeKind = kind;
          this.runtimeBank = bank;
        }
        dbg(`[quickscan] VTOR=0x${runtime.vtor?.toString(16) ?? "unreadable"}; runtime=${kind} ${Date.now() - t0}ms`);
        this.startupTrace("runtime-probe-done", `elapsed=${Math.round(performance.now() - startupT0)}ms intflash=deferred runtime=${kind}`);
        return;
      }
      const quickBanks: IntflashBank[] = [];
      const vectorPcs: number[] = [];
      for (let i = 0; i < 2; i++) {
        const base = INT_BANK_BASES[i];
        const head = await transport.readMemory(base, 8);
        const sp = new DataView(head.buffer, head.byteOffset, head.byteLength).getUint32(0, true);
        const pc = new DataView(head.buffer, head.byteOffset, head.byteLength).getUint32(4, true);
        vectorPcs.push(pc);
        const model = sp === 0x20011330 ? "mario" : sp === 0x2001b620 ? "zelda" : null;
        dbg(`[quickscan] bank${i + 1} vector sp=${sp.toString(16)} pc=${pc.toString(16)} model=${model ?? "unknown"} ${Date.now() - t0}ms`);
        const erased = sp === 0xffffffff && pc === 0xffffffff;
        let patched = true;
        if (model) {
          try {
            const marker = await transport.readMemory(base + (128 << 10) - 4, 4);
            patched = marker[3] !== 0xff;
            dbg(`[quickscan] bank${i + 1} marker ${Date.now() - t0}ms`);
          } catch {
            // Keep the conservative patched/unknown result; the full scan is authoritative.
          }
        }
        quickBanks.push({
          index: (i + 1) as 1 | 2,
          base,
          // The quick pass deliberately does not measure occupancy. Keep the geometry
          // visualization stable at the known bank capacity until a full scan replaces it.
          dataSize: erased ? 0 : 256 << 10,
          type: erased ? "empty" : model ? `${model === "mario" ? "Mario" : "Zelda"} OFW (${patched ? "patched" : "stock"})` : "unknown data",
          ofw: model ? { model, patched } : undefined,
        });
      }
      if (!quickBanks.some((bank) => bank.ofw)) await this.refreshItcmOfwHint(transport);
      // VTOR was already checked in the low-cost first pass. Reset vectors refine which
      // unlocked flash bank contains an image before the full geometry scan.
      this.banks = quickBanks;
      this._quickScanReady = quickBanks.every((bank) =>
        bank.dataSize === 0 || !!bank.ofw || bank.type === "Retro-Go",
      );
      // Publish the bank/header classification immediately; the later full scan may add
      // geometry and partitions, but the status header should not wait for those.
      this.deviceClass = classifyDevice(this.info, this.banks, this.partitions);
      if (this.deviceClass.ofw) this.model = this.deviceClass.ofw.model;
      {
        // Use the reset vectors to choose a likely Retro-Go bank for the compact version read.
        const vectorBankIndex = vectorPcs.findIndex((pc, i) =>
          pc >= INT_BANK_BASES[i] && pc < INT_BANK_BASES[i] + 0x100000 &&
          !quickBanks[i].ofw,
        ) + 1;
        if (vectorBankIndex) {
          const bank = quickBanks[vectorBankIndex - 1];
          const versionProbe = await this.readRetroGoVersionWindow(
            transport,
            INT_BANK_BASES[vectorBankIndex - 1] + 0x30000,
          );
          let retroGo = versionProbe.info;
          dbg(`[quickscan] bank${vectorBankIndex} version window read ${versionProbe.bytesRead} B ${Date.now() - t0}ms`);
          if (!retroGo.present) {
            dbg(`[quickscan] vector bank=${vectorBankIndex} Retro-Go tag not found in the 32 KiB fast probe`);
          }
          if (retroGo.present) {
            quickBanks[vectorBankIndex - 1] = {
              ...bank,
              retroGoVersion: retroGo.version,
              retroGoIsSdFork: retroGo.isSdFork,
              type: "Retro-Go",
            };
            // `quickBanks` is the pre-proxy local array. Publish a fresh snapshot after
            // refining its classification so Svelte state and the subsequent device scan
            // both observe the Retro-Go marker and version.
            this.banks = [...quickBanks];
            this._quickScanReady = quickBanks.every((item) =>
              item.dataSize === 0 || !!item.ofw || item.type === "Retro-Go",
            );
            this.deviceClass = classifyDevice(this.info, this.banks, this.partitions);
            if (this.deviceClass.ofw) this.model = this.deviceClass.ofw.model;
            dbg(`[quickscan] vector bank=${vectorBankIndex} Retro-Go version=${retroGo.version ?? "unversioned"} ${Date.now() - t0}ms`);
          } else {
            dbg(`[quickscan] vector bank=${vectorBankIndex} Retro-Go marker not found in 32 KiB window`);
          }
        }
        const runtimeStartedAt = performance.now();
        const runtime = await detectRuntime(transport, quickBanks);
        this.startupTrace("runtime-address-classification-done", `elapsed=${Math.round(performance.now() - runtimeStartedAt)}ms`);
        dbg(`[quickscan] runtime VTOR=0x${runtime.vtor?.toString(16) ?? "unreadable"} pc=${runtime.pc?.toString(16) ?? "unreadable"} kind=${runtime.kind}`);
        if (runtime.kind !== "unknown") {
          this.runtimeKind = runtime.kind;
          this.runtimeBank = runtime.bank;
        }
        dbg(`[quickscan] VTOR/PC runtime probe complete (${Date.now() - t0}ms)`);
        return;
      }
    } catch {
      // A protected stock device can reject the bank-vector read before the fast probe has
      // anything to classify. GnWManager's ITCM signature is independently readable here.
      await this.refreshItcmOfwHint(transport);
      // This is a best-effort hint; the full scan remains authoritative.
      dbg(`[quickscan] failed ${Date.now() - t0}ms`);
      this.startupTrace("runtime-probe-failed", `elapsed=${Math.round(performance.now() - startupT0)}ms`);
    }
  }

  /** Read the complete 32 KiB GIT_TAG window in one bulk transport request. */
  private async readRetroGoVersionWindow(
    transport: NonNullable<typeof this.transport>,
    address: number,
  ): Promise<{ info: ReturnType<typeof retroGoInfo>; bytesRead: number }> {
    const bytesRead = 32 << 10;
    const readStartedAt = performance.now();
    const data = await transport.readMemory(address, bytesRead, undefined, true, bytesRead);
    this.startupTrace("intflash-version-window-read", `address=0x${address.toString(16)} bytes=${bytesRead} elapsed=${Math.round(performance.now() - readStartedAt)}ms`);
    const parseStartedAt = performance.now();
    const info = retroGoInfo(data);
    this.startupTrace("intflash-version-window-parse", `bytes=${data.byteLength} elapsed=${Math.round(performance.now() - parseStartedAt)}ms present=${info.present} version=${info.version ?? "unknown"}`);
    return { info, bytesRead };
  }

  private async refreshItcmOfwHint(
    transport: NonNullable<typeof this.transport>,
  ): Promise<{ model: "mario" | "zelda" | null; readable: boolean; cleared: boolean }> {
    const previousModel = this.itcmOfwModel;
    try {
      const result = await probeModelFromItcm(transport);
      this.itcmOfwModel = result.model ?? "unknown";
      if (result.model) {
        this.model = result.model;
        dbg(`[quickscan] GnWManager ITCM signature identifies ${result.model} stock firmware`);
      } else if (previousModel !== "unknown" && !this.deviceClass?.ofw && this.model === previousModel) {
        this.model = "unknown";
      }
      return result;
    } catch (error) {
      dbg(`[quickscan] ITCM signature probe unavailable: ${error instanceof Error ? error.message : String(error)}`);
      return { model: null, readable: false, cleared: false };
    }
  }

  /** First-wave liveness evidence: a recognizable/active ITCM image or a VTOR in MCU
   *  executable memory. A successful read of zero/erased bus data by itself is not enough. */
  private hasPassiveTargetEvidence(
    itcm: { model: "mario" | "zelda" | null; readable: boolean; cleared: boolean },
    vtor: number | null,
  ): boolean {
    if (itcm.model || (itcm.readable && !itcm.cleared)) return true;
    if (vtor === null || vtor === 0 || vtor === 0xffffffff) return false;
    return (vtor >= 0x08000000 && vtor < 0x08200000) ||
      (vtor >= 0x20000000 && vtor < 0x30000000);
  }

  /** Keep passive bulk reads bounded too: a disconnected target may leave a read pending
   *  behind the adapter. The still-busy transport is observed by the normal silence timer. */
  private async probePassiveTarget(
    transport: NonNullable<typeof this.transport>,
  ): Promise<{ itcm: { model: "mario" | "zelda" | null; readable: boolean; cleared: boolean }; runtime: RuntimeState } | null> {
    return raceWithFallback((async () => ({
      itcm: await this.refreshItcmOfwHint(transport),
      runtime: await detectRuntime(transport, this.banks, { pcFallback: false }),
    }))(), 800, null);
  }

  private enterStockMonitor(model: Model, rdpLocked: boolean | null): void {
    this.stockMonitorMode = true;
    this.runtimeKind = "stock-ofw";
    this.runtimeBank = 1;
    if (model !== "unknown") this.model = model;
    this.retroGoActivity = null;
    this.flasher = null;
    this.utilLoaded = false;
    this.locked = rdpLocked;
    this.debuggingDisabled = rdpLocked !== false;
    this.targetUnresponsive = false;
    this.error = null;
    this.everConnected = true;
    this.connection = rdpLocked === false ? "connected" : "attention";
    this.lastTargetAnswerAt = Date.now();
    this.lastItcmRuntimeCheckAt = Date.now();
    dbg(`[connect] stock${model === "unknown" ? "" : ` (${model})`}; RDP=${rdpLocked === false ? "unlocked" : "unknown"}; monitoring ITCM + VTOR`);
    this.startPoll(DeviceStore.STOCK_MONITOR_POLL_INTERVAL_MS);
  }

  private enterRecoveryMode(): void {
    this.stockMonitorMode = false;
    this.runtimeKind = "recovery";
    this.runtimeBank = null;
    this.utilLoaded = true;
    this.debuggingDisabled = false;
    this.targetUnresponsive = false;
    this.error = null;
    this.everConnected = true;
    this.connection = "connected";
    this.lastTargetAnswerAt = Date.now();
    dbg("[connect] Recovery utility active; synchronizing with its existing mailbox");
  }

  /** Refresh only the live-bank/version hint; callers entering device management use this
   * before the slower full geometry scan is explicitly requested. */
  async refreshRuntimeHint(): Promise<void> {
    if (this.transport) {
      const safe = this.intflashScanIsSafe();
      await this.quickRuntimeProbe(this.transport, { allowIntflash: safe });
    }
  }

  /** Silently attach to a probe ONLY if exactly one trusted adapter is already authorized.
   *  Never shows a USB picker. Safe to call fire-and-forget on navigation or USB reconnect. */
  async connectSilent(): Promise<void> {
    if (this.probe) return;
    if (this.connection !== "disconnected" && this.connection !== "lost") return;
    if (this._suppressAutoRetry) return; // manual disconnect — user must reconnect explicitly
    try {
      const known = await getKnownProbes();
      if (known.length === 0) return;
      if (known.length !== 1 && (!this.selectedAdapter || !known.includes(this.selectedAdapter))) return;
      // Re-check the guard AFTER the await. This is the second half of the "adapter reconnects
      // two or three times" report: the USB `connect` event fires connectSilent() at the same
      // moment handleLost()'s reconnectLoop is retrying. connectSilent passed its guard while
      // the link was still "lost", then getKnownProbes() awaited long enough for the loop to
      // finish attaching — so without this it would attach a SECOND time on top of a healthy
      // session (a second `DEVICE:` line, a second probe handle).
      if (this.probe || this.connection !== "disconnected" && this.connection !== "lost") return;
      if (this._suppressAutoRetry) return;
      this.selectedAdapter = this.selectedAdapter && known.includes(this.selectedAdapter)
        ? this.selectedAdapter : known[0];
      this.probeName = this.selectedAdapter.productName || "CMSIS-DAP";
      this.adapterAvailable = true;
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
  async ensureStub(log?: (m: string) => void, forceReboot = false, silent = false, allowReboot = true): Promise<GnwFlasher> {
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
      return await this._ensureStubInner(log, forceReboot, silent, allowReboot);
    } finally {
      this.resumePoll();
    }
  }

  private async _ensureStubInner(log?: (m: string) => void, forceReboot = false, silent = false, allowReboot = true): Promise<GnwFlasher> {
    if (!this.probe || !this.transport) throw new Error("Not connected.");
    // Reuse the cached stub ONLY if it's alive AND has a free context. A wedged stub (after a failed
    // flash), dirty contexts, or a power-cycled device → re-boot a clean stub (clears contexts +
    // resets the context counter), otherwise the next flash hangs forever in getContext.
    let reboot = forceReboot;
    if (this.flasher && !forceReboot) {
      const cachedFlasher = this.flasher;
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
        cachedFlasher.transport === this.transport && this.probe.device.opened !== false;
      if (!sameHandle) {
        dbg("[ensureStub] cached flasher holds a superseded transport -> re-booting a fresh stub");
      }
      const alive = sameHandle && await this.stubAlive();
      if (alive && !cachedFlasher.hasSynchronizedContextCounter) {
        try {
          const counter = await cachedFlasher.synchronizeContextCounter();
          dbg(`[ensureStub] synchronized attached flasher context counter=${counter}; keeping live stub`);
        } catch (error) {
          dbg(`[ensureStub] could not synchronize live flasher context counter: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      if (alive && cachedFlasher.hasSynchronizedContextCounter && (await this.contextsFree())) {
        dbg("[ensureStub] reusing cached flasher (alive + context synchronized + free)");
        return cachedFlasher;
      }
      if (alive && !cachedFlasher.hasSynchronizedContextCounter) {
        dbg("[ensureStub] attached flasher could not be synchronized; rebooting for recovery");
      } else {
        dbg("[ensureStub] cached stub unusable (dead or wedged contexts) → re-booting a fresh stub");
      }
      reboot = true;
      this.flasher = null;
      this.utilLoaded = false;
    }
    if (reboot && !allowReboot) {
      throw new Error("Recovery stub is unavailable; restart Recovery Mode before flashing.");
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
      // A failed RAM write must never leave the previous session's utility state
      // visible. Otherwise the header continues to claim Recovery Mode while the
      // target is actually running unknown code or is unreachable.
      this.flasher = null;
      this.utilLoaded = false;
      this.runtimeKind = "unknown";
      this.runtimeBank = null;
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
    this.locked = await readRdpLocked(this.transport);
    this.info = await readInfo(this.flasher, dbgLog("stub", log), { locked: this.locked });
    this.locked = this.info.locked;
    this.extSizeMB = this.info.externalFlashSizeMiB;
    this.connection = "connected";
    this.debuggingDisabled = false;
    this.targetUnresponsive = false;
    this.error = null;
    // A reboot invalidates any "banks already scanned this connection" freshness — force a
    // real re-scan of intflash on the next runScan() rather than trusting cached banks.
    this._banksScannedAt = 0;
    // THE DEVICE HAS ATTESTED. `readInfo` above is a completed exchange with no write in
    // flight -- the same class of evidence the liveness poll's ping provides, which is the only
    // other thing that clears the internal post-write settling gate.
    //
    // Without this the settling gate outlives the operation by however long the NEXT thing on the
    // link takes, because `pollTick` returns early while `transport.busy()` and so cannot
    // attest anything until the link is idle. Booting into Recovery Mode now rescans every
    // time, so settling lasted for the whole walk of the chip. A no-op when a hold is still
    // outstanding (`markQuiet` checks), so a boot nested inside an install cannot clear the
    // internal gate mid-flash.
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
    // Keep the liveness poll out of the gaps between recovery retries and the final rescan.
    // ensureStub also suspends it around each individual boot; this outer hold is nested.
    this.suspendPoll();
    try {
      // A probe can report as connected after its WebUSB handle has been closed by a prior
      // re-enumeration. That is exactly the failure Chrome reports as `transferOut ... must be
      // opened first`; retrying bootStub on the same transport can never work. Reattach the
      // authorized probe and retry automatically so a transient stale handle does not require
      // the user to press Start Recovery Mode several times.
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          // Let the standard StubLoadModal authorize the first reset. The user has already
          // confirmed this recovery operation, so automatic retries must not prompt again.
          await this.ensureStub(undefined, attempt > 1);
          break;
        } catch (e) {
          if (e instanceof StubLoadCancelled || attempt >= 3) throw e;
          dbg(`[recovery] stub boot attempt ${attempt}/3 failed: ${e instanceof Error ? e.message : String(e)}`);
          if (isDeadHandleError(e)) {
            await this._teardownConnection();
            this.connection = "connecting";
            await new Promise((resolve) => setTimeout(resolve, 250));
            // Reattach without target reads. On stock firmware those reads are exactly
            // what Recovery Mode is needed to bypass.
            await this.connect(undefined, { recoveryOnly: true });
            // _teardownConnection resets the suspension depth with the dead handle. Restore
            // this operation's outer hold before the next boot attempt.
            this.suspendPoll();
          } else {
            await new Promise((resolve) => setTimeout(resolve, 250));
          }
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
      this.resumePoll();
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

  /** Explicit Firmware-tab Connect: attach to the adapter without target reads, then boot
   *  and scan the RAM utility. This works when stock firmware has disabled SWD debug access. */
  async connectAndStartRecoveryMode(): Promise<void> {
    try {
      if (!this.probe || !this.transport || this.targetUnresponsive) {
        await this.connect(undefined, {
          reconnect: !!this.probe,
          recoveryOnly: true,
        });
      }
      await this.startRecoveryMode();
    } catch (e) {
      // Keep the retained adapter usable and represent this as an attached-but-unreadable
      // target so Firmware setup remains available for another explicit recovery attempt.
      if (this.probe && this.transport && !this.utilLoaded) {
        this.connection = "attention";
        this.debuggingDisabled = true;
      }
      throw e;
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
  async ensureUnlocked(silentRecovery = false): Promise<UnlockOutcome> {
    return runUnlockGate({
      locked: this.locked,
      backupTaken: this.backupTaken,
      confirmDestructive: () =>
        new Promise<void>((resolve, reject) => {
          this.unlockPrompt = { resolve, reject };
        }),
      unlock: async () => {
        const flasher = await this.ensureStub(undefined, false, silentRecovery);
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

  confirmLockedBackupPowerCycle(): void {
    const p = this.lockedBackupPrompt;
    this.lockedBackupPrompt = null;
    this.powerCycleReconnectMode = false;
    p?.resolve();
  }

  cancelLockedBackupPowerCycle(): void {
    const p = this.lockedBackupPrompt;
    this.lockedBackupPrompt = null;
    this.powerCycleReconnectMode = false;
    p?.reject(new Error("Locked-device backup was cancelled."));
  }

  /** Use the shared liveness poll as soon as the user begins the cold power-cycle. */
  beginLockedBackupPowerCycleMonitoring(): void {
    if (!this.lockedBackupPrompt) return;
    this.powerCycleReconnectMode = true;
    this.targetPingStalled = false;
    this.lastTargetAnswerAt = Date.now();
  }

  /** Reopen the selected probe after an expected target-only power-cycle. USB stays
   *  connected, so no USB disconnect event replaces the stale WebStlink transport. */
  reconnectLockedBackupTarget(): Promise<void> {
    if (this.powerCycleReconnectPromise) return this.powerCycleReconnectPromise;
    // A failed attach tears down the stale probe and clears targetUnresponsive. Keep
    // retrying from the modal while the prompt is active even in that state; otherwise
    // the first failed reattach leaves the LED red forever with no handle to poll.
    if (!this.lockedBackupPrompt || (this.probe && this.transport && !this.targetUnresponsive)) return Promise.resolve();
    this.powerCycleReconnectMode = true;
    this.powerCycleReconnectPromise = (async () => {
      this.suspendPoll();
      try {
        await this.connect(undefined, { reconnect: true, recoveryOnly: true });
      } catch (error) {
        dbg(`[locked-backup] probe reattach failed: ${error instanceof Error ? error.message : String(error)}`);
      } finally {
        if (this.lockedBackupPrompt && this.powerCycleReconnectMode) {
          this.targetUnresponsive = true;
          this.connection = "lost";
          this.error = "Target is not responding. Waiting for it to wake up…";
        }
        this.resumePoll();
        if (this.transport) this.startPoll();
        this.powerCycleReconnectPromise = null;
      }
    })();
    return this.powerCycleReconnectPromise;
  }

  chooseLockedBackupFailure(choice: "retry" | "restore" | "stop"): void {
    const p = this.lockedBackupFailurePrompt;
    this.lockedBackupFailurePrompt = null;
    p?.resolve(choice);
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
  async runScan(reason = "unknown", opts: {
    auto?: boolean;
    forceGeometry?: boolean;
    forcePartitions?: boolean;
    fullGeometry?: boolean;
    startupId?: string;
  } = {}): Promise<void> {
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
    // A post-write refresh must run after any scan that began before the write.
    if ((opts.forceGeometry || opts.forcePartitions) && this._scanPromise) await this._scanPromise;
    if (opts.forcePartitions) this._extflashGeometryScanned = false;
    if (opts.forceGeometry) {
      this._extflashGeometryScanned = false;
      this._banksScannedAt = 0;
      this._useQuickBanks = false;
    }
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
    let scanSucceeded = false;
    if (opts.startupId) this.startupTrace("device-scan-start", `reason=${reason} scan=${seq}`);
    this._useQuickBanks = !!opts.auto && !opts.forceGeometry;
    this._scanPromise = (async () => {
      let mismatchRecoveryAttempts = 0;
      let adapterResetAttempted = false;
      for (let attempt = 1; ; attempt++) {
        try {
          return await this._doScan({
            fullGeometry: opts.fullGeometry,
            startupId: opts.startupId,
          });
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e);
          if (/Transfer count mismatch/i.test(message) && this.utilLoaded) {
            // A live Recovery Mode stub can survive this transport-level mismatch, but the
            // target is left with no usable screen and an indeterminate mailbox state. Re-send
            // the stub immediately; waiting for the generic retry timeout leaves the user staring
            // at a black screen and can make the next operation race the half-reset target.
            if (mismatchRecoveryAttempts < 2) {
              mismatchRecoveryAttempts++;
              dbg(
                `[scan] ${reason}: Transfer count mismatch; restarting Recovery Mode stub ` +
                  `(retry ${mismatchRecoveryAttempts}/2)`,
              );
              await this.ensureStub(undefined, true, true);
              continue;
            }

            // Two stub restarts did not recover the link. Reset the adapter session once, then
            // make one final recovery-mode attempt. If that fails, the original error is fatal
            // and is allowed to reach the caller.
            if (adapterResetAttempted) {
              dbg(`[scan] ${reason}: Transfer count mismatch persisted after adapter reset; failing`);
              throw e;
            }
            adapterResetAttempted = true;
            dbg(`[scan] ${reason}: stub retries exhausted; resetting adapter session`);
            await this._teardownConnection();
            this.connection = "lost";
            await this.connect();
            await this.ensureStub(undefined, true, true);
            dbg(`[scan] ${reason}: adapter session reset; final scan attempt`);
            continue;
          }
          if (attempt >= 2 || !/Transfer response FAULT/i.test(message)) throw e;
          dbg(`[scan] ${reason}: transient transfer error; retrying once`);
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
      }
    })();
    try {
      await this._scanPromise;
      this.lastTargetAnswerAt = Date.now();
      scanSucceeded = this.scanError === null;
    } finally {
      this._scanPromise = null;
      this._lastScanEndedAt = Date.now();
      if (scanSucceeded) this._lastFullScanAt = this._lastScanEndedAt;
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
      if (opts.startupId) {
        this.startupTrace("device-scan-settled", `reason=${reason} scan=${seq} elapsed=${Date.now() - t0}ms`);
        this.markManageStartupDeviceDone(opts.startupId, `reason=${reason} scan=${seq}`, scanSucceeded);
      }
    }
  }

  /** User-requested rescan: use the deepest scan that matches the currently running image. */
  async rescan(reason = "rescan"): Promise<void> {
    // Preserve the state before ensureStub(), since booting the stub would otherwise make a
    // normal Retro-Go session look like Recovery Mode and incorrectly promote this to a full
    // geometry walk.
    const stubWasRunning = this.utilLoaded;
    await this.ensureStub();
    await this.refreshRuntimeHint();
    await this.runScan(reason, { auto: !stubWasRunning });
  }

  /**
   * Refresh the FrogFS inventory from a known physical extflash offset.
   *
   * An install already knows the exact address it just wrote. Re-running partition discovery
   * only to find that new FrogFS wastes time and can reuse pre-write geometry that had no
   * FrogFS entry. Read the compact FrogFS head/hash table/file headers directly at the absolute
   * offset, then publish the same inventory fields as a normal scan.
   */
  async refreshInstalledFrogfsAt(offset: number): Promise<void> {
    const flasher = this.flasher;
    if (!flasher) throw new Error("Flash utility is not connected.");
    const res = await readInstalledFrogfs(
      (addr, len) => dumpRegion(flasher, 0, addr, len),
      offset,
    );
    if (res.binSize <= 0 || offset + res.binSize > this.extFlashBytes) {
      throw new Error(`FrogFS table at 0x${offset.toString(16)} has an invalid size (${res.binSize}).`);
    }

    this.installedFrogfs = res;
    this.installedGames = res.games;
    if (Object.hasOwn(this.fsStats, offset)) {
      const stats = { ...this.fsStats };
      delete stats[offset];
      this.fsStats = stats;
    }
    this.partitions = [
      ...this.partitions.filter((p) => p.fs !== "frogfs"),
      {
        offset,
        size: res.binSize,
        type: "FrogFS",
        fs: "frogfs",
        meta: { binSize: res.binSize },
      },
    ].sort((a, b) => a.offset - b.offset);
    dbg(`[scan] direct FrogFS table read @0x${offset.toString(16)}: ${res.files.length} files, ${res.games.length} games`);
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
  private async _doScan(opts: { fullGeometry?: boolean; startupId?: string } = {}): Promise<void> {
    if (!this.transport) return;
    const flasher = this.flasher;
    const transport = this.transport;
    const gen = ++this._gen; // supersede any in-flight background reads from a prior scan
    if (this.targetMedia !== "sd") {
      this.coreVersionCheck = null;
      this.coreInventoryReady = false;
      this.coreInventoryFailed = false;
    }
    this.scanning = true;
    this.scanProgress = 0;
    // CLAIM THE LIP for the whole scan, here, not at the first progress callback: until
    // something claims it every read is drawn as its own 0-to-100 sweep.
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
    // Extflash layout is first so the progress bar reflects the highest-priority device data
    // while the independent library scan runs. The weights approximate elapsed work, not bytes:
    // the stride walk dominates because it is the only phase whose cost scales with chip size.
    const W = { partitions: 0.68, banks: 0.16, games: 0.16 } as const;
    const before = { partitions: 0, banks: W.partitions, games: W.partitions + W.banks };
    /** "Everything before this phase, plus this much of it." Monotonic: the bar never goes back. */
    const phase = (name: keyof typeof W, fraction: number): void => {
      const next = before[name] + W[name] * Math.max(0, Math.min(1, fraction));
      if (next > this.scanProgress) this.scanProgress = next;
      lipProgress.operationProgress("scan", this.scanProgress);
    };
    this.scanError = null;
    try {
      // Prioritize extflash layout: the intflash bank classifier can take tens of seconds
      // when it has to read unknown banks in full. Delaying this stride walk behind that work
      // made the user wait until after library validation to see device scanning begin. These
      // operations share one SWD/mailbox transport, so run them sequentially in the order that
      // gets the FrogFS/LittleFS locations first while the independent library scan proceeds.
      const extSize = this.info?.externalFlashSizeBytes ?? 0;
      if (flasher) {
        this.lfsBlockCache.clear();
        this.lfsChunkHashes.clear();
        this.installedLfsTree = null;
        if (opts.fullGeometry || !this._extflashGeometryScanned || this._extflashGeometrySize !== extSize) {
          const geometryStartedAt = performance.now();
          if (opts.startupId) this.startupTrace(opts.fullGeometry ? "external-flash-full-scan-start" : "external-flash-targeted-scan-start", `size=${extSize}`);
      const readExtflash = counted(async (off, len) => {
        const readStartedAt = performance.now();
        const data = await dumpRegion(flasher, 0, off, len, undefined, (phaseName, elapsedMs) => {
          if (opts.startupId) {
            this.startupTrace(`external-flash-${phaseName}`, `offset=0x${off.toString(16)} bytes=${len} elapsed=${Math.round(elapsedMs)}ms`);
          }
        });
        if (opts.startupId) {
          this.startupTrace("external-flash-probe-read", `offset=0x${off.toString(16)} bytes=${len} elapsed=${Math.round(performance.now() - readStartedAt)}ms`);
        }
        return data;
      });
          const report = (done: number, total: number) => phase("partitions", total ? done / total : 0);
          this.partitions = opts.fullGeometry
            ? await scanExtflashPartitions(readExtflash, extSize, report)
            : await scanExtflashPartitionsLazy(readExtflash, extSize, report, {
                blockSize: this.info?.minEraseSizeBytes,
              });
          this._extflashGeometryScanned = true;
          this._extflashGeometrySize = extSize;
          const frogfsFound = this.partitions.some((p) => p.fs === "frogfs");
          const littlefsFound = this.partitions.some((p) => p.fs === "littlefs");
          dbg(`[scan] ${opts.fullGeometry ? "full" : "targeted"} extflash scan complete (${this.partitions.length} partition(s), ${extSize} B; FrogFS=${frogfsFound ? "found" : "missing"}, LittleFS=${littlefsFound ? "found" : "missing"}; ${Math.round(performance.now() - geometryStartedAt)} ms)`);
          if (opts.startupId) this.startupTrace(opts.fullGeometry ? "external-flash-full-scan-done" : "external-flash-targeted-scan-done", `elapsed=${Math.round(performance.now() - geometryStartedAt)}ms reads=${this._scanReads} FrogFS=${frogfsFound ? "found" : "missing"} LittleFS=${littlefsFound ? "found" : "missing"}`);
        } else {
          phase("partitions", 1);
          dbg(`[scan] reusing extflash geometry (${this.partitions.length} partition(s)); refreshing filesystem contents`);
        }
      } else {
        this.partitions = [];
        this._extflashGeometryScanned = false;
        this._extflashGeometrySize = 0;
        phase("partitions", 1);
      }
      // Tier 1 (safe, intflash-only) — skip re-scanning the banks if we scanned them very
      // recently in this same connection (see `_banksScannedAt`'s doc comment above).
      const intflashSafe = this.intflashScanIsSafe();
      const banksFresh = intflashSafe && (
        (this._useQuickBanks && this._quickScanReady && this.banks.length > 0) ||
        this.banks.length > 0 &&
        this._banksScannedAt > 0 &&
        Date.now() - this._banksScannedAt < DeviceStore.BANK_RESCAN_SKIP_WINDOW_MS);
      dbg(`[quickscan] bank phase: ${!intflashSafe ? "deferred (RDP locked or unknown)" : banksFresh ? "using quick bank snapshot" : "running full bank geometry"}`);
      if (!banksFresh && intflashSafe) {
        const bankScanStartedAt = performance.now();
        if (opts.startupId) this.startupTrace("intflash-bank-scan-start");
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
        if (opts.startupId) this.startupTrace("intflash-bank-scan-done", `elapsed=${Math.round(performance.now() - bankScanStartedAt)}ms`);
      }
      dbg(`[scan] bank classification: ${this.banks.map((bank) => `${bank.index}=${bank.type}`).join(", ")}`);
      this._quickScanReady = false;
      this._useQuickBanks = false;
      const runtime = this.runtimeKind === "recovery" || this.locked !== false
        ? { kind: this.runtimeKind === "recovery" ? "recovery" as const : "unknown" as const, vtor: null, pc: null, bank: null }
        : await detectRuntime(transport, this.banks, { pcFallback: intflashSafe });
      if (opts.startupId) this.startupTrace("runtime-classification-done", `kind=${runtime.kind} bank=${runtime.bank ?? "unknown"}`);
      if (runtime.kind !== "unknown") {
        this.runtimeKind = runtime.kind;
        this.runtimeBank = runtime.bank;
        if (runtime.kind !== "retro-go") this.retroGoActivity = null;
      }
      phase("banks", 1);
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
          const frogfsStartedAt = performance.now();
          if (opts.startupId) this.startupTrace("FrogFS-table-read-start", `offset=0x${frogfs.offset.toString(16)}`);
          try {
            const readFrogfsMetadata = async (off: number, len: number): Promise<Uint8Array> => {
              const readStartedAt = performance.now();
              const data = await dumpRegion(flasher!, 0, off, len, undefined, (phaseName, elapsedMs) => {
                if (opts.startupId) {
                  this.startupTrace(`FrogFS-${phaseName}`, `offset=0x${off.toString(16)} bytes=${len} elapsed=${Math.round(elapsedMs)}ms`);
                }
              });
              if (opts.startupId) {
                this.startupTrace("FrogFS-metadata-read", `offset=0x${off.toString(16)} bytes=${len} elapsed=${Math.round(performance.now() - readStartedAt)}ms`);
              }
              return data;
            };
            const res = await readInstalledFrogfs(readFrogfsMetadata, frogfs.offset);
            this.installedFrogfs = res;
            this.installedGames = res.games;
          if (opts.startupId) this.startupTrace("FrogFS-table-read-done", `elapsed=${Math.round(performance.now() - frogfsStartedAt)}ms files=${res.files.length} games=${res.games.length}`);
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
        if (opts.startupId) this.startupTrace("FrogFS-table-read-skipped", "partition=missing");
        this.installedGames = [];
        }
      }
    } catch (e) {
      this.scanError = e instanceof Error ? e.message : String(e);
      // `scanError` is drawn by exactly ONE surface (RomSection's advanced view), so a scan
      // that failed while the user was anywhere else in the app said nothing. Everything
      // downstream reads a half-filled device model without being told why.
      const transferMismatch = /Transfer count mismatch/i.test(this.scanError);
      auditLog.add(transferMismatch ? "warning" : "error", "device", msg((t) => t.shared.auditLog.scanFailed, this.scanError));
      // Let runScan() perform its Recovery Mode contingency for the one transport error that
      // leaves the target reachable but black-screened. Other scan failures retain the existing
      // best-effort behavior and remain represented by scanError only.
      if (transferMismatch && this.utilLoaded) throw e;
    } finally {
      this._useQuickBanks = false;
      // Arrive. A scan that stops at 0.84 because its last phase threw looks like a hang.
      phase("games", 1);
      this.scanning = false;
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
      const backgroundStartedAt = performance.now();
      if (opts.startupId) this.startupTrace("background-filesystem-checks-waiting-for-link-idle");
      if (!(await linkIdle())) {
        dbg("[scan] FS stats skipped: the link was busy or superseded");
        if (opts.startupId) this.startupTrace("background-filesystem-checks-skipped", "link=busy-or-superseded");
        return;
      }
      if (opts.startupId) this.startupTrace("background-filesystem-checks-start", `wait=${Math.round(performance.now() - backgroundStartedAt)}ms`);
      this._startFsStatReads(gen, opts.startupId);
    })();
  }

  /** The background FS-stat + core-version reads, once the link is idle. See `runScan`. */
  private _startFsStatReads(gen: number, startupId?: string): void {
    // The lip stays dark for these. They are hundreds of block reads for numbers that appear
    // quietly in a panel -- the user did not ask for them and cannot act on them, so drawing
    // each read as its own sweep is strobing rather than feedback. Released when the last
    // reader settles, however it settles.
    lipProgress.setQuiet(true);
    let outstanding = 0;
    const startedAt = performance.now();
    const started = <T>(pr: Promise<T>): Promise<T> => {
      outstanding++;
      return pr.finally(() => {
        outstanding--;
        if (outstanding === 0) {
          lipProgress.setQuiet(false);
          if (startupId) this.startupTrace("background-filesystem-checks-done", `elapsed=${Math.round(performance.now() - startedAt)}ms`);
        }
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
          const coreVersionCheck = import("./engine/lfsBrowser.js")
            .then(({ checkCoreVersions }) => checkCoreVersions(firmwareVersion, () => gen !== this._gen))
            .then((res) => {
              if (gen === this._gen) {
                this.coreVersionCheck = res;
                this.coreInventoryReady = true;
                this.coreInventoryFailed = false;
              }
            })
            .catch((e) => {
              if (gen === this._gen) {
                this.coreInventoryReady = true;
                this.coreInventoryFailed = true;
              }
              dbg(`[scan] Core version check failed: ${e}`);
            });
          void started(
            coreVersionCheck,
          );
        }
      }
    }
    // Nothing to wait for: release immediately rather than leaving the lip silenced forever.
    if (outstanding === 0) {
      lipProgress.setQuiet(false);
      if (startupId) this.startupTrace("background-filesystem-checks-done", "no-background-reads");
    }
  }

  async scanSdCardGames(): Promise<void> {
    if (this.targetMedia !== 'sd' || !this.sdHandle) {
      this.installedGames = [];
      this.sdInstalledPaths = new Set();
      this.sdInstalledPathsReady = false;
      return;
    }
    const gen = ++this._gen; // supersede any in-flight background reads from a prior SD scan
    this.scanning = true;
    this.sdInstalledPathsReady = false;
    try {
      const { scanRomDirectory, getValidRoot, checkSdCoreVersions } = await import("./romScan.js");
      const validatedRoot = await getValidRoot(this.sdHandle);
      // An empty/fresh card has no console directory yet.  Root validation is a provisioning
      // signal for the sync path, not a reason to throw away the card handle or hide content.
      // Scan the selected root in that case as well; this keeps a newly provisioned homebrew-only
      // card visible across reloads while the next sync supplies the missing bundle directories.
      const root = validatedRoot ?? this.sdHandle;
      if (root) {
        // The card's homebrew directory is the manifest's (`/homebrews`); romScan deliberately
        // does not know that -- see LEGACY_HOMEBREW_PREFIXES for why it must not import it.
        const scan = await scanRomDirectory(root, null, homebrewScanPrefixes());
        this.sdInstalledPaths = new Set(scan.userRoms.keys());
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
        // Finish the metadata-only core pass before returning. Keeping this read detached left
        // File System Access handles active after a sync, which could prevent the user from
        // unmounting the card until the site was closed.
        await checkSdCoreVersions(root, firmwareVersion).then((res) => {
          if (gen === this._gen) this.coreVersionCheck = res;
        });
      }
    } catch (e) {
      dbg(`[scanSdCardGames] SD scan failed: ${e}`);
      this.installedGames = [];
      this.sdInstalledPathsReady = false;
    } finally {
      this.sdInstalledPathsReady = true;
      this.scanning = false;
    }
  }

  /** Read retro-go's persistent printf log over the LIVE connection (the serialized
   *  transport, so it queues safely with the poll/ops). For the Overview page. */
  async readLog(manual = true): Promise<{ text: string; idx: number }> {
    if (!this.transport) throw new Error("Not connected.");
    if (!this.canReadDeviceLog) throw new Error("Device log reads are unavailable while the device is busy.");
    const transport = this.transport;
    if (this.stockMonitorMode) throw new Error("Device log reads are unavailable while monitoring stock firmware.");
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
    // Fetching the ELF can outlive the idle period in which this request started.
    if (!this.canReadDeviceLog || this.transport !== transport) {
      throw new Error("Device log read superseded by a device operation.");
    }
    const result = await readLogFromTransport(transport, layout, !manual);
    if (this.runtimeKind === "retro-go") this.updateRetroGoActivity(result.text);
    return result;
  }

  /** Capture a screenshot from the LTDC layer-1 framebuffer. Always halts the CPU
   *  for a clean, tear-free frame. The poll is suppressed for the duration so it
   *  cannot race against the in-flight halt/read/resume sequence. */
  async captureScreenshot(onProgress?: (done: number, total: number) => void): Promise<ImageData> {
    if (!this.transport) throw new Error("Not connected to a device.");
    if (this.stockMonitorMode) throw new Error("Screenshot capture is unavailable while monitoring stock firmware.");
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
  private startPoll(intervalMs = this.debuggingDisabled
    ? DeviceStore.RETRY_POLL_INTERVAL_MS
    : DeviceStore.ACTIVE_POLL_INTERVAL_MS): void {
    // Never start underneath an active suspendPoll() — otherwise any internal starter
    // (connect, a nested op's finally) would punch the poll back on mid-flash. The
    // outermost resumePoll() is what legitimately restarts it.
    if (this.pollSuspendDepth > 0) return;
    if (this.pollTimer && this.pollIntervalMs === intervalMs) return;
    this.stopPoll();
    this.pollIntervalMs = intervalMs;
    this.pollTimer = setInterval(() => void this.pollTick(), intervalMs);
  }
  private stopPoll(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    this.pollIntervalMs = 0;
  }
  private markTargetUnresponsive(): void {
    if (this.targetUnresponsive || this.connection !== "connected" && this.connection !== "attention" && this.connection !== "connecting") return;
    this.targetUnresponsive = true;
    this.connection = "lost";
    this.error = "Target is not responding. Waiting for it to wake up…";
    deviceSafety.linkGone();
    dbg(`[poll] target stopped answering; keeping the adapter session open`);
    this.scheduleTargetReconnect();
  }

  /** Reopen an absent target's SWD session independently of its possibly stalled queue. */
  private scheduleTargetReconnect(): void {
    if (this.targetReconnectTimer || this._suppressAutoRetry) return;
    this.targetReconnectTimer = setTimeout(() => {
      this.targetReconnectTimer = null;
      void this.retryTargetConnection();
    }, DeviceStore.RETRY_POLL_INTERVAL_MS);
  }

  private async retryTargetConnection(): Promise<void> {
    if (this._suppressAutoRetry || (this.isConnected && !this.targetUnresponsive)) return;
    if (this._connectPromise || this._stubBootDepth > 0 || this.scanning ||
        this.pollSuspendDepth > 0 || this.pinging ||
        (this.transport?.busy() && !this.targetPingStalled)) {
      this.scheduleTargetReconnect();
      return;
    }
    lipProgress.setQuiet(true);
    try {
      // The selected adapter may itself have disappeared. Never open a picker from polling.
      const known = await getKnownProbes();
      if (this._suppressAutoRetry || (this.isConnected && !this.targetUnresponsive)) return;
      if (this._connectPromise || this._stubBootDepth > 0 || this.scanning ||
          this.pollSuspendDepth > 0 || this.pinging) return;
      const adapter = this.selectedAdapter ?? this.probe?.device;
      if (!adapter || !known.includes(adapter)) {
        this.adapterAvailable = false;
        this.targetUnresponsive = false;
        this.connection = "lost";
        return;
      }
      this.selectedAdapter = adapter;
      this.adapterAvailable = true;
      await this.connect(undefined, { reconnect: true, backgroundRetry: true });
    } catch (error) {
      if (!this._suppressAutoRetry) {
        this.targetUnresponsive = this.adapterAvailable;
        this.connection = "lost";
        dbg(`[poll] target reconnect unavailable: ${error instanceof Error ? error.message : String(error)}`);
      }
    } finally {
      lipProgress.setQuiet(false);
      if (!this._suppressAutoRetry && (!this.isConnected || this.targetUnresponsive)) {
        this.scheduleTargetReconnect();
      }
    }
  }
  private async pollTick(): Promise<void> {
    if (this.pollSuspendDepth > 0 || this._stubBootDepth > 0 || deviceSafety.writeInProgress) return;
    if (this.pinging || !this.transport) return;
    if (this.connection !== "connected" && this.connection !== "attention" && !this.targetUnresponsive) return;
    if (this.scanning) return;
    if (this.transport.busy()) {
      if (this.targetPingStalled && Date.now() - this.lastTargetAnswerAt >= DeviceStore.TARGET_SILENCE_MS) {
        this.markTargetUnresponsive();
      }
      if (deviceSafety.state === "settling" && Date.now() - this.lastSettlingPollLogAt >= 1000) {
        this.lastSettlingPollLogAt = Date.now();
        dbg("[poll] waiting for idle transport while settling");
      }
      return; // an op holds the link — it'll surface a loss itself
    }
    this.pinging = true;
    // Liveness and stock-monitor reads are background traffic, not progress the user asked
    // to watch. Explicit scan/install operation progress still owns the lip independently.
    lipProgress.setQuiet(true);
    try {
      if (this.stockMonitorMode) {
        if (Date.now() - this.lastItcmRuntimeCheckAt >= DeviceStore.STOCK_MONITOR_POLL_INTERVAL_MS) {
          this.lastItcmRuntimeCheckAt = Date.now();
          const passive = await this.probePassiveTarget(this.transport);
          if (!passive) {
            this.targetPingStalled = this.transport.busy();
            if (Date.now() - this.lastTargetAnswerAt >= DeviceStore.TARGET_SILENCE_MS) this.markTargetUnresponsive();
            return;
          }
          this.targetPingStalled = false;
          const { itcm, runtime } = passive;
          if (this.hasPassiveTargetEvidence(itcm, runtime.vtor)) {
            this.lastTargetAnswerAt = Date.now();
            if (this.targetUnresponsive) {
              this.targetUnresponsive = false;
              this.connection = this.locked === false ? "connected" : "attention";
              this.error = null;
            }
          } else if (Date.now() - this.lastTargetAnswerAt >= DeviceStore.TARGET_SILENCE_MS) {
            this.markTargetUnresponsive();
            return;
          }
          if (runtime.vtor !== null) {
            this.runtimeBank = runtime.bank;
            // A bank-1 VTOR and a positive stock ITCM signature identify stock OFW even if
            // detectRuntime labels the VTOR as the generic bootloader subrange.
            if (runtime.vtor >= 0x08000000 && runtime.vtor < 0x08100000 && itcm.model) {
              this.runtimeKind = "stock-ofw";
            } else if (runtime.kind !== "unknown") this.runtimeKind = runtime.kind;
          }
          if (this.runtimeKind === "retro-go" && this.locked === false) {
            this.stockMonitorMode = false;
            this.debuggingDisabled = false;
            this.connection = "connected";
            this.startPoll(DeviceStore.ACTIVE_POLL_INTERVAL_MS);
            dbg("[poll] VTOR shows Retro-Go; expanding runtime diagnostics");
            await this.quickRuntimeProbe(this.transport, { allowIntflash: true });
            void this.runScan("stock-to-Retro-Go transition", { auto: true }).catch((e) =>
              dbg(`[scan] stock-to-Retro-Go background scan failed: ${e instanceof Error ? e.message : String(e)}`),
            );
          } else if (this.runtimeKind === "stock-ofw" && itcm.model) {
            this.model = itcm.model;
          }
        }
        return;
      }

      // Check the Recovery mailbox first so a live locked-device utility is adopted and
      // represented as Recovery before stock signatures or runtime vectors are considered.
      if (this.utilLoaded || this.runtimeKind === "recovery") {
        const alive = await raceWithFallback(isStubAlive(this.transport), 300, false);
        if (alive) {
          this.targetPingStalled = false;
          this.utilLoaded = true;
          this.runtimeKind = "recovery";
          this.runtimeBank = null;
          this.connection = "connected";
          this.targetUnresponsive = false;
          this.error = null;
          this.lastTargetAnswerAt = Date.now();
          this.startPoll(DeviceStore.RECOVERY_POLL_INTERVAL_MS);
          return;
        }
        this.utilLoaded = false;
        this.flasher = null;
        if (this.transport.busy()) {
          this.targetPingStalled = true;
          this.startPoll(DeviceStore.RETRY_POLL_INTERVAL_MS);
          return;
        }
        // A vanished mailbox can mean either that Recovery ended or that the console was
        // unplugged. Check only the passive ITCM + VTOR wave before trying to boot anything.
        // This keeps a missing target from being mistaken for locked stock and repeatedly
        // driving the adapter into Recovery Mode.
        const passive = await this.probePassiveTarget(this.transport);
        if (!passive) {
          this.targetPingStalled = this.transport.busy();
          this.startPoll(DeviceStore.RETRY_POLL_INTERVAL_MS);
          return;
        }
        this.targetPingStalled = false;
        const { itcm, runtime } = passive;
        const targetReachable = this.hasPassiveTargetEvidence(itcm, runtime.vtor);
        if (targetReachable) {
          this.lastTargetAnswerAt = Date.now();
          this.targetUnresponsive = false;
          this.error = null;
        } else if (Date.now() - this.lastTargetAnswerAt >= DeviceStore.TARGET_SILENCE_MS) {
          this.markTargetUnresponsive();
          return;
        } else {
          // Stay in a quiet retry state during the silence window. In particular, do not
          // reset or boot a utility while the target may simply be absent.
          this.runtimeKind = this.locked ? "stock-ofw" : "unknown";
          this.runtimeBank = this.locked ? 1 : null;
          this.debuggingDisabled = !!this.locked;
          this.connection = this.locked ? "attention" : "connected";
          this.startPoll(DeviceStore.RETRY_POLL_INTERVAL_MS);
          return;
        }
        if (itcm.model && runtime.vtor !== null &&
            runtime.vtor >= 0x08000000 && runtime.vtor < 0x08100000) {
          this.runtimeKind = "stock-ofw";
          this.runtimeBank = 1;
        } else if (runtime.kind !== "unknown") {
          this.runtimeKind = runtime.kind;
          this.runtimeBank = runtime.bank;
        }
        this.runtimeKind = this.locked ? "stock-ofw" : "unknown";
        this.runtimeBank = this.locked ? 1 : null;
        this.debuggingDisabled = !!this.locked;
        this.connection = this.locked ? "attention" : "connected";
        if (this.locked) {
          if (Date.now() - this.lastTargetAnswerAt >= DeviceStore.TARGET_SILENCE_MS) {
            this.markTargetUnresponsive();
            return;
          }
          if (Date.now() - this.lastRecoveryBootAttemptAt >= 5_000) {
            this.lastRecoveryBootAttemptAt = Date.now();
            try {
              await this.ensureStub(undefined, false, true);
              this.enterRecoveryMode();
              this.startPoll(DeviceStore.RECOVERY_POLL_INTERVAL_MS);
            } catch (error) {
              dbg(`[poll] could not restart locked Recovery utility: ${error instanceof Error ? error.message : String(error)}`);
              this.startPoll(DeviceStore.RETRY_POLL_INTERVAL_MS);
            }
          }
        }
        dbg("[poll] Recovery mailbox no longer responds; utility state cleared");
        return;
      }

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
        this.firstRecoveryAnswerAt = 0;
        this.targetPingStalled = this.transport.busy();
        // Missed pings are retried, but less often than the normal responsive-target poll.
        this.startPoll(this.debuggingDisabled || !this.utilLoaded
          ? DeviceStore.DEBUG_DISABLED_POLL_INTERVAL_MS
          : DeviceStore.RETRY_POLL_INTERVAL_MS);
        if (this.powerCycleReconnectMode && this.lockedBackupPrompt) {
          this.targetUnresponsive = true;
          this.connection = "lost";
          return;
        }
        if (!this.utilLoaded) {
          // A disabled CPUID read does not distinguish stock OFW from a sleeping target.
          // Keep the passive first-wave probes running so stock can be recognized after a
          // Recovery-to-stock transition. ITCM and VTOR reads do not halt or touch flash.
          // A timed-out ping may still own the serialized link, so wait for a later tick then.
          if (!this.transport.busy()) {
            const passive = await this.probePassiveTarget(this.transport);
            if (!passive) {
              this.targetPingStalled = this.transport.busy();
              if (Date.now() - this.lastTargetAnswerAt >= DeviceStore.TARGET_SILENCE_MS) {
                this.markTargetUnresponsive();
                return;
              }
              this.debuggingDisabled = true;
              this.targetUnresponsive = false;
              this.connection = "attention";
              this.error = null;
              return;
            }
            this.targetPingStalled = false;
            const { itcm, runtime } = passive;
            const vtorInBank1 = runtime.vtor !== null &&
              runtime.vtor >= 0x08000000 && runtime.vtor < 0x08100000;
            if (this.hasPassiveTargetEvidence(itcm, runtime.vtor)) {
              this.lastTargetAnswerAt = Date.now();
            }
            if (itcm.model && vtorInBank1) {
              this.runtimeKind = "stock-ofw";
              this.runtimeBank = 1;
              this.enterStockMonitor(itcm.model, this.locked);
              return;
            }
            if (!this.hasPassiveTargetEvidence(itcm, runtime.vtor) &&
                Date.now() - this.lastTargetAnswerAt >= DeviceStore.TARGET_SILENCE_MS) {
              this.markTargetUnresponsive();
              return;
            }
          }
          // Without the RAM utility, a non-answering target can be stock firmware refusing
          // debug transactions. Preserve the live adapter session for an explicit recovery boot.
          this.debuggingDisabled = true;
          this.targetUnresponsive = false;
          this.connection = "attention";
          this.error = null;
          dbg("[poll] target debug access unavailable; retrying safely at a reduced rate");
          return;
        }
        if (Date.now() - this.lastTargetAnswerAt >= DeviceStore.TARGET_SILENCE_MS) this.markTargetUnresponsive();
        return;
      }

      this.targetPingStalled = false;
      this.lastTargetAnswerAt = Date.now();
      const wasDebuggingDisabled = this.debuggingDisabled;
      if (wasDebuggingDisabled) {
        if (!this.firstRecoveryAnswerAt) this.firstRecoveryAnswerAt = Date.now();
        if (Date.now() - this.firstRecoveryAnswerAt < DeviceStore.TARGET_RECOVERY_MS) return;
        this.debuggingDisabled = false;
        this.targetUnresponsive = false;
        this.connection = "connected";
        this.error = null;
        this._banksScannedAt = 0;
        this.firstRecoveryAnswerAt = 0;
        this.startPoll(DeviceStore.ACTIVE_POLL_INTERVAL_MS);
        deviceSafety.markQuiet();
        dbg("[poll] target answered again; refreshing runtime through the safe scan gates");
        const intflashSafe = this.intflashScanIsSafe();
        await this.quickRuntimeProbe(this.transport, { allowIntflash: intflashSafe });
        void this.runScan("target resumed", { auto: true }).catch((e) =>
          dbg(`[scan] target resumed background scan failed: ${e instanceof Error ? e.message : String(e)}`),
        );
        return;
      }
      if (this.targetUnresponsive) {
        if (!this.firstRecoveryAnswerAt) this.firstRecoveryAnswerAt = Date.now();
        if (Date.now() - this.firstRecoveryAnswerAt < DeviceStore.TARGET_RECOVERY_MS) return;
        this.targetUnresponsive = false;
        this.firstRecoveryAnswerAt = 0;
        this.connection = "connected";
        this.error = null;
        this.startPoll(DeviceStore.ACTIVE_POLL_INTERVAL_MS);
        if (this.powerCycleReconnectMode && this.lockedBackupPrompt) {
          this.powerCycleReconnectMode = false;
          this.debuggingDisabled = false;
          this.lastTargetAnswerAt = Date.now();
          deviceSafety.markQuiet();
          dbg(`[poll] target answered after the locked-backup power-cycle`);
          return;
        }
        this._banksScannedAt = 0;
        deviceSafety.markQuiet();
        dbg(`[poll] target answered again; refreshing its runtime`);
        const intflashSafe = this.intflashScanIsSafe();
        await this.quickRuntimeProbe(this.transport, { allowIntflash: intflashSafe });
        void this.runScan("target resumed", { auto: true }).catch((e) =>
          dbg(`[scan] target resumed background scan failed: ${e instanceof Error ? e.message : String(e)}`),
        );
        return;
      }
      this.startPoll(DeviceStore.ACTIVE_POLL_INTERVAL_MS);
      
      // Target answered while the link was idle, with no operation holding it. This is the
      // app's only device-attested "the write path is quiet and the device is alive" moment,
      // so it is what clears the internal post-write settling gate. Note it can only
      // ever fire once the poll is running again — suspendPoll() keeps it silent for the whole
      // duration of a flash, which is precisely the behaviour we want.
      deviceSafety.markQuiet();

      // Check what is running to update UI state. Recovery was handled by its mailbox-only
      // branch above; this path is for unlocked firmware and uses non-halting VTOR polling.
      const utilAlive = await raceWithFallback(isStubAlive(this.transport), 300, false);
      if (utilAlive) {
        this.runtimeKind = "recovery";
        this.runtimeBank = null;
      } else if (Date.now() - this.lastRuntimeProbeAt >= 2000) {
        // Polling uses VTOR only. PC sampling (which halts) is reserved for unlocked startup
        // diagnostics where VTOR did not identify a known execution region.
        this.lastRuntimeProbeAt = Date.now();
        const runtime = await detectRuntime(this.transport, this.banks, { pcFallback: false });
        if (runtime.kind !== "unknown") {
          this.runtimeKind = runtime.kind;
          this.runtimeBank = runtime.bank;
          if (runtime.kind !== "retro-go") this.retroGoActivity = null;
          else if (this.banks.some((bank) => bank.index === runtime.bank && bank.retroGoVersion)) {
            this.updateRetroGoActivity((await readLogFromTransport(this.transport, undefined, true)).text);
          }

          // A runtime discovered through a deliberate PC sample can populate inventory once.
          if (runtime.kind === "retro-go" && this.banks.length === 0) {
            const intflashSafe = this.intflashScanIsSafe();
            await this.quickRuntimeProbe(this.transport, { allowIntflash: intflashSafe });
            if (intflashSafe) {
              void this.runScan("runtime detected", { auto: true }).catch((e) =>
                dbg(`[scan] runtime detected background scan failed: ${e instanceof Error ? e.message : String(e)}`),
              );
            }
          }
        }

        // A game can clear ITCM after the initial stock-OFW classification. Recheck the
        // signature at a modest cadence while the runtime remains unknown or stock. A
        // successful cleared read rules stock firmware out;
        // then the existing intflash scan path can safely rediscover the active image.
        if ((runtime.kind === "unknown" || runtime.kind === "stock-ofw") &&
            Date.now() - this.lastItcmRuntimeCheckAt >= 5_000) {
          this.lastItcmRuntimeCheckAt = Date.now();
          const itcm = await this.refreshItcmOfwHint(this.transport);
          if (itcm.cleared) {
            this.runtimeKind = "unknown";
            this.runtimeBank = null;
            this.retroGoActivity = null;
            dbg("[poll] ITCM cleared after stock/unknown runtime; safely rescanning internal flash");
            await this.quickRuntimeProbe(this.transport, { allowIntflash: true });
            void this.runScan("ITCM cleared", { auto: true }).catch((e) =>
              dbg(`[scan] ITCM-cleared background scan failed: ${e instanceof Error ? e.message : String(e)}`),
            );
          }
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
        if (utilAlive && !this.utilLoaded && !scanIsFresh) {
          void this.runScan("liveness poll", { auto: true }).catch((e) =>
            dbg(`[scan] liveness poll background scan failed: ${e instanceof Error ? e.message : String(e)}`),
          );
        }
        this.utilLoaded = utilAlive;
      }
      // Runtime classification comes from ITCM or deliberate PC probes, never from the
      // persistent log buffer: old log text proves only that Retro-Go ran at SOME point.
    } finally {
      lipProgress.setQuiet(false);
      this.pinging = false;
    }
  }

  /** Fires when ANY WebUSB device is unplugged — if it's our probe, treat it as a lost link. */
  private onUsbDisconnect = (e: USBConnectionEvent): void => {
    if (this.probe && e.device === this.probe.device) void this.handleLost();
  };

  /** Reset the displayable device facts to "unknown / not scanned". Used on a fresh connect
   *  and on a manual disconnect — NOT on a lost link (those freeze the last-known info). */
  private clearInfo(): void {
    this._backupTaken = false;
    this.info = null;
    this.model = "unknown";
    this.locked = null;
    this.extSizeMB = null;
    this.deviceClass = null;
    this.itcmOfwModel = "unknown";
    this.stockMonitorMode = false;
    this.partitions = [];
    this._extflashGeometryScanned = false;
    this._extflashGeometrySize = 0;
    this.banks = [];
    this.runtimeKind = "unknown";
    this.runtimeBank = null;
    this.installedGames = [];
    this.coreVersionCheck = null;
    this.coreInventoryReady = false;
    this.coreInventoryFailed = false;
    this.installedLfsTree = null;
    this.lfsBlockCache.clear();
    this.lfsChunkHashes.clear();
    this.scanProgress = 0;
    this.scanError = null;
    this._banksScannedAt = 0;
    this._lastFullScanAt = 0;
  }

  /** Drop the live handles/listeners without touching any user-visible device facts
   *  (`info`/`banks`/`deviceClass`/`installedGames` etc. are left exactly as they were —
   *  callers decide separately whether to freeze (lost link) or clear (manual disconnect,
   *  fresh connect) them). Shared by handleLost/disconnect/resetDevice/connect's failure path. */
  private async _teardownConnection(): Promise<void> {
    this.stopPoll();
    this.targetUnresponsive = false;
    this.targetPingStalled = false;
    this.lastTargetAnswerAt = 0;
    this.firstRecoveryAnswerAt = 0;
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
    this.debuggingDisabled = false;
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
    if (this.connection === "disconnected" || this.connection === "lost" && !this.probe) return;
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
    if (this.lockedBackupPrompt) {
      this.lockedBackupPrompt.reject(new Error("Connection lost."));
      this.lockedBackupPrompt = null;
    }
    this.chooseLockedBackupFailure("stop");
    if (this.unlockPrompt) {
      this.unlockPrompt.reject(new Error("Connection lost."));
      this.unlockPrompt = null;
    }
    await this._teardownConnection();
    this.connection = "lost";
    this.adapterAvailable = false;
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
    if (this.targetReconnectTimer) clearTimeout(this.targetReconnectTimer);
    this.targetReconnectTimer = null;
    if (this.stubPrompt) {
      this.stubPrompt.reject(new Error("Disconnected."));
      this.stubPrompt = null;
    }
    if (this.lockedBackupPrompt) {
      this.lockedBackupPrompt.reject(new Error("Disconnected."));
      this.lockedBackupPrompt = null;
    }
    this.chooseLockedBackupFailure("stop");
    if (this.unlockPrompt) {
      this.unlockPrompt.reject(new Error("Disconnected."));
      this.unlockPrompt = null;
    }
    await this._teardownConnection();
    this.probeName = null;
    this.adapterAvailable = false;
    this.runtimeKind = "unknown";
    this.runtimeBank = null;
    this.retroGoActivity = null;
    this.clearInfo();
    this.connection = "disconnected";
    deviceSafety.linkGone();
    lipProgress.reset();
  }

  /** Retire background work before Vite replaces this hardware-owning module. */
  stopForDevelopmentReload(): void {
    this._suppressAutoRetry = true;
    this.suspendPoll();
    if (this.adapterPollTimer) clearInterval(this.adapterPollTimer);
    this.adapterPollTimer = null;
    if (this.targetReconnectTimer) clearTimeout(this.targetReconnectTimer);
    this.targetReconnectTimer = null;
  }

  setAdapterFrequency(hz: number): void {
    if (!Number.isFinite(hz) || hz < 1_000_000 || hz > 10_000_000) return;
    this.adapterFrequencyHz = hz;
    saveSel("adapterFrequencyHz", hz);
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
    if (this.lockedBackupPrompt) {
      this.lockedBackupPrompt.reject(new Error("Device reset."));
      this.lockedBackupPrompt = null;
    }
    this.chooseLockedBackupFailure("stop");
    if (this.unlockPrompt) {
      this.unlockPrompt.reject(new Error("Device reset."));
      this.unlockPrompt = null;
    }
    await this._teardownConnection();
    this.connection = "connecting";
    this.error = null;
    await this.reconnectLoop("connecting");
  }

  private _manageDeviceStartup: { media: "sd" | "flash"; startedAt: number; promise: Promise<void> } | null = null;

  /** Both landing destinations use this one device-inventory startup path. The Library adds a
   *  short barrier before its local-folder sync; Overview does not. Device reads, scan reuse,
   *  and connection policy are shared. */
  private startManageDeviceInventory(source: "library" | "overview"): Promise<void> {
    const media = this.targetMedia;
    const priorStartup = this._manageDeviceStartup;
    const startupAge = priorStartup ? Date.now() - priorStartup.startedAt : Infinity;
    if (priorStartup?.media === media && (this.scanning || !!this._scanPromise || startupAge < 5_000)) {
      this.startupTrace("device-scan-request-reused", `source=${source} media=${media}`);
      if (source === "library") {
        this.libraryScanStartupPending = true;
        return priorStartup.promise.finally(() => {
          this.libraryScanStartupPending = false;
          this.startupTrace("device-startup request settled", "source=library libraryBarrierReleased=true");
        });
      }
      return priorStartup.promise;
    }
    const trace = {
      id: `${source}-${++this._manageStartupSeq}`,
      startedAt: performance.now(),
    };
    this._manageStartupTrace = trace;
    this._manageStartupSawActiveLip = false;
    this._manageStartupDeviceDone = false;
    this.observeManageStartupLip(lipProgress.active);
    this.startupTrace(`Manage-${source === "library" ? "Library" : "Overview"} device startup begin`, `media=${media}`);
    if (source === "library") this.libraryScanStartupPending = true;
    const promise = (async () => {
      if (media === "sd" && source === "library") {
        this.startupTrace("waiting-for-SD-handle");
        await this.whenSdRestored();
        this.startupTrace("SD-handle-ready; no-device-scan");
        this.markManageStartupDeviceDone(trace.id, "media=sd");
        return;
      }

      this.startupTrace("silent-connect begin", `connection=${this.connection} utilLoaded=${this.utilLoaded}`);
      await this.connectSilent();
      this.startupTrace("silent-connect settled", `connection=${this.connection} utilLoaded=${this.utilLoaded}`);
      if (this.flasher && this._scanPromise) {
        this.startupTrace(`${source}-selection scan joined-existing`);
        void this._scanPromise.then(
          () => this.markManageStartupDeviceDone(trace.id, "reason=joined-existing-scan"),
          (e) => {
            this.startupTrace("device-scan-failed", `reason=joined-existing-scan error=${e instanceof Error ? e.message : String(e)}`);
            this.markManageStartupDeviceDone(trace.id, "reason=joined-existing-scan failed", false);
          },
        );
      } else if (this.flasher && this._lastFullScanAt > 0 && Date.now() - this._lastFullScanAt < DeviceStore.AUTO_SCAN_FRESHNESS_WINDOW_MS) {
        this.startupTrace(`${source}-selection scan reused-fresh-inventory`, `age=${Date.now() - this._lastFullScanAt}ms`);
        this.markManageStartupDeviceDone(trace.id, "reason=reused-fresh-inventory");
      } else if (this.flasher) {
        this.startupTrace(`${source}-selection scan requested`);
        void this.runScan(`${source} selection`, { auto: true, startupId: trace.id }).catch((e) =>
          dbg(`[scan] ${source} selection failed: ${e instanceof Error ? e.message : String(e)}`),
        );
        await Promise.resolve();
      } else {
        this.startupTrace("device scan unavailable; RAM flasher not ready");
        if (!this._scanPromise) this.markManageStartupDeviceDone(trace.id, "device-scan=unavailable");
      }
    })().finally(() => {
      if (this._manageDeviceStartup?.promise === promise) {
        this.libraryScanStartupPending = false;
        this.startupTrace("device-startup request settled", `source=${source} libraryBarrierReleased=${source === "library"}`);
      }
    });
    this._manageDeviceStartup = { media, startedAt: Date.now(), promise };
    return promise;
  }

  /** Manage Library's device scan starts before its independent local-folder scan. */
  startLibraryDeviceScan(): Promise<void> {
    return this.startManageDeviceInventory("library");
  }

  /** Overview uses the same device scan as Manage Library, without the Library sync barrier. */
  startOverviewDeviceScan(): Promise<void> {
    return this.startManageDeviceInventory("overview");
  }

  /** When set, ConnectGateModal is asking the user to connect before proceeding (e.g. "Install
   *  ROMs" clicked in Flash mode while disconnected). Mirrors library.folderGatePrompt's
   *  promise-gate shape/pattern. */
  connectGatePrompt = $state<{ resolve: () => void; reject: (e: Error) => void } | null>(null);

  adapterConfigPrompt = $state<{ resolve: () => void; reject: (e: Error) => void } | null>(null);

  requestAdapterConfiguration(): Promise<void> {
    if (this.isConnected) return Promise.resolve();
    return new Promise<void>((resolve, reject) => {
      this.adapterConfigPrompt = { resolve, reject };
    });
  }

  resolveAdapterConfiguration(): void {
    const prompt = this.adapterConfigPrompt;
    this.adapterConfigPrompt = null;
    prompt?.resolve();
  }

  cancelAdapterConfiguration(): void {
    const prompt = this.adapterConfigPrompt;
    this.adapterConfigPrompt = null;
    prompt?.reject(new Error("Adapter configuration cancelled."));
  }

  /** Resolves immediately if already connected. Otherwise, first tries a silent connect using
   *  a known/trusted adapter (no picker) — only if that fails or none exists does it surface
   *  ConnectGateModal and wait for the user to connect (or cancel). */
  async ensureConnectGate(): Promise<void> {
    if (this.isConnected) return;
    if (!this._suppressAutoRetry) {
      try {
        const known = await getKnownProbes();
        if (known.length === 1) await this.connect();
      } catch (e) {
        // The adapter may still be plugged in while the console is powered off.
        // Do not immediately open a chooser in Overview for that expected state;
        // the user can reconnect from the header when the device is powered again.
        if (/Transfer count mismatch/i.test(e instanceof Error ? e.message : String(e))) return;
        // Other failures fall through to the explicit connect modal.
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
const onUsbConnect = () => void device.connectSilent();
if (typeof navigator !== "undefined" && navigator.usb) {
  navigator.usb.addEventListener("connect", onUsbConnect);
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    device.stopForDevelopmentReload();
    navigator.usb?.removeEventListener("connect", onUsbConnect);
  });
  // A hardware session cannot be safely transferred between two store instances with
  // independent transport queues. Recreate the page when this module changes.
  import.meta.hot.accept(() => window.location.reload());
}

export const modelLabel = (m: Model): string =>
  m === "mario" ? "Mario" : m === "zelda" ? "Zelda" : "Game & Watch";
export const firmwareLabel = (f: Firmware): string =>
  f === "stock-ofw" ? "Stock firmware" : f === "retro-go" ? "retro-go" : "Unrecognized";
