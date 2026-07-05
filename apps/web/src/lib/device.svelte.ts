// The global device-state object (UX §3.2). Written only by the connection
// layer; read everywhere. Drives the structural model accent.
import type { GnwFlasher, DeviceInfo } from "@gnw/gnw-flasher";
import type { LittlefsTreeNode } from "@gnw/fs-builders";
import { connectProbe, getKnownProbes, serialTransport, type ProbeHandle, type SerialTransport } from "./engine/transport.js";
import { bootStub, readInfo, dumpRegion, attachFlasher, isStubAlive, pingTarget } from "./engine/flasher.js";
import { scanExtflashPartitions, type ExtPartition } from "./engine/fsscan.js";
import { scanIntflashBanks, type IntflashBank } from "./engine/intflashscan.js";
import { classifyDevice, type DeviceClass } from "./engine/classify.js";
import { captureScreenshot as _captureScreenshot } from "./engine/screenshot.js";
import { readInstalledFrogfs, type InstalledGame, type InstalledFrogfs } from "./engine/frogfsDevice.js";
import { dbg, dbgLog } from "./debug.js";
import { readLogFromTransport } from "./engine/devicelog.js";
import { raceWithFallback } from "./engine/timeout.js";
import { loadSel, saveSel } from "./persist.js";
import { installProgress } from "./installProgress.svelte.js";
import type { CoreVersionCheck } from "./engine/coreVersion.js";

export type Connection = "disconnected" | "connecting" | "connected" | "attention" | "lost";
export type Model = "mario" | "zelda" | "unknown";
export type Firmware = "stock-ofw" | "retro-go" | "unknown";

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
  
  sdHandle = $state<any>(null); // FileSystemDirectoryHandle (any to avoid ts complaints if not in lib)


  // Non-reactive engine handles (held across operations while connected).
  private probe: ProbeHandle | null = null;
  /** Serialized transport (all calls FIFO-queued) so the liveness poll can share the link
   *  transparently without crashing the active caller. */
  public transport: SerialTransport | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private pinging = false;
  flasher: GnwFlasher | null = null;
  /** Reactive mirror of "the RAM util is loaded" — `flasher` itself is non-reactive, so the
   *  UI (LED/status) tracks this instead. Set when ensureStub boots it; cleared on disconnect. */
  utilLoaded = $state(false);
  info = $state<DeviceInfo | null>(null);
  /** When set, a confirmation modal is asking the user to load the RAM flash utility. */
  stubPrompt = $state<{ resolve: () => void; reject: (e: Error) => void } | null>(null);

  // Flash scan (docs/DEVICE_SCAN.md) — populated on connect, non-blocking; re-run
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
  /** Async computed FS statistics keyed by partition offset */
  fsStats = $state<Record<number, { usedBytes: number; freeBytes: number }>>({});
  /** Do installed emulator cores agree with the installed retro-go version (and each other)?
   *  Populated in the background, after the scan's UI-critical results are already in — see
   *  `_doScan()`'s tail (Flash/LittleFS) and `scanSdCardGames()` (SD-card files). Null until
   *  the first check completes; best-effort, never blocks or fails a scan. */
  coreVersionCheck = $state<CoreVersionCheck | null>(null);
  /** Bumped on every disconnect/reconnect/rescan. Background FS-stat reads capture the
   *  generation they started in and drop their result if it's stale by the time they
   *  resolve (device gone, or a newer scan superseded them) — see [[swd-connection-model]]. */
  private _gen = 0;
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
    if (this.connection === "connecting" && this._connectPromise) return this._connectPromise;
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
        void this.runScan(); // we can always scan intflash
      } catch (e) {
        this.error = e instanceof Error ? e.message : String(e);
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
    if (!this.transport) return false;
    try {
      return await raceWithFallback(isStubAlive(this.transport), 2500, false);
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
      await this.flasher.getContext(3000);
      return true;
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
    // Reuse the cached stub ONLY if it's alive AND has a free context. A wedged stub (after a failed
    // flash), dirty contexts, or a power-cycled device → re-boot a clean stub (clears contexts +
    // resets the context counter), otherwise the next flash hangs forever in getContext.
    let reboot = forceReboot;
    if (this.flasher && !forceReboot) {
      await new Promise(r => setTimeout(r, 100)); // USB settle delay
      if ((await this.stubAlive()) && (await this.contextsFree())) {
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
    this._gen++;
    this.flasher = await bootStub(this.transport, dbgLog("stub", log));
    this.utilLoaded = true;
    // Fresh-boot path (Tier 0/2): the stub is now definitely alive, so both `locked`
    // (Tier 0) and `extSizeMB` (Tier 2) can be read off the same info struct.
    this.info = await readInfo(this.flasher, dbgLog("stub", log));
    this.locked = this.info.locked;
    this.extSizeMB = this.info.externalFlashSizeMiB;
    // A reboot invalidates any "banks already scanned this connection" freshness — force a
    // real re-scan of intflash on the next runScan() rather than trusting cached banks.
    this._banksScannedAt = 0;
    dbg("[ensureStub] stub booted + info read");
    return this.flasher;
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
    p?.reject(new Error("Loading the flash utility was cancelled."));
  }

  /**
   * Scan flash geometry over SWD (non-blocking; updates reactive state). intflash is a
   * direct read (fast), extflash is the gnwmanager-style stride walk via the stub's
   * memory-mapped extflash. Re-runnable after a big change. See docs/DEVICE_SCAN.md.
   */
  private _scanPromise: Promise<void> | null = null;
  async runScan(): Promise<void> {
    if (this._scanPromise) return this._scanPromise;
    this._scanPromise = this._doScan();
    try {
      await this._scanPromise;
    } finally {
      this._scanPromise = null;
    }
  }
  private async _doScan(): Promise<void> {
    if (!this.transport) return;
    const flasher = this.flasher;
    const transport = this.transport;
    const gen = ++this._gen; // supersede any in-flight background reads from a prior scan
    this.scanning = true;
    this.scanProgress = 0;
    this.scanError = null;
    try {
      // Tier 1 (safe, intflash-only) — skip re-scanning the banks if we scanned them very
      // recently in this same connection (see `_banksScannedAt`'s doc comment above); Tier 2
      // (below) still runs in full regardless.
      const banksFresh =
        this.banks.length > 0 &&
        this._banksScannedAt > 0 &&
        Date.now() - this._banksScannedAt < DeviceStore.BANK_RESCAN_SKIP_WINDOW_MS;
      if (!banksFresh) {
        this.banks = await scanIntflashBanks((addr, len) => transport.readMemory(addr, len));
        this._banksScannedAt = Date.now();
      }
      // Tier 2 (deep, needs the stub) — extflash partitions + installed games.
      const extSize = this.info?.externalFlashSizeBytes ?? 0;
      if (flasher) {
        this.partitions = await scanExtflashPartitions(
          (off, len) => dumpRegion(flasher, 0, off, len),
          extSize,
          (done, total) => (this.scanProgress = total ? done / total : 0),
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
          try {
            const res = await readInstalledFrogfs((off, len) => dumpRegion(flasher!, 0, off, len), frogfs.offset);
            this.installedFrogfs = res;
            this.installedGames = res.games;
          } catch {
            this.installedFrogfs = null;
            this.installedGames = [];
          }
        } else {
          this.installedGames = [];
        }
      }
    } catch (e) {
      this.scanError = e instanceof Error ? e.message : String(e);
    } finally {
      this.scanning = false;
      this._lastFullScanAt = Date.now();
    }

    // Background fetch of FS stats so we don't block the UI. Each read checks `gen`
    // before writing back — a disconnect or a newer scan bumps `_gen` and makes any
    // still-running read a no-op instead of racing a flash/screenshot or writing
    // stats for a device that's no longer connected.
    for (const p of this.partitions) {
      if (p.fs === "fat") {
        import("./engine/fsscan.js").then(({ readFatUsedSpace }) => {
          readFatUsedSpace((off: number, len: number) => dumpRegion(this.flasher!, 0, off, len), p.offset, p.size).then((res) => {
            if (res && gen === this._gen) this.fsStats[p.offset] = res;
          }).catch((e) => dbg(`[scan] FAT usedSpace read failed: ${e}`));
        });
      } else if (p.fs === "littlefs") {
        import("./engine/lfsBrowser.js").then(({ getLfsUsedSpace }) => {
          getLfsUsedSpace().then(res => {
            if (res && gen === this._gen) this.fsStats[p.offset] = res;
          }).catch((e) => dbg(`[scan] LittleFS usedSpace read failed: ${e}`));
        });
        // Core-version validation (Flash mode only — SD-mode's own equivalent runs from
        // scanSdCardGames()). Deliberately kicked off here, AFTER scanning=false and the
        // UI-critical partition/deviceClass results are already set, since it pulls every
        // core's full bytes over SWD (no partial-read primitive exists) and must never delay
        // the results the UI is waiting on.
        if (this.targetMedia !== "sd") {
          const firmwareVersion = this.banks.map((b) => b.retroGoVersion).find(Boolean) ?? null;
          import("./engine/lfsBrowser.js").then(({ checkCoreVersions }) => {
            checkCoreVersions(firmwareVersion, () => gen !== this._gen).then((res) => {
              if (gen === this._gen) this.coreVersionCheck = res;
            }).catch((e) => dbg(`[scan] Core version check failed: ${e}`));
          });
        }
      }
    }
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
        const scan = await scanRomDirectory(root);
        const games: InstalledGame[] = [];
        for (const [path, data] of scan.userRoms.entries()) {
           if (path.startsWith("covers/")) continue;
           if (path.startsWith("cheats/")) continue;
           if (path.startsWith("bios/")) continue;
           
           const parts = path.split("/");
           if (parts.length >= 2) {
             const system = parts[0];
             const name = parts.slice(1).join("/");
             games.push({
               path: "roms/" + path,
               system,
               name,
               size: data instanceof Uint8Array ? data.length : (data as File).size,
               dataOffs: 0
             });
           }
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
  async readLog(): Promise<{ text: string; idx: number }> {
    if (!this.transport) throw new Error("Not connected.");
    return readLogFromTransport(this.transport);
  }

  /** Capture a screenshot from the LTDC layer-1 framebuffer. Always halts the CPU
   *  for a clean, tear-free frame. The poll is suppressed for the duration so it
   *  cannot race against the in-flight halt/read/resume sequence. */
  async captureScreenshot(onProgress?: (done: number, total: number) => void): Promise<ImageData> {
    if (!this.transport) throw new Error("Not connected to a device.");
    this.stopPoll();
    try {
      return await _captureScreenshot(this.transport, onProgress);
    } finally {
      this.startPoll();
    }
  }

  /** Public wrapper: suspend the liveness poll around a flash-writing operation that may
   *  trigger its own internal reset/reboot (e.g. a retry's forced RAM-stub reboot) — same
   *  reasoning as captureScreenshot's poll suppression, to prevent the poll's independent
   *  SWD traffic from racing a concurrent reset. Pair with resumePoll() in a finally. */
  suspendPoll(): void {
    this.stopPoll();
  }
  /** Public wrapper: resume the liveness poll after suspendPoll(). */
  resumePoll(): void {
    this.startPoll();
  }

  // --- Liveness poll: catch the device being unplugged FROM the adapter (the adapter stays
  // on USB, so there's no disconnect event — only a failed read reveals it). Loss DURING an
  // op is caught by that op's own transport calls throwing; this poll covers idle moments.
  // The serialized transport lets it share the link with in-flight ops safely.
  private startPoll(): void {
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
    if (this.transport.busy()) return; // an op holds the link — it'll surface a loss itself
    this.pinging = true;
    try {
      // Time-box the ping: a yanked device usually leaves the read HANGING (the adapter keeps
      // retrying — the blinking), so "no response in 300 ms while idle" == lost. Safe to
      // time-box because we only ping when the link is idle (never queued behind a long op).
      const ok = await raceWithFallback(pingTarget(this.transport), 300, false);
      if (!ok) {
        if (this.connection === "connected" || this.connection === "attention") {
          await this.handleLost();
        }
        return;
      }
      
      // Target is still attached. Check what is running to update UI state:
      const utilAlive = await isStubAlive(this.transport);
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
        if (utilAlive && !this.utilLoaded && !scanIsFresh) void this.runScan();
        this.utilLoaded = utilAlive;
      }
      // NOTE: deliberately no isRetroGoRunning-based firmware guess here anymore. The
      // persistent printf log survives reboots, so its presence only proves retro-go ran at
      // SOME point — never that it's running now. Firmware classification comes solely from
      // the Tier-1/2 bank scan (`deviceClass`); logs are read on-demand for display only
      // (device.readLog()), with zero bearing on device state. See the plan's Tier 0 section.
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
  private clearInfo(): void {
    this.info = null;
    this.model = "unknown";
    this.locked = null;
    this.extSizeMB = null;
    this.deviceClass = null;
    this.partitions = [];
    this.banks = [];
    this.installedGames = [];
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
    if (typeof navigator !== "undefined" && navigator.usb) {
      navigator.usb.removeEventListener("disconnect", this.onUsbDisconnect);
    }
    try {
      await this.probe?.dispose();
    } catch {
      /* already gone */
    }
    this.probe = null;
    this.transport = null;
    this.flasher = null;
    this.utilLoaded = false;
    this.scanning = false;
    this._gen++; // supersede any in-flight background FS-stat reads
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
    if (this.stubPrompt) {
      this.stubPrompt.reject(new Error("Connection lost."));
      this.stubPrompt = null;
    }
    await this._teardownConnection();
    this.connection = "lost";
    this.error = "Connection lost — the adapter was unplugged. Reconnecting…";
    // If an install/SD-sync operation is actively running, this is very likely the expected
    // stub-boot reset (ensureStub()'s SWD-level target reset briefly drops the USB link) —
    // surface it inside the still-visible progress modal instead of leaving it silent.
    installProgress.logActive("Link dropped (expected during Recovery Mode boot), reconnecting…");
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
    await this._teardownConnection();
    this.probeName = null;
    this.clearInfo();
    this.connection = "disconnected";
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
   *  ROMs" clicked in Flash mode while disconnected). Mirrors roms.folderGatePrompt's
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
