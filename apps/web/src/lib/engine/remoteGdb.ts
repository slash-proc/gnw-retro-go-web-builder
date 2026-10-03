// GDB RSP framing restored from feat/qemu-adapter, originally ported from
// gnwmanager/ocdbackend/gdb_backend.py. Managed Pi helpers expose the same low-level
// backend primitives as JSON requests so live scans never trigger GDB attach halts.
import { MemoryTransport } from "@gnw/swd-transport";
export const DEFAULT_REMOTE_PORT = 8765;
export function remoteGdbUrl(host: string, port: number): string {
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid remote adapter port");
  const value = host.trim();
  const base = /^(ws|wss):\/\//.test(value) ? value : `ws://${value}`;
  const url = new URL(base);
  if (!url.hostname || url.username || url.password || url.search || url.hash || (url.pathname !== "/" && url.pathname !== "/gdb")) throw new Error("Invalid remote adapter host");
  url.port = String(port); url.pathname = "/gdb";
  return url.toString();
}
class GdbError extends Error {}

function checksum(data: Uint8Array): string {
  let c = 0;
  for (const b of data) c = (c + b) & 0xff;
  return c.toString(16).padStart(2, "0");
}

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  if (!/^(?:[0-9a-fA-F]{2})*$/.test(hex)) throw new GdbError("Invalid hexadecimal GDB response");
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}
function bytesToHex(data: Uint8Array): string {
  let s = "";
  for (const b of data) s += b.toString(16).padStart(2, "0");
  return s;
}

/** Pull-based queue of raw bytes fed by WebSocket "message" events. */
class ByteQueue {
  private chunks: Uint8Array[] = [];
  private offset = 0;
  private waiters: ((b: number) => void)[] = [];
  private closedErr: Error | null = null;

  push(data: Uint8Array): void {
    if (this.waiters.length && data.length) {
      // Fast-path a single waiting reader with the first byte, queue the rest.
      const first = data[0];
      data = data.subarray(1);
      this.waiters.shift()!(first);
    }
    if (data.length) this.chunks.push(data);
    while (this.waiters.length && this.chunks.length) {
      const b = this.readByteSync();
      this.waiters.shift()!(b);
    }
  }

  close(err: Error): void {
    this.closedErr = err;
    while (this.waiters.length) this.waiters.shift()!(-1);
  }

  private readByteSync(): number {
    const chunk = this.chunks[0];
    const b = chunk[this.offset];
    this.offset++;
    if (this.offset >= chunk.length) {
      this.chunks.shift();
      this.offset = 0;
    }
    return b;
  }

  async readByte(): Promise<number> {
    if (this.chunks.length) return this.readByteSync();
    if (this.closedErr) throw this.closedErr;
    const b = await new Promise<number>((resolve) => this.waiters.push(resolve));
    if (b < 0) throw this.closedErr ?? new GdbError("Connection closed");
    return b;
  }
}

/** GDB Remote Serial Protocol client, ported from gnwmanager's GDBBackend
 *  (references/gnwmanager gnwmanager/ocdbackend/gdb_backend.py). */
export class GdbRemoteClient  {
  private ws: WebSocket | null = null;
  private queue = new ByteQueue();
  private managed = false;
  usesGdbControl = false;
  get isManaged(): boolean { return this.managed; }
  private seq = 0;
  private pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
  available = false;
  private lostCbs: (() => void)[] = [];
  private lostFired = false;
  private explicitlyClosed = false;

  constructor(private readonly url: string) {}

  /** Fires once, the first time the WebSocket bridge closes/errors on its own
   *  (not via close()) — an explicit signal the caller can react to instead of
   *  waiting on the liveness poll's next failed ping. */
  onLost(cb: () => void): void {
    this.lostCbs.push(cb);
  }

  private fireLost(): void {
    if (this.lostFired) return;
    this.lostFired = true;
    for (const cb of this.lostCbs) cb();
  }

  async connect(): Promise<void> {
    const ws = new WebSocket(this.url);
    ws.binaryType = "arraybuffer";
    this.ws = ws;
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => { ws.close(); reject(new GdbError("Remote adapter connection timed out")); }, 5000);
      ws.onopen = () => { clearTimeout(timeout); this.available = true; resolve(); };
      ws.onerror = () => { clearTimeout(timeout); reject(new GdbError(`Could not connect to ${this.url}`)); };
      ws.onclose = () => { clearTimeout(timeout); reject(new GdbError("Remote adapter closed during connection")); };
      ws.onmessage = (ev) => {
        if (typeof ev.data === "string") {
          try {
            const message = JSON.parse(ev.data);
            if (message.type === "hello") {
              this.managed = message.backend === "gnwmanager";
              this.usesGdbControl = message.targetControl === "gdb";
            }
            else if (message.id !== undefined) {
              const pending = this.pending.get(message.id);
              this.pending.delete(message.id);
              if (message.error) pending?.reject(new GdbError(message.error));
              else pending?.resolve(message.result);
            }
          } catch (error) { this.fail(new GdbError(`Invalid remote adapter response: ${error}`)); }
        } else this.queue.push(new Uint8Array(ev.data as ArrayBuffer));
      };
    });
    ws.onclose = (event) => this.fail(new GdbError(`Remote adapter connection closed (${event.code}${event.reason ? `: ${event.reason}` : ""})`));
    ws.onerror = () => this.fail(new GdbError("Remote adapter connection error"));
    // The helper sends hello before responding to this harmless GDB capability query.
    // Managed hardware answers without opening a GDB session or halting the target.
    await this.command("qSupported");
    if (this.managed) await this.rpc("attach");
  }

  async reattach(): Promise<void> {
    if (!this.managed) throw new GdbError("Remote backend does not support target reattachment");
    await this.rpc("attach");
  }

  private fail(error: Error): void {
    this.available = false;
    this.queue.close(error);
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
    this.ws?.close();
    if (!this.explicitlyClosed) this.fireLost();
  }

  close(): void {
    this.explicitlyClosed = true;
    this.fail(new GdbError("Remote adapter closed"));
  }

  private async rpc(method: string, args: unknown[] = []): Promise<unknown> {
    if (!this.available || !this.ws) throw new GdbError("Remote adapter is not connected");
    const id = ++this.seq;
    return this.deadline(new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws!.send(JSON.stringify({ id, method, args }));
    }));
  }

  private async deadline<T>(operation: Promise<T>): Promise<T> {
    let timer: ReturnType<typeof setTimeout>;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        const error = new GdbError("Remote adapter request timed out");
        this.fail(error);
        reject(error);
      }, 15000);
    });
    try { return await Promise.race([operation, timeout]); }
    finally { clearTimeout(timer!); }
  }

  private command(cmd: string): Promise<string> { return this.deadline(this.sendCommand(cmd)); }

  private send(bytes: Uint8Array): void {
    if (!this.available || !this.ws) throw new GdbError("Socket is not open");
    this.ws.send(bytes);
  }

  private async readPacketData(): Promise<string> {
    // Assumes '$' was just consumed.
    let reply = "";
    let sum = 0;
    const next = async () => { const byte = await this.queue.readByte(); sum = (sum + byte) & 255; return byte; };
    for (;;) {
      const c = await this.queue.readByte();
      if (c === 0x23) break;
      sum = (sum + c) & 255;
      if (c === 0x7d) reply += String.fromCharCode((await next()) ^ 0x20);
      else if (c === 0x2a) {
        const count = (await next()) - 29;
        if (!reply.length || count < 0) throw new GdbError("Invalid GDB run length");
        reply += reply.at(-1)!.repeat(count);
      } else reply += String.fromCharCode(c);
      if (reply.length > 131072) throw new GdbError("GDB reply exceeds size limit");
    }
    const received = String.fromCharCode(await this.queue.readByte(), await this.queue.readByte());
    if (sum.toString(16).padStart(2, "0") !== received.toLowerCase()) {
      throw new GdbError("GDB reply checksum mismatch");
    }
    this.send(new Uint8Array([0x2b])); // ack '+'
    return reply;
  }

  private async waitForPacket(): Promise<string> {
    for (;;) {
      const c = await this.queue.readByte();
      if (c === 0x24 /* '$' */) return this.readPacketData();
      // ignore anything else before '$' (e.g. stray acks)
    }
  }

  private async sendCommand(cmd: string): Promise<string> {
    const cmdBytes = new TextEncoder().encode(cmd);
    const packet = new Uint8Array(cmdBytes.length + 4);
    packet[0] = 0x24; // '$'
    packet.set(cmdBytes, 1);
    packet[1 + cmdBytes.length] = 0x23; // '#'
    const cs = checksum(cmdBytes);
    packet[2 + cmdBytes.length] = cs.charCodeAt(0);
    packet[3 + cmdBytes.length] = cs.charCodeAt(1);

    this.send(packet);
    for (;;) {
      const ack = await this.queue.readByte();
      if (ack === 0x2b /* '+' */) break;
      if (ack === 0x24 /* '$' */) {
        // Consume asynchronous stop replies without duplicating the command.
        await this.readPacketData();
      }
      if (ack === 0x2d) this.send(packet); // Retransmit only on NAK.
    }

    let reply: string;
    for (;;) {
      reply = await this.waitForPacket();
      // Out-of-band stop replies (T/S/W/X) that we didn't ask for get swallowed
      // unless the command itself was a status query.
      if (/^O[0-9a-fA-F]+$/.test(reply)) continue; // Monitor console output.
      if (cmd === "?" || !/^[TSWX]/.test(reply)) break;
    }
    if (reply.startsWith("E")) throw new GdbError(`GDB error response: ${reply.slice(1)} for command ${cmd}`);
    return reply;
  }

  async readMemory(addr: number, len: number): Promise<Uint8Array> {
    if (!len) return new Uint8Array();
    const reply = this.managed ? String(await this.rpc("read_memory", [addr, len]))
      : await this.command(`m${addr.toString(16)},${len.toString(16)}`);
    const bytes = hexToBytes(reply);
    if (bytes.length !== len) throw new GdbError(`Remote read returned ${bytes.length} bytes, expected ${len}`);
    return bytes;
  }
  async writeMemory(addr: number, data: Uint8Array): Promise<void> {
    if (this.managed) { await this.rpc("write_memory", [addr, bytesToHex(data)]); return; }
    const reply = await this.command(`M${addr.toString(16)},${data.length.toString(16)}:${bytesToHex(data)}`);
    if (reply !== "OK") throw new GdbError(`GDB write failed: ${reply}`);
  }
  async readRegister(name: string): Promise<number> {
    if (this.managed) return Number(await this.rpc("read_register", [name]));
    const bytes = hexToBytes(await this.command(`p${(name.toLowerCase() === "msp" ? 13 : registerNumber(name)).toString(16)}`));
    if (bytes.length !== 4) throw new GdbError(`Invalid register response for ${name}`);
    return new DataView(bytes.buffer).getUint32(0, true);
  }
  async writeRegister(name: string, value: number): Promise<void> {
    if (this.managed) { await this.rpc("write_register", [name, value]); return; }
    const bytes = new Uint8Array(4); new DataView(bytes.buffer).setUint32(0, value, true);
    const reply = await this.command(`P${(name.toLowerCase() === "msp" ? 13 : registerNumber(name)).toString(16)}=${bytesToHex(bytes)}`);
    if (reply !== "OK") throw new GdbError(`GDB register write failed: ${reply}`);
  }
  async halt(): Promise<void> {
    if (this.managed) { await this.rpc("halt"); return; }
    this.send(new Uint8Array([3]));
    await this.deadline(this.waitForPacket());
  }
  async resume(): Promise<void> {
    if (this.managed) { await this.rpc("resume"); return; }
    this.send(new TextEncoder().encode("$c#63"));
    await this.deadline((async () => {
      const ack = await this.queue.readByte();
      if (ack !== 43) throw new GdbError("GDB continue was not acknowledged");
    })());
  }
  async reset(): Promise<void> {
    if (this.managed) { await this.rpc("reset_and_halt"); return; }
    await this.halt();
    const reply = await this.command("qRcmd," + bytesToHex(new TextEncoder().encode("system_reset")));
    if (reply !== "OK") throw new GdbError(`GDB reset failed: ${reply}`);
    await this.halt();
  }
  async setClockFrequency(hz: number): Promise<void> {
    if (this.managed) await this.rpc("set_frequency", [hz]);
  }
}

const REGISTERS: Record<string, number> = {
  r0: 0, r1: 1, r2: 2, r3: 3, r4: 4, r5: 5, r6: 6, r7: 7,
  r8: 8, r9: 9, r10: 10, r11: 11, r12: 12, sp: 13, lr: 14, pc: 15,
  r13: 13, r14: 14, r15: 15, xpsr: 16, msp: 17, psp: 18,
};
function registerNumber(name: string): number {
  const number = REGISTERS[name.toLowerCase()];
  if (number === undefined) throw new GdbError(`Unknown ARM register: ${name}`);
  return number;
}

/** Physical control keeps the shared watchdog protection and delegates target state changes
 * to gnwmanager. OpenOCD's resume commits cached core register writes to hardware.
 * gwmeu delegates directly to GDB; neither path auto-resumes from a timer. */
export class RemoteGdbTransport extends MemoryTransport {
  protected readonly CHUNK = 4096;
  protected readonly MAX_READ_REQUEST = 65536;
  protected readonly READ_INTER_CHUNK_DELAY_MS = 0;
  constructor(readonly client: GdbRemoteClient) { super(); }
  async connect(): Promise<void> {}
  async readWord(addr: number): Promise<number> {
    const bytes = await this.client.readMemory(addr, 4);
    return new DataView(bytes.buffer, bytes.byteOffset, 4).getUint32(0, true);
  }
  async writeWord(addr: number, value: number): Promise<void> {
    const bytes = new Uint8Array(4); new DataView(bytes.buffer).setUint32(0, value, true);
    await this.client.writeMemory(addr, bytes);
  }
  protected _readMemRaw(addr: number, len: number): Promise<Uint8Array> { return this.client.readMemory(addr, len); }
  protected _writeMemRaw(addr: number, bytes: Uint8Array): Promise<void> { return this.client.writeMemory(addr, bytes); }
  protected _readCoreReg(num: number): Promise<number> {
    return this.client.readRegister(Object.keys(REGISTERS).find((name) => REGISTERS[name] === num)!);
  }
  protected _writeCoreReg(num: number, value: number): Promise<void> {
    return this.client.writeRegister(Object.keys(REGISTERS).find((name) => REGISTERS[name] === num)!, value);
  }
  async setClockFrequency(hz: number): Promise<void> { await this.client.setClockFrequency(hz); }
  async halt(): Promise<void> {
    if (this.client.isManaged && !this.client.usesGdbControl) await super.halt();
    await this.client.halt();
  }
  async resume(): Promise<void> {
    // Let the backend commit pending MSP/PC writes before releasing the core.
    await this.client.resume();
    if (this.client.isManaged && !this.client.usesGdbControl) await super.resume();
  }
  async reset(): Promise<void> {
    if (this.client.isManaged && !this.client.usesGdbControl) await super.halt();
    await this.client.reset();
  }
}
