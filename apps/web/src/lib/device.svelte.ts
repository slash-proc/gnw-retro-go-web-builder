// The global device-state object (UX §3.2). Written only by the connection
// layer; read everywhere. Drives the structural model accent.
import type { GnwFlasher, DeviceInfo } from "@gnw/gnw-flasher";
import type { LittlefsTreeNode } from "@gnw/fs-builders";
import { connectProbe, serialTransport, type ProbeHandle, type SerialTransport } from "./engine/transport.js";
import { bootStub, readInfo, dumpRegion, attachFlasher, isStubAlive, pingTarget } from "./engine/flasher.js";
import { scanExtflashPartitions, type ExtPartition } from "./engine/fsscan.js";
import { scanIntflashBanks, type IntflashBank } from "./engine/intflashscan.js";
import { classifyDevice, type DeviceClass } from "./engine/classify.js";
import { readInstalledFrogfs, type InstalledGame, type InstalledFrogfs } from "./engine/frogfsDevice.js";
import { dbg, dbgLog } from "./debug.js";
import { readLogFromTransport, isRetroGoRunning } from "./engine/devicelog.js";

export type Connection = "disconnected" | "connecting" | "connected" | "attention" | "lost";
export type Model = "mario" | "zelda" | "unknown";
export type Firmware = "stock-ofw" | "retro-go" | "unknown";

class DeviceStore {
  connection = $state<Connection>("disconnected");
  model = $state<Model>("unknown");
  firmware = $state<Firmware>("unknown");
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

  /** The model that should tint the UI (null = unknown/neutral). */
  get accent(): Exclude<Model, "unknown"> | null {
    return this.model === "unknown" ? null : this.model;
  }

  get isConnected(): boolean {
    return this.connection === "connected" || this.connection === "attention";
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

  /** Attach to a probe ONLY — the RAM util loads later, on demand (see ensureStub). */
  async connect(log?: (m: string) => void, opts?: { forcePicker?: boolean }): Promise<void> {
    if (this.connection === "connecting") return;
    this.error = null;
    this.connection = "connecting";
    this.clearInfo(); // drop any frozen info from a prior lost link — fresh start
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
        this.applyInfo(await readInfo(this.flasher, log));
      } else {
        this.flasher = null;
        this.utilLoaded = false;
      }
      this.connection = "connected";
      this.everConnected = true;
      this.startPoll();
      if (utilUp) void this.runScan(); // util already up → safe to scan geometry now
    } catch (e) {
      this.error = e instanceof Error ? e.message : String(e);
      await this.disconnect();
      throw e;
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
      return await Promise.race([
        isStubAlive(this.transport),
        new Promise<boolean>((r) => setTimeout(() => r(false), 800)),
      ]);
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
      await this.flasher.getContext(1500);
      return true;
    } catch {
      return false;
    }
  }

  async ensureStub(log?: (m: string) => void): Promise<GnwFlasher> {
    if (!this.probe || !this.transport) throw new Error("Not connected.");
    // Reuse the cached stub ONLY if it's alive AND has a free context. A wedged stub (after a failed
    // flash), dirty contexts, or a power-cycled device → re-boot a clean stub (clears contexts +
    // resets the context counter), otherwise the next flash hangs forever in getContext.
    let reboot = false;
    if (this.flasher) {
      if ((await this.stubAlive()) && (await this.contextsFree())) {
        dbg("[ensureStub] reusing cached flasher (alive + context free)");
        return this.flasher;
      }
      dbg("[ensureStub] cached stub unusable (dead or wedged contexts) → re-booting a fresh stub");
      this.flasher = null;
      this.utilLoaded = false;
      reboot = true;
    }
    if (!reboot) {
      // First load — confirm via the modal (loading the util resets the device).
      dbg("[ensureStub] awaiting confirm → bootStub");
      await new Promise<void>((resolve, reject) => {
        this.stubPrompt = { resolve, reject };
      });
    }
    this.flasher = await bootStub(this.transport, dbgLog("stub", log));
    this.utilLoaded = true;
    this.applyInfo(await readInfo(this.flasher, dbgLog("stub", log)));
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

  private applyInfo(info: DeviceInfo): void {
    this.info = info;
    this.locked = info.locked;
    this.extSizeMB = info.externalFlashSizeMiB;
    const stock = info.detectedStockFirmware;
    if (stock === "MARIO" || stock === "ZELDA") {
      this.model = stock.toLowerCase() as Model;
      this.firmware = "stock-ofw";
    } else {
      this.model = "unknown";
      this.firmware = "unknown";
    }
  }

  /**
   * Scan flash geometry over SWD (non-blocking; updates reactive state). intflash is a
   * direct read (fast), extflash is the gnwmanager-style stride walk via the stub's
   * memory-mapped extflash. Re-runnable after a big change. See docs/DEVICE_SCAN.md.
   */
  async runScan(): Promise<void> {
    if (!this.flasher || !this.transport) return;
    const flasher = this.flasher;
    const transport = this.transport;
    this.scanning = true;
    this.scanProgress = 0;
    this.scanError = null;
    try {
      this.banks = await scanIntflashBanks((addr, len) => transport.readMemory(addr, len));
      const extSize = this.info?.externalFlashSizeBytes ?? 0;
      this.partitions = await scanExtflashPartitions(
        (off, len) => dumpRegion(flasher, 0, off, len),
        extSize,
        (done, total) => (this.scanProgress = total ? done / total : 0),
      );
      this.deviceClass = classifyDevice(this.info, this.banks, this.partitions);
      // Read the installed-games list from the device's FrogFS (metadata only). Best-effort:
      // no frogfs partition or an unreadable image → empty list, not a scan failure.
      const frogfs = this.partitions.find((p) => p.fs === "frogfs");
      if (frogfs) {
        try {
          const res = await readInstalledFrogfs((off, len) => dumpRegion(flasher, 0, off, len), frogfs.offset);
          this.installedFrogfs = res;
          this.installedGames = res.games;
        } catch {
          this.installedFrogfs = null;
          this.installedGames = [];
        }
      } else {
        this.installedGames = [];
      }
    } catch (e) {
      this.scanError = e instanceof Error ? e.message : String(e);
    } finally {
      this.scanning = false;
    }
  }

  /** Read retro-go's persistent printf log over the LIVE connection (the serialized
   *  transport, so it queues safely with the poll/ops). For the Device Information page. */
  async readLog(): Promise<{ text: string; idx: number }> {
    if (!this.transport) throw new Error("Not connected.");
    return readLogFromTransport(this.transport);
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
      const ok = await Promise.race([
        pingTarget(this.transport),
        new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 300)),
      ]);
      if (!ok) {
        if (this.connection === "connected" || this.connection === "attention") {
          await this.handleLost();
        }
        return;
      }
      
      // Target is still attached. Check what is running to update UI state:
      const utilAlive = await isStubAlive(this.transport);
      if (this.utilLoaded !== utilAlive) {
        this.utilLoaded = utilAlive;
      }
      
      if (!utilAlive) {
        // If the util isn't running, see if Retro-Go is
        const retroGo = await isRetroGoRunning(this.transport);
        if (retroGo && this.firmware === "unknown") {
          this.firmware = "retro-go";
        }
      }
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
    this.firmware = "unknown";
    this.locked = null;
    this.extSizeMB = null;
    this.deviceClass = null;
    this.partitions = [];
    this.banks = [];
    this.installedGames = [];
    this.scanProgress = 0;
    this.scanError = null;
  }

  /** The adapter's USB vanished — FREEZE the last-known info on screen (the user keeps seeing
   *  what was there), drop only the live handles, and flip to "lost" so actions gray out
   *  until they reconnect. Stays on the current view (everConnected). */
  private async handleLost(): Promise<void> {
    if (this.connection === "disconnected" || this.connection === "lost") return;
    this.stopPoll();
    if (typeof navigator !== "undefined" && navigator.usb) {
      navigator.usb.removeEventListener("disconnect", this.onUsbDisconnect);
    }
    if (this.stubPrompt) {
      this.stubPrompt.reject(new Error("Connection lost."));
      this.stubPrompt = null;
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
    this.connection = "lost";
    this.error = "Connection lost — the adapter was unplugged. Reconnect to continue.";
  }

  async disconnect(): Promise<void> {
    this.stopPoll();
    if (typeof navigator !== "undefined" && navigator.usb) {
      navigator.usb.removeEventListener("disconnect", this.onUsbDisconnect);
    }
    if (this.stubPrompt) {
      this.stubPrompt.reject(new Error("Disconnected."));
      this.stubPrompt = null;
    }
    try {
      await this.probe?.dispose();
    } catch {
      /* ignore */
    }
    this.probe = null;
    this.transport = null;
    this.flasher = null;
    this.utilLoaded = false;
    this.probeName = null;
    this.clearInfo();
    this.scanning = false;
    this.connection = "disconnected";
  }
}

export const device = new DeviceStore();

export const modelLabel = (m: Model): string =>
  m === "mario" ? "Mario" : m === "zelda" ? "Zelda" : "Game & Watch";
export const firmwareLabel = (f: Firmware): string =>
  f === "stock-ofw" ? "Stock firmware" : f === "retro-go" ? "retro-go" : "Unrecognized";
