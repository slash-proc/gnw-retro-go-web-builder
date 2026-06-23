/**
 * Test backend — a thin HTTP wrapper around the L3 "pseudo-backend" endpoints
 * (@gnw/builder-core). This exists ONLY to exercise the engine from a browser
 * during early development. It is throwaway: the real product runs the engine
 * entirely client-side (see PLAN.md). Do not build product features on it.
 *
 * USB/SWD flashing cannot run server-side, so flash-path endpoints respond 501.
 */

import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import express from "express";
import {
  resolveBuild,
  listVariants,
  fetchManifest,
  type BuildOptions,
} from "@gnw/builder-core";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND_DIR = path.resolve(__dirname, "../../frontend");
const PACKAGES_DIR = path.resolve(__dirname, "../../packages");
// Dev-only legacy server. The real app is the Vite dev server on :3000, which
// proxies /dev, /packages, /api here. Defaults to an internal port.
const PORT = Number(process.env.PORT ?? 3001);

const app = express();
app.use(express.json({ limit: "2mb" }));

/** Wrap an async handler so stub "not implemented yet" throws become 501s. */
const handle =
  (fn: (req: express.Request) => unknown) =>
  async (req: express.Request, res: express.Response) => {
    try {
      res.json({ ok: true, data: await fn(req) });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const notImpl = /not implemented yet/.test(message);
      res.status(notImpl ? 501 : 400).json({ ok: false, error: message });
    }
  };

app.get("/api/health", (_req, res) => res.json({ ok: true, data: { status: "up" } }));

// Dev debug sink: the browser app POSTs log lines here; they're appended to a file the
// developer can `tail` to watch the UI live. Throwaway dev-only. GET clears the log.
const DEBUG_LOG = "/tmp/gnw-debug.log";
app.post("/api/debug", (req, res) => {
  const lines: string[] = Array.isArray(req.body?.lines) ? req.body.lines : [String(req.body?.line ?? "")];
  const stamp = new Date().toISOString().slice(11, 23);
  try {
    fs.appendFileSync(DEBUG_LOG, lines.map((l) => `${stamp} ${l}`).join("\n") + "\n");
  } catch {
    /* best-effort */
  }
  res.json({ ok: true });
});
app.get("/api/debug/clear", (_req, res) => {
  try {
    fs.writeFileSync(DEBUG_LOG, "");
  } catch {
    /* ignore */
  }
  res.json({ ok: true });
});

// resolveBuild — pure, fully working.
app.post(
  "/api/resolve-build",
  handle((req) => resolveBuild(req.body as BuildOptions)),
);

// Manifest endpoints — stubs (501 until CI manifest exists).
app.get(
  "/api/variants",
  handle(() => listVariants()),
);
app.get(
  "/api/manifest",
  handle(() => fetchManifest()),
);

// Flash / filesystem endpoints — server-side is impossible (no USB); 501 always.
const cannotRunServerSide = (name: string) =>
  handle(() => {
    throw new Error(`${name} not implemented yet (runs client-side only; test stub)`);
  });
app.post("/api/build-filesystem", cannotRunServerSide("buildFilesystem"));
app.post("/api/flash", cannotRunServerSide("flash"));

// Serve the built workspace packages so the throwaway frontend can import them
// directly (e.g. /packages/swd-transport/dist/index.js). Dev-only convenience.
app.use("/packages", express.static(PACKAGES_DIR));

// The throwaway test harness now lives at /dev (Vite proxies it here). Its
// absolute /packages and /api references resolve via the proxy too.
app.use("/dev", express.static(FRONTEND_DIR));

app.listen(PORT, () => {
  console.log(`[backend] test server on http://localhost:${PORT}`);
});
