import { readFileSync } from "node:fs";
/**
 * flashImage()'s retry composition (apps/web/src/lib/engine/flasher.ts).
 *
 * There are now THREE nested retries on the flash path and the whole point of the
 * BAD_HASH_FLASH work is that they must not multiply:
 *
 *   1. tryChunkRetry()          — gnw-flasher, the BAD_HASH_RAM_COMPRESSED handshake
 *   2. MAX_FLASH_HASH_ATTEMPTS  — gnw-flasher's program(), 3 attempts per 256KiB block
 *   3. flashImage()'s loop      — here, 3 attempts per REGION, each rebooting the RAM stub
 *
 * (3) must NOT wrap (2): a FlashVerifyError is a failure the device has already reported
 * three times, and every outer attempt costs a stub reboot, i.e. a device reset. The rethrow
 * that enforces this lived only in a comment until this suite existed — flashinstall.mjs
 * stubs ./flasher.js away wholesale, so nothing exercised the real module.
 *
 * The flasher is a hand-rolled fake; no device, no transport, no LZMA.
 */
import { mkdtempSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { gnwImport, gnwResolveFor } from "./gnwResolve.mjs";

let passed = 0;
const failures = [];
const check = (name, fn) =>
  Promise.resolve()
    .then(fn)
    .then(() => void passed++, (e) => void failures.push(`${name}: ${(e && e.message) || e}`));
function eq(a, b, msg) {
  if (a !== b) throw new Error(`${msg || "not equal"}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
}
function assert(c, msg) { if (!c) throw new Error(msg || "assertion failed"); }

const here = dirname(fileURLToPath(import.meta.url));
const out = mkdtempSync(join(tmpdir(), "gnw-flashretry-"));
symlinkSync(join(here, "../../../node_modules"), join(out, "node_modules"));

const esbuild = await import("esbuild");
await esbuild.build({
  entryPoints: [join(here, "../src/lib/engine/flasher.ts")],
  outdir: out,
  bundle: true,
  format: "esm",
  platform: "neutral",
  target: "es2022",
  external: ["@gnw/*"],
  logLevel: "warning",
  plugins: [
    gnwResolveFor(import.meta.url),
    {
      // Vite `?url` assets (the stub firmware blob). Never fetched: nothing here boots a stub.
      name: "url-assets",
      setup(b) {
        b.onResolve({ filter: /\?url$/ }, (a) => ({ path: a.path, namespace: "u" }));
        b.onLoad({ filter: /.*/, namespace: "u" }, (a) => ({
          contents: `export default ${JSON.stringify("asset:" + a.path)};`,
          loader: "js",
        }));
      },
    },
    {
      // engine/lzma.ts injects a <script> and waits on window.LZMA. flashImage() awaits
      // preloadLzma() before the loop; the compressor itself is never reached (the fake
      // flasher never calls the compress callback).
      name: "stub-lzma",
      setup(b) {
        b.onResolve({ filter: /^\.\/lzma\.js$/ }, () => ({ path: "lzma-stub", namespace: "st" }));
        b.onLoad({ filter: /^lzma-stub$/, namespace: "st" }, () => ({
          contents:
            `export async function preloadLzma(){}\n` +
            `export function lzmaCompress(){ throw new Error("lzmaCompress must not be reached"); }`,
          loader: "js",
        }));
      },
    },
  ],
});
const { flashImage } = await import(pathToFileURL(join(out, "flasher.js")).href);
const { FlashVerifyError } = await gnwImport(import.meta.url, "gnw-flasher");

/**
 * `MAX_DEAD_HANDLE_RETRIES`, read from the source rather than restated.
 *
 * It was raised from 2 when acquiring a flasher started being able to report a dead handle too
 * (it resets the target and writes the stub, so it needs the link as much as the flash does).
 * Hardcoding it here meant two suites had to be edited to match a number whose whole purpose is
 * to be tuned, and a wrong copy would have read as a behaviour change.
 */
const DEAD_HANDLE_BUDGET = Number(
  readFileSync(new URL("../src/lib/engine/flasher.ts", import.meta.url), "utf8")
    .match(/MAX_DEAD_HANDLE_RETRIES = (\d+)/)?.[1],
);
if (!Number.isInteger(DEAD_HANDLE_BUDGET)) {
  console.log("  x cannot read MAX_DEAD_HANDLE_RETRIES out of engine/flasher.ts");
  process.exit(1);
}

const DATA = new Uint8Array(64);

/** A GnwFlasher-shaped fake whose flash() throws `mk(attempt)`; counts the calls. */
function fakeFlasher(mk) {
  const calls = { flash: 0, getter: 0, forced: [] };
  const flasher = {
    async flash() {
      calls.flash += 1;
      const e = mk(calls.flash);
      if (e) throw e;
    },
  };
  const getter = async (force) => {
    calls.getter += 1;
    calls.forced.push(force);
    return flasher;
  };
  return { calls, flasher, getter };
}

const verifyError = () =>
  new FlashVerifyError(
    [{ bank: 0, offset: 0x100000, address: 0x90100000, size: 8192, blockIndex: 4, expectedHash: "aa", actualHash: "bb" }],
    3,
  );

await check("a FlashVerifyError is rethrown immediately — the outer loop must not re-flash the region", async () => {
  const { calls, getter } = fakeFlasher(() => verifyError());
  let err = null;
  await flashImage(getter, 0, 0, DATA, undefined, undefined, { compress: false }).catch((e) => (err = e));
  assert(err instanceof FlashVerifyError, `expected the FlashVerifyError itself, got ${err}`);
  eq(calls.flash, 1, "flash() attempts");
  eq(calls.getter, 1, "stub acquisitions (each >1 would be a device reset)");
  eq(calls.forced[0], false, "the single acquisition must not force a reboot");
});

await check("the block identity survives the rethrow intact, so the caller can render it", async () => {
  const { getter } = fakeFlasher(() => verifyError());
  let err = null;
  await flashImage(getter, 0, 0, DATA, undefined, undefined, { compress: false }).catch((e) => (err = e));
  eq(err.blocks.length, 1, "block count");
  eq(err.blocks[0].blockIndex, 4, "block index");
  eq(err.blocks[0].address, 0x90100000, "address");
  eq(err.attempts, 3, "attempts reported by the inner budget");
});

await check("worst case is 3 program attempts, not 9: the two loops never compose", async () => {
  // If the rethrow were dropped, this fake would be asked to flash 3 times, each of those
  // standing for a block that had already been programmed 3 times inside program().
  const { calls, getter } = fakeFlasher(() => verifyError());
  await flashImage(getter, 0, 0, DATA, undefined, undefined, { compress: false }).catch(() => {});
  eq(calls.flash, 1, "outer region attempts for a verify failure");
});

await check("an ORDINARY error still gets the full 3-attempt region retry, each forcing a stub reboot", async () => {
  const { calls, getter } = fakeFlasher(() => new Error("WebUSB fell over"));
  let err = null;
  await flashImage(getter, 0, 0, DATA, undefined, undefined, { compress: false }).catch((e) => (err = e));
  assert(!(err instanceof FlashVerifyError) && /WebUSB fell over/.test(String(err)), `wrong error: ${err}`);
  eq(calls.flash, 3, "flash() attempts");
  eq(calls.forced.join(","), "false,true,true", "attempts 2 and 3 force a stub reboot");
});

await check("a dead USBDevice handle retries for a NEW one, then gives up", async () => {
  // Chrome's exact shape: a DOMException named InvalidStateError. Nothing re-opens THAT handle,
  // so retrying on the same flasher is pointless -- the original report was a loop that never
  // ended, one device-resetting stub reboot per attempt.
  //
  // But the common way to reach it is a real mid-flash USB drop, after which the store tears
  // down and reconnects and a FRESH flasher exists. Throwing at once turned that recoverable
  // reconnect into a failed install (seen at the second FrogFS chunk). So it retries a bounded
  // number of times through the getter, and then gives up: the budget is what stops the loop,
  // not a refusal to retry at all.
  const dead = () => Object.assign(new Error("Failed to execute 'transferOut' on 'USBDevice': The device must be opened first."), { name: "InvalidStateError" });
  const { calls, getter } = fakeFlasher(() => dead());
  let err = null;
  await flashImage(getter, 0, 0, DATA, undefined, undefined, { compress: false, reconnectWaitMs: 0 })
    .catch((e) => (err = e));
  assert(err && err.name === "InvalidStateError", `expected the InvalidStateError itself, got ${err}`);
  eq(calls.flash, 1 + DEAD_HANDLE_BUDGET, "flash() attempts: the initial one plus the dead-handle budget");
  assert(calls.flash < 10, "it must terminate rather than loop on a handle nothing reopens");
});

await check("a dead handle asks for a FRESH stub, not the cached one", async () => {
  // THE BUG. The dead-handle path does `attempt--`, so a dropped link does not spend the
  // wedged-stub budget. But the getter is called as `flasherOrGetter(attempt > 1)`, so
  // decrementing back to 1 also cleared the force flag -- and the one case that most needs a
  // new stub asked for the CACHED one, which is bound to the handle that just closed. The
  // store answered "reusing cached flasher (alive + context free)" and the retry failed
  // instantly with "The device must be opened first", twice, then the install failed.
  //
  // Every acquisition AFTER a dead handle must force. The first one must not: forcing there
  // would reset the device on a link that is fine.
  const dead = () => Object.assign(new Error("The device must be opened first."), { name: "InvalidStateError" });
  const { calls, getter } = fakeFlasher(() => dead());
  await flashImage(getter, 0, 0, DATA, undefined, undefined, { compress: false, reconnectWaitMs: 0 })
    .catch(() => {});
  eq(calls.forced[0], false, "the first acquisition must not reset a device whose link is fine");
  assert(calls.forced.length >= 3, `expected an acquisition per attempt, got ${calls.forced.length}`);
  eq(calls.forced.slice(1).every((f) => f === true), true,
    `every acquisition after a dead handle must force a fresh stub, got ${JSON.stringify(calls.forced)}`);
});

await check("a drop while ACQUIRING the flasher is retried, not fatal", async () => {
  // THE SECOND HALF OF THE SAME BUG, and the one that made an install fail harder than before.
  // Getting a flasher is itself a device operation: forcing a fresh stub resets the target and
  // writes the 48 KB stub over the link. On a handle that just closed, that throws the same
  // dead-handle error -- and the acquisition sat OUTSIDE the try, so it escaped the handler
  // written for it. Observed: "Waiting for the link, then retrying (1/2)", eight seconds, then
  // the install died with no second attempt.
  //
  // Here the first flash drops the link, and every subsequent ACQUISITION throws dead twice
  // before succeeding. The flash must still happen.
  const dead = () => Object.assign(new Error("The device must be opened first."), { name: "InvalidStateError" });
  let flashes = 0;
  let acquisitions = 0;
  const flasher = {
    async flash() { flashes++; if (flashes === 1) throw dead(); },
  };
  const getter = async () => {
    acquisitions++;
    if (acquisitions === 2 || acquisitions === 3) throw dead(); // the link is not back yet
    return flasher;
  };
  let err = null;
  await flashImage(getter, 0, 0, DATA, undefined, undefined, { compress: false, reconnectWaitMs: 0 })
    .catch((e) => (err = e));
  assert(err === null, `a recoverable drop while acquiring must not fail the install, got ${err}`);
  eq(flashes, 2, "the flash must be attempted again once a flasher could be had");
});

await check("a dead handle does not consume the ORDINARY retry budget", async () => {
  // The two failures are different and must not exhaust one another: a link that drops twice
  // and then wedges still gets its ordinary attempts. Here the handle dies twice, then every
  // later call fails ordinarily -- 3 ordinary attempts must still follow the 2 dead-handle ones.
  const dead = () => Object.assign(new Error("The device must be opened first."), { name: "InvalidStateError" });
  let n = 0;
  const { calls, getter } = fakeFlasher(() => (++n <= 2 ? dead() : new Error("WebUSB fell over")));
  let err = null;
  await flashImage(getter, 0, 0, DATA, undefined, undefined, { compress: false, reconnectWaitMs: 0 })
    .catch((e) => (err = e));
  assert(/WebUSB fell over/.test(String(err)), `expected the ordinary error last, got ${err}`);
  eq(calls.flash, 5, "flash() attempts: 2 dead-handle retries plus the full 3-attempt budget");
});

await check("a disconnected device (NotFoundError) takes the same bounded path", async () => {
  const gone = () => Object.assign(new Error("The device was disconnected."), { name: "NotFoundError" });
  const { calls, getter } = fakeFlasher(() => gone());
  await flashImage(getter, 0, 0, DATA, undefined, undefined, { compress: false, reconnectWaitMs: 0 }).catch(() => {});
  eq(calls.flash, 1 + DEAD_HANDLE_BUDGET, "flash() attempts: the initial one plus the dead-handle budget");
});

await check("an ordinary error that clears on a retry still succeeds", async () => {
  const { calls, getter } = fakeFlasher((n) => (n === 1 ? new Error("transient") : null));
  await flashImage(getter, 0, 0, DATA, undefined, undefined, { compress: false });
  eq(calls.flash, 2, "flash() attempts");
});

console.log(`\nflashretry: ${passed} checks passed${failures.length ? `, ${failures.length} failed` : ""}`);
for (const f of failures) console.log("FAIL: " + f);
if (failures.length) process.exit(1);
