// Firmware patching: device auto-detection + genuine-OFW validation, the
// flash-patch option schema, and the real patch+flash flow. Detection/validation
// hash the supplied dumps against gnwmanager's stock-ROM hashes; patchAndFlash
// runs the ported byte-exact engine (@gnw/gnw-patch + WASM liblzma) and flashes
// the result to bank1 (internal) + bank0 (external).

import { withStub } from "./gnw.js";
import { lzmaCompress } from "./lzma.js";

const SHEET_OFFSET = 8192; // mario external hash excludes the trailing save bank

/**
 * Device descriptors. Hashes are gnwmanager's stock-ROM SHA-1s
 * (cli/gnw_patch/{mario,zelda}.py). External hashes are over RAW dump bytes
 * (no decryption needed): Mario hashes ext[:-8192]; Zelda hashes
 * ext[0x20000:0x3254A0]. Options mirror the `flash-patch <model>` CLI flags.
 */
export const DEVICES = {
  mario: {
    name: "MARIO",
    internalSha1: "efa04c387ad7b40549e15799b471a6e1cd234c76",
    externalSha1: "eea70bb171afece163fb4b293c5364ddb90637ae",
    externalSlice: (b) => b.subarray(0, Math.max(0, b.length - SHEET_OFFSET)),
    externalSizeMiB: 1,
    options: [
      { key: "bootloader", type: "bool", label: "SD-card bootloader" },
      { key: "disable_sleep", type: "bool", label: "Disable sleep" },
      { key: "sleep_time", type: "int", label: "Sleep timeout (s, 1–1092)", min: 1, max: 1092, placeholder: "default" },
      { key: "no_save", type: "bool", label: "Disable save (no_save)" },
      { key: "no_mario_song", type: "bool", label: "Remove Mario song" },
      { key: "no_sleep_images", type: "bool", label: "Remove sleep images" },
      { key: "no_smb2", type: "bool", label: "Remove SMB2" },
      { key: "slim", type: "bool", label: "Slim (no song + no sleep images)" },
      { key: "internal_only", type: "bool", label: "Internal-only (no external flash)" },
    ],
  },
  zelda: {
    name: "ZELDA",
    internalSha1: "ac14bcea6e4ff68c88fd2302c021025a2fb47940",
    externalSha1: "1c1c0ed66d07324e560dcd9e86a322ec5e4c1e96",
    externalSlice: (b) => b.subarray(0x20000, 0x3254a0),
    externalSizeMiB: 4,
    options: [
      { key: "bootloader", type: "bool", label: "SD-card bootloader" },
      { key: "no_la", type: "bool", label: "Remove Link's Awakening" },
      { key: "no_sleep_images", type: "bool", label: "Remove sleep images" },
      { key: "no_second_beep", type: "bool", label: "No second beep" },
      { key: "no_hour_tune", type: "bool", label: "No hour tune (beep instead)" },
    ],
  },
};

// Shared "advanced" knobs (apply to both models when bootloader is enabled).
export const BOOTLOADER_OPTIONS = [
  { key: "bootloader_repo", type: "text", label: "Bootloader repo", default: "sylverb/game-and-watch-bootloader" },
  { key: "bootloader_tag", type: "text", label: "Bootloader tag", default: "latest" },
];

const INTERNAL_STOCK_LEN = 0x20000; // 128 KiB stock internal image

async function sha1Hex(bytes) {
  const digest = await crypto.subtle.digest("SHA-1", bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Detect the device model from the internal dump and validate both dumps are
 * genuine stock backups. Returns { model, modelName, internalOk, externalOk,
 * detail } — or model:null when the internal image matches no known stock ROM.
 * @param {Uint8Array} intBytes  internal flash dump
 * @param {Uint8Array} extBytes  external flash dump
 */
export async function detectDevice(intBytes, extBytes) {
  // Stock internal backup is 128 KiB; also tolerate a larger dump by checking
  // its leading 128 KiB so a full-bank dump still identifies the device.
  const intCandidates = [intBytes];
  if (intBytes.length > INTERNAL_STOCK_LEN) intCandidates.push(intBytes.subarray(0, INTERNAL_STOCK_LEN));
  const intHashes = await Promise.all(intCandidates.map(sha1Hex));

  for (const [model, dev] of Object.entries(DEVICES)) {
    if (!intHashes.includes(dev.internalSha1)) continue;

    let externalOk = false;
    let extHash = "(slice out of range)";
    const slice = dev.externalSlice(extBytes);
    if (slice.length > 0) {
      extHash = await sha1Hex(slice);
      externalOk = extHash === dev.externalSha1;
    }

    return {
      model,
      modelName: dev.name,
      internalOk: true,
      externalOk,
      detail: {
        internal: { bytes: intBytes.length, sha1: intHashes[0], match: dev.internalSha1, ok: true },
        external: {
          bytes: extBytes.length,
          expectedSizeMiB: dev.externalSizeMiB,
          sha1: extHash,
          match: dev.externalSha1,
          ok: externalOk,
        },
      },
    };
  }

  return {
    model: null,
    modelName: "UNKNOWN",
    internalOk: false,
    externalOk: false,
    detail: { internalSha1: intHashes[0], note: "internal image matches no known Mario/Zelda stock ROM" },
  };
}

/** Build a byte-exact liblzma compressor from the served WASM module. */
async function loadLiblzma() {
  const createLiblzma = (await import("/packages/gnw-patch/vendor/lzma-wasm/liblzma.mjs")).default;
  const Module = await createLiblzma();
  return (bytes) => {
    const inPtr = Module._malloc(Math.max(1, bytes.length));
    Module.HEAPU8.set(bytes, inPtr);
    const outPtrPtr = Module._malloc(4);
    const outLen = Module._lzma_alone_compress(inPtr, bytes.length, outPtrPtr);
    if (outLen < 0) {
      Module._free(inPtr);
      Module._free(outPtrPtr);
      throw new Error(`liblzma compress failed (${outLen})`);
    }
    const outPtr = Module.getValue(outPtrPtr, "i32");
    const out = Module.HEAPU8.slice(outPtr, outPtr + outLen);
    Module._free(inPtr);
    Module._free(outPtrPtr);
    Module._free(outPtr);
    return out;
  };
}

/**
 * Patch the validated stock dumps and flash the result. Patching runs entirely
 * client-side (the ported engine + WASM liblzma); then the stub is booted and
 * the patched internal/external images are flashed to bank1/bank0.
 * @param {{model:string, intBytes:Uint8Array, extBytes:Uint8Array}} state
 * @param {object} options flash-patch flags
 */
export async function patchAndFlash(state, options, logEl = null, onProgress = null) {
  const log = (msg) => {
    if (logEl) logEl.appendChild(Object.assign(document.createElement("div"), { textContent: msg }));
  };

  log("Loading patch engine + liblzma (WASM)…");
  const [{ patchFirmware }, compress, symbols, novel] = await Promise.all([
    import("/packages/gnw-patch/dist/index.js"),
    loadLiblzma(),
    fetch(`/packages/gnw-patch/vendor/symbols_${state.model}.json`).then((r) => r.json()),
    fetch(`/packages/gnw-patch/vendor/novel_${state.model}.bin`)
      .then((r) => r.arrayBuffer())
      .then((b) => new Uint8Array(b)),
  ]);

  log(`Patching ${state.model} firmware (this runs on-device-free, ~1–3 s)…`);
  const res = patchFirmware({
    model: state.model,
    internal: state.intBytes,
    external: state.extBytes,
    symbols,
    novel,
    compress,
    options,
  });
  log(`Patched: internal ${res.internal.length} B (free ${res.internalFree}); external ${res.external.length} B.`);

  return withStub(logEl, async (flasher, _meta, l) => {
    l("Flashing internal → bank1…");
    await flasher.flash(1, 0, res.internal, { log: l, compress: lzmaCompress, onProgress });
    if (res.external.length) {
      l("Flashing external → bank0…");
      await flasher.flash(0, 0, res.external, { log: l, compress: lzmaCompress, onProgress });
    }
    return {
      ok: true,
      model: state.model,
      internalBytes: res.internal.length,
      externalBytes: res.external.length,
      internalFree: res.internalFree,
      options,
    };
  });
}
