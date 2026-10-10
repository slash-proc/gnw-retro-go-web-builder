import net from "node:net";
import { readFile, rm, writeFile } from "node:fs/promises";
import { deflateSync } from "node:zlib";

const QCODE = {
  A: "x", B: "z", GAME: "g", TIME: "t", PAUSE: "esc", POWER: "p",
  START: "ret", SELECT: "shift_r", UP: "up", DOWN: "down", LEFT: "left", RIGHT: "right",
};

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const name = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crcInput = Buffer.concat([name, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(crcInput));
  return Buffer.concat([length, crcInput, crc]);
}

/** Convert GWemu's P6 QMP screendump to PNG for browser-based report previews. */
export function ppmToPng(ppm) {
  let cursor = 0;
  const token = () => {
    while (cursor < ppm.length) {
      if (ppm[cursor] === 35) {
        while (cursor < ppm.length && ppm[cursor] !== 10) cursor++;
      } else if ([9, 10, 13, 32].includes(ppm[cursor])) cursor++;
      else break;
    }
    const start = cursor;
    while (cursor < ppm.length && ![9, 10, 13, 32, 35].includes(ppm[cursor])) cursor++;
    return ppm.toString("ascii", start, cursor);
  };
  if (token() !== "P6") throw new Error("QMP screenshot is not a binary P6 PPM");
  const width = Number(token());
  const height = Number(token());
  const max = Number(token());
  if (!Number.isInteger(width) || !Number.isInteger(height) || max !== 255 || width < 1 || height < 1) {
    throw new Error("QMP PPM header has unsupported dimensions or color depth");
  }
  if (ppm[cursor] === 13 && ppm[cursor + 1] === 10) cursor += 2;
  else if ([9, 10, 13, 32].includes(ppm[cursor])) cursor++;
  const pixels = ppm.subarray(cursor);
  const rowBytes = width * 3;
  // QEMU/GWemu can pad each RGB row to a 4-byte boundary. Accept both packed
  // PPM and padded rows so captures remain valid across display widths.
  const paddedRowBytes = (rowBytes + 3) & ~3;
  const stride = pixels.length === rowBytes * height ? rowBytes
    : pixels.length === paddedRowBytes * height ? paddedRowBytes : 0;
  if (!stride) throw new Error("QMP PPM pixel data length does not match its header");

  const scanlines = Buffer.alloc(height * (rowBytes + 1));
  for (let y = 0; y < height; y++) {
    const dst = y * (rowBytes + 1);
    scanlines[dst] = 0; // PNG filter type: None
    pixels.copy(scanlines, dst + 1, y * stride, y * stride + rowBytes);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // truecolor RGB
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(scanlines)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

/** Capture QMP's PPM screendump and save a real PNG for Playwright/report viewers. */
export async function captureQmpPng(qmp, ppmPath, pngPath) {
  let png;
  let lastError;
  for (let attempt = 0; attempt < 20; attempt++) {
    await qmp.screenshot(ppmPath);
    try {
      png = ppmToPng(await readFile(ppmPath));
      break;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  if (!png) throw lastError ?? new Error("GWemu screenshot was not ready");
  await writeFile(pngPath, png);
  await rm(ppmPath, { force: true });
}

/** Small QMP client for test controls, independent of the browser's GDB adapter. */
export class QmpDevice {
  constructor(host = "127.0.0.1", port = 4444) {
    this.host = host;
    this.port = port;
    this.nextId = 1;
    this.buffer = "";
    this.pending = new Map();
    this.events = [];
  }

  async connect() {
    this.socket = net.createConnection({ host: this.host, port: this.port });
    this.socket.setEncoding("utf8");
    this.socket.on("data", (chunk) => this.#onData(chunk));
    await new Promise((resolve, reject) => {
      this.socket.once("connect", resolve);
      this.socket.once("error", reject);
    });
    await this.#waitForGreeting();
    await this.#command("qmp_capabilities");
    return this;
  }

  #onData(chunk) {
    this.buffer += chunk;
    for (;;) {
      const at = this.buffer.indexOf("\r\n");
      if (at < 0) break;
      const line = this.buffer.slice(0, at);
      this.buffer = this.buffer.slice(at + 2);
      if (!line) continue;
      const message = JSON.parse(line);
      if (message.QMP) {
        this.greeting = message;
      } else if (message.event) {
        this.events.push(message);
      } else if (message.id && this.pending.has(message.id)) {
        const { resolve, reject } = this.pending.get(message.id);
        this.pending.delete(message.id);
        message.error ? reject(new Error(message.error.desc || message.error.class)) : resolve(message.return);
      }
    }
  }

  async #waitForGreeting() {
    const until = Date.now() + 5000;
    while (!this.greeting && Date.now() < until) await new Promise((resolve) => setTimeout(resolve, 10));
    if (!this.greeting) throw new Error("QMP did not send its greeting");
  }

  #command(execute, arguments_ = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.write(`${JSON.stringify({ execute, arguments: arguments_, id })}\r\n`);
    });
  }

  async press(button, holdMs = 100) {
    const qcode = QCODE[String(button).toUpperCase()];
    if (!qcode) throw new Error(`Unknown Game & Watch button: ${button}`);
    await this.#command("send-key", { keys: [{ type: "qcode", data: qcode }], "hold-time": holdMs });
  }

  async screenshot(path) {
    if (!path) throw new Error("QMP screenshot path is not configured");
    await this.#command("screendump", { filename: path });
  }

  async pressAndRelease(button, holdMs = 100) {
    await this.press(button, holdMs);
  }

  async close() {
    this.socket?.end();
    this.socket = null;
  }
}
