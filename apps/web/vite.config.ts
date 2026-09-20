import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";

// The app's own version, read from this package rather than retyped. `desktop-config.mjs`
// checks it against the desktop packager's copy, since a release filename carries that one.
const { version } = JSON.parse(
  readFileSync(fileURLToPath(new URL("./package.json", import.meta.url)), "utf8"),
) as { version: string };

// The legacy test harness + engine package assets are served by the Express
// backend in dev; Vite proxies those paths to it. (Production = static; none of
// these exist there.)
const LEGACY = "http://localhost:3001";

export default defineConfig({
  // Project GitHub Pages live at /<repo>/. Override to "/" for a custom domain.
  base: process.env.PUBLIC_BASE ?? "/",
  // Which build's persisted data this bundle owns. Empty = production, whose storage names are
  // byte-identical to what they have always been; any other value gives the build a private set
  // of localStorage keys, IndexedDB databases and OPFS directories. See `lib/storageScope.ts`.
  define: {
    __STORAGE_SCOPE__: JSON.stringify(process.env.PUBLIC_STORAGE_SCOPE ?? ""),
    __APP_VERSION__: JSON.stringify(version),
  },
  plugins: [svelte()],
  resolve: {
    alias: [
      // ST-Link backend lives in the webstlink submodule (browser ESM source).
      {
        find: "@webstlink",
        replacement: fileURLToPath(new URL("../../frontend/vendor/webstlink/src", import.meta.url)),
      },
      // Resolve the workspace packages to THIS checkout, not through `node_modules`.
      //
      // Agent worktrees symlink `node_modules` to the main clone's, whose `@gnw/*` entries
      // point back into the MAIN clone's `packages/`. Without this alias a worktree's
      // `vite build` and `svelte-check` silently compile against a different checkout's
      // `dist/` — green gates that prove nothing about the change under test. On the main
      // clone the two paths are the same directory, so this is a no-op there.
      //
      // One rule covers both shapes: every package maps its subpaths 1:1 onto its own
      // directory (`./blobs/*`, `./vendor/*`), and the bare specifier lands on the package
      // directory itself, resolved via its `package.json`.
      {
        find: /^@gnw\/(.*)$/,
        replacement: fileURLToPath(new URL("../../packages/", import.meta.url)) + "$1",
      },
    ],
  },
  server: {
    host: true, // reachable from outside the container
    port: 3000,
    strictPort: true,
    // Dev only: accept any Host header so the server is reachable by whatever name the machine
    // resolves to (gnw-builder, gnw-builder.local mDNS, a LAN IP, etc.) without 403s. This is the
    // dev server, not production.
    allowedHosts: true,
    // Behind the nginx TLS proxy (PROXY_TLS=1), the page is https on :443, so the HMR client must
    // use wss on :443 (not ws on :3000, which mixed-content-fails on an https origin). Without the
    // proxy, leave HMR at its defaults for direct http://localhost:3000.
    hmr: process.env.PROXY_TLS ? { protocol: "wss", clientPort: 443 } : undefined,
    // Podman on macOS forwards the repository through a Linux VM, where host file
    // changes do not always produce inotify events. Polling keeps HMR reliable.
    watch: { usePolling: true, interval: 100 },
    proxy: {
      "/dev": LEGACY,
      "/packages": LEGACY,
      "/api": LEGACY,
    },
    // Allow importing vendored assets from sibling workspace packages.
    fs: { allow: [fileURLToPath(new URL("../..", import.meta.url))] },
  },
});
