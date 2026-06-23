import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { fileURLToPath } from "node:url";

// The legacy test harness + engine package assets are served by the Express
// backend in dev; Vite proxies those paths to it. (Production = static; none of
// these exist there.)
const LEGACY = "http://localhost:3001";

export default defineConfig({
  // Project GitHub Pages live at /<repo>/. Override to "/" for a custom domain.
  base: process.env.PUBLIC_BASE ?? "/",
  plugins: [svelte()],
  resolve: {
    alias: {
      // ST-Link backend lives in the webstlink submodule (browser ESM source).
      "@webstlink": fileURLToPath(new URL("../../frontend/vendor/webstlink/src", import.meta.url)),
    },
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
    proxy: {
      "/dev": LEGACY,
      "/packages": LEGACY,
      "/api": LEGACY,
    },
    // Allow importing vendored assets from sibling workspace packages.
    fs: { allow: [fileURLToPath(new URL("../..", import.meta.url))] },
  },
});
