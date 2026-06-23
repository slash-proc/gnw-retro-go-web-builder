/**
 * CORS proxy for gnw-web-builder firmware artifacts (Cloudflare Worker).
 *
 * WHY: GitHub release-asset downloads send no `Access-Control-Allow-Origin`, so the
 * browser flasher can't fetch web-artifacts.zip cross-origin. This worker fetches
 * the asset server-side (no CORS there) and returns it with `ACAO: *`.
 *
 * SECURITY: this is intentionally NOT an open proxy. It will ONLY fetch release
 * assets from the one repo below, and only a fixed allowlist of asset names. An
 * open CORS proxy would let anyone use your worker (and your bandwidth/quota) to
 * fetch arbitrary URLs — never loosen these checks without thinking it through.
 *
 * Usage from the app:  https://<your-worker>.workers.dev/<tag>/<asset>
 *   e.g.               .../web-artifacts-d0bfc4a-mario/web-artifacts.zip
 *
 * Deploy: Cloudflare dashboard → Workers & Pages → Create → paste → Deploy.
 * (Or `wrangler deploy` with the wrangler.toml in this folder.)
 */

// The ONLY repo this proxy will serve. (Switch to upstream's owner/repo once the
// superblock + artifact workflow are merged there.)
const OWNER = "slash-proc";
const REPO = "game-and-watch-retro-go-sd";

// Only these asset names may be proxied.
const ALLOWED_ASSETS = /^(web-artifacts\.zip|manifest\.json)$/;
// Tags are release tags only — letters/digits/._- , no slashes (blocks traversal).
const ALLOWED_TAG = /^[A-Za-z0-9._-]+$/;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Max-Age": "86400",
};

export default {
  async fetch(request) {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: CORS });
    }
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("method not allowed", { status: 405, headers: CORS });
    }

    const url = new URL(request.url);
    const parts = url.pathname.split("/").filter(Boolean); // expect [tag, asset]
    if (parts.length !== 2) {
      return new Response("usage: /<tag>/<asset>", { status: 400, headers: CORS });
    }
    const [tag, asset] = parts;
    if (!ALLOWED_TAG.test(tag) || !ALLOWED_ASSETS.test(asset)) {
      return new Response("forbidden", { status: 403, headers: CORS });
    }

    const ghUrl = `https://github.com/${OWNER}/${REPO}/releases/download/${tag}/${asset}`;
    const upstream = await fetch(ghUrl, {
      method: request.method,
      headers: { "User-Agent": "gnw-web-builder-cors-proxy" },
      redirect: "follow",
      cf: { cacheEverything: true, cacheTtl: 3600 }, // edge-cache the asset
    });

    const headers = new Headers(CORS);
    const ct = upstream.headers.get("content-type");
    if (ct) headers.set("content-type", ct);
    const cl = upstream.headers.get("content-length");
    if (cl) headers.set("content-length", cl);
    const etag = upstream.headers.get("etag");
    if (etag) headers.set("etag", etag);
    headers.set("cache-control", "public, max-age=3600");

    return new Response(upstream.body, { status: upstream.status, headers });
  },
};
