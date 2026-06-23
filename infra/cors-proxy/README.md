# CORS proxy (Cloudflare Worker)

GitHub release-asset downloads don't send CORS headers, so the browser flasher
can't fetch `web-artifacts.zip` cross-origin. This tiny Worker fetches the asset
server-side and returns it with `Access-Control-Allow-Origin: *`.

It is **locked to one repo and a fixed asset allowlist** (see `worker.js`) — it is
*not* an open proxy. Don't loosen those checks casually.

## Deploy (dashboard — ~5 min, free, no credit card)

1. Sign up / log in at <https://dash.cloudflare.com>.
2. **Workers & Pages → Create → Create Worker.** Give it a name (e.g. `gnw-artifacts`).
   You get a URL like `https://gnw-artifacts.<your-subdomain>.workers.dev`.
3. **Edit code →** paste the contents of [`worker.js`](./worker.js) → **Deploy**.
4. Sanity check (should download the zip with CORS headers):
   ```
   curl -I "https://gnw-artifacts.<your-subdomain>.workers.dev/web-artifacts-d0bfc4a-mario/web-artifacts.zip"
   # expect: access-control-allow-origin: *
   ```
5. Put that base URL in the web app config (the version picker fetches
   `<worker>/<tag>/web-artifacts.zip`). The **version list + metadata** still come
   straight from the GitHub API (which is already CORS-OK) — only the binary goes
   through the proxy.

## Deploy (CLI alternative)

```bash
npm i -g wrangler
wrangler login
cd infra/cors-proxy
wrangler deploy
```

## Free-tier note

Workers free tier is 100k requests/day with no card. Each flash pulls one ~2.4 MB
zip (edge-cached for an hour via `cf.cacheTtl`), so this is comfortably within
limits. The version list/metadata don't hit the worker at all.

## When upstream produces the artifacts

Once the superblock + artifact workflow land in upstream retro-go-sd, change `OWNER`
/`REPO` in `worker.js` (or extend to an allowlist of repos) and redeploy.
