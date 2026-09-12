// run.js — cover scraping orchestration (no DOM dependencies).
import { stem, canvasToBlob, downloadBlob, formatBytes, ext } from "./util.js";
import { SOFTNAME, SINGLE_MEDIA, devCreds, IMAGE_EXT } from "./config.js";
import { systemById } from "./systems.js";
import { allSystems } from "./systemMap.js";
import { RateLimiter } from "./rate-limiter.js";
import { createHashers, hashFile } from "./hashing.js";
import { ScreenScraperClient, FatalError } from "./screenscraper.js";
import { MixResolver, renderComposition, isValidMix, gameRegionsFor } from "./mix-engine.js";
import { BUILTIN_MIXES } from "./mixes.js";
import { buildPlan } from "./scanner.js";
import { cache } from "./cache.js";
import { toGWCover, gwOutputName, MAX_BYTES as GW_MAX_BYTES } from "./gw.js";
import { t } from "./i18n.js";


function readCreds(ssid, sspassword) {
  const c = { ...devCreds(), softname: SOFTNAME };
  if (ssid?.trim()) {
    c.ssid = ssid.trim();
    c.sspassword = sspassword?.trim() || "";
  }
  return c;
}

/**
 * The name to send as `romnom` for one system.
 *
 * ScreenScraper validates the filename's EXTENSION against the extensions that system declares,
 * and 404s the whole lookup when it does not recognise it -- the same 404 it returns for a game
 * it has never heard of, which is why this read as "no result". Game & Watch (52) declares only
 * `mgw`, so every `.gw` file Retro-Go uses was refused, while `.gba` sailed through because 12
 * declares `gba,bin`.
 *
 * So: send the full filename when the system claims that extension, and the bare stem when it
 * does not. `Ball.gw` 404s; `Ball` is found. Sending the stem up front rather than retrying on
 * the 404 costs no extra request, which matters on the anonymous rate.
 *
 * A system with no declared extensions at all (11 of the 250) gets the stem too: we cannot know
 * what it accepts, and the stem is the form that works more often.
 */
function romnomFor(fileName, systemeid) {
  const dot = fileName.lastIndexOf(".");
  if (dot <= 0) return fileName;
  const ext = fileName.slice(dot + 1).toLowerCase();
  const declared = systemById(systemeid)?.extensions ?? [];
  return declared.includes(ext) ? fileName : fileName.slice(0, dot);
}

async function fetchMediaBlob(client, url, useCache) {
  if (useCache) {
    const cached = await cache.getMedia(url).catch(() => null);
    if (cached) return cached;
  }
  const r = await client.get(url);
  if (!r.ok) return null;
  const blob = await r.blob();
  if (blob.type && blob.type.startsWith("text")) return null;
  if (useCache) await cache.setMedia(url, blob).catch(() => {});
  return blob;
}

function makeImageFetcher(client, useCache) {
  return async (url) => {
    try {
      const blob = await fetchMediaBlob(client, url, useCache);
      return blob ? await createImageBitmap(blob) : null;
    } catch (e) {
      if (e instanceof FatalError || e?.name === "AbortError") throw e;
      return null;
    }
  };
}

// Standalone utility (no API, fully local): convert existing cover images
// (.png/.jpg/.jpeg/.bmp) found anywhere in a folder into Game & Watch retro-go
// ".img" covers, preserving the original folder structure. Triggers a zip
// download and returns { ok, fail, total }.
export async function convertImagesToGW(files, cb = {}) {
  const { onProgress, onLog, shouldCancel } = cb;
  const sortOpts = { numeric: true, sensitivity: "base" };

  const imgs = (files || [])
    .filter((f) => {
      const parts = f.webkitRelativePath.split("/");
      if (parts.some((p) => p.startsWith("."))) return false; // hidden files/folders
      return IMAGE_EXT.has(ext(f.name));
    })
    .sort((a, b) => {
      const da = a.webkitRelativePath.split("/").slice(0, -1).join("/");
      const db = b.webkitRelativePath.split("/").slice(0, -1).join("/");
      if (da !== db) return da.localeCompare(db, undefined, sortOpts);
      return a.name.localeCompare(b.name, undefined, sortOpts);
    });

  if (!imgs.length) return { ok: 0, fail: 0, total: 0 };

  const zip = new window.JSZip();
  let ok = 0;
  let fail = 0;
  let done = 0;
  for (const f of imgs) {
    if (shouldCancel?.()) break;
    try {
      const out = await toGWCover(f); // a File is a Blob
      const parts = f.webkitRelativePath.split("/");
      // Mirror the source tree (minus the picked root), just swap the extension.
      const name = [...parts.slice(1, -1), stem(f.name) + ".img"].join("/");
      zip.file(name, out);
      if (out.size > GW_MAX_BYTES) onLog?.(t("gwTooBig", { name: f.name, size: formatBytes(out.size) }));
      ok++;
    } catch (e) {
      onLog?.(t("errGeneric", { name: f.name, msg: e.message }));
      fail++;
    }
    done++;
    onProgress?.(done, imgs.length);
  }

  if (ok > 0) downloadBlob(await zip.generateAsync({ type: "blob" }), "covers.zip");
  return { ok, fail, total: imgs.length };
}

// --- Manual search & assign (for the misses list) ----------------------------

function gameDisplayName(jeu) {
  if (!jeu) return "?";
  if (typeof jeu.nom === "string" && jeu.nom.trim()) return jeu.nom.trim();
  const noms = jeu.noms;
  if (Array.isArray(noms)) {
    for (const reg of ["ss", "wor", "us", "eu", "jp", "fr"]) {
      const m = noms.find((n) => n && n.region === reg && (n.text || n.nom));
      if (m) return m.text || m.nom;
    }
    const any = noms.find((n) => n && (n.text || n.nom));
    if (any) return any.text || any.nom;
  } else if (noms && typeof noms === "object") {
    const v =
      noms.nom_eu || noms.nom_us || noms.nom_wor || noms.nom_jp ||
      Object.values(noms).find((x) => typeof x === "string" && x.trim());
    if (v) return v;
  }
  return "?";
}

function gameThumb(client, jeu) {
  for (const ty of ["box-2D", "mixrbv1", "mixrbv2", "ss", "wheel"]) {
    const m = client.pickMedia(jeu, ty);
    if (m) return m.url;
  }
  return null;
}

// Search games by name on ScreenScraper. Returns lightweight results:
// [{ gameId, name, systemId, systemName, thumb, jeu }].
export async function searchGames({ query, systemeid, ssid, sspassword }) {
  const client = new ScreenScraperClient({
    creds: readCreds(ssid, sspassword),
    limiter: new RateLimiter(20),
  });
  const jeux = await client.jeuRecherche({ recherche: query, systemeid: systemeid || undefined });
  if (jeux[0]) console.debug("[search] sample result:", jeux[0]);
  return jeux
    .slice(0, 20)
    .map((jeu) => ({
      gameId: String(jeu.id ?? jeu.jeuid ?? ""),
      name: gameDisplayName(jeu),
      systemId: parseInt(jeu?.systeme?.id, 10) || null,
      systemName: jeu?.systeme?.text || jeu?.systeme?.nom || "",
      thumb: gameThumb(client, jeu),
      jeu,
    }))
    // Drop empty/garbage entries (some "no result" responses include a blank one).
    .filter((r) => r.gameId || (r.name && r.name !== "?"));
}

/**
 * The lookup ladder: try in order, stop at the first hit, and say which rung answered.
 *
 * The owner: "that's the fallback. we'll expand the cover thing at some point but we just go
 * down the list of reliability until we find something. if originalSystem and/or originalName
 * are set, they take precedence."
 *
 *   1 DECLARED   the manifest's `originalSystem` / `originalName`. Either may be set without the
 *                other, so each is applied independently: a declared NAME is looked up against
 *                the folder's systems, a declared SYSTEM is looked up with the filename. Hashes
 *                ride along, because ScreenScraper matches a known hash ahead of the name -- the
 *                one place where "declared wins" and "a hash is stronger" do not conflict.
 *   2 DERIVED    what the app has always done: the folder's systems, `romnomFor(filename)`, and
 *                the hashes.
 *   3 SCOPED     `jeuRecherche` inside ONE system: the declared one if there is one, else each
 *                folder-derived candidate. A hit counts only for that system.
 *   4 UNSCOPED   `jeuRecherche` with no system at all. This rung CAN BE CONFIDENTLY WRONG:
 *                "mine sweeper" returns 15 hits across Master System, Atari 2600, Atari ST and
 *                Atari 8bit, and none of them is the owner's Game & Watch homebrew. It is taken
 *                rather than dead-ending, which is why every result carries the rung that found
 *                it and why rung 4 is reported as a guess wherever the cover is shown.
 *
 * A SEARCH TERM IS NOT A FILENAME, so rungs 3 and 4 do not use `romnomFor` -- that helper strips
 * an extension a system does not declare, which is meaningless for a search. They send the
 * declared name if there is one, else the filename's stem.
 *
 * Returns `{ jeu, rung, httpError }`. `jeu` null with no `httpError` is an honest miss.
 */
async function lookupGame(client, rom, { h, forceSys, forceName, shouldCancel }) {
  const derived = rom.derivedIds?.length ? rom.derivedIds : rom.systemeids;
  const withHashes = (params) => {
    if (h.size > 0) {
      params.romtaille = h.size;
      params.crc = h.crc;
      params.md5 = h.md5;
      params.sha1 = h.sha1;
    }
    return params;
  };
  let httpError = null;

  /** One `jeuInfos` call. Returns the game, or null. Records a non-404 HTTP failure. */
  const infos = async (systemeid, romnom) => {
    const r = await client.jeuInfos(withHashes({ systemeid, romtype: "rom", romnom }));
    if (r.ok) {
      try { return (await r.json()).response.jeu ?? null; } catch { return null; }
    }
    if (r.status !== 404) httpError = r.status;
    return null;
  };

  /** One `jeuRecherche`, then the full record by id -- search results are too thin to build a cover from. */
  const search = async (recherche, systemeid) => {
    const hits = await client.jeuRecherche({ recherche, ...(systemeid ? { systemeid } : {}) });
    const first = hits && hits[0];
    if (!first) return null;
    const r = await client.jeuInfos({ gameid: first.id ?? first.jeuid });
    if (!r.ok) return null;
    try { return (await r.json()).response.jeu ?? null; } catch { return null; }
  };

  // 1. DECLARED. Skipped entirely when the manifest said nothing, which is the normal case.
  if (forceSys || forceName) {
    const ids = forceSys ? [forceSys] : derived;
    for (const sid of ids) {
      if (shouldCancel() || httpError) break;
      const jeu = await infos(sid, forceName || romnomFor(rom.file.name, sid));
      if (jeu) return { jeu, rung: "declared", httpError: null };
    }
  }

  // 2. DERIVED. The folder's own answer, with the filename.
  for (const sid of derived) {
    if (shouldCancel() || httpError) break;
    // Already asked exactly this on rung 1; do not spend the request twice.
    if (forceSys === sid && !forceName) continue;
    const jeu = await infos(sid, romnomFor(rom.file.name, sid));
    if (jeu) return { jeu, rung: "derived", httpError: null };
  }
  if (httpError) return { jeu: null, rung: null, httpError };

  const term = forceName || rom.file.name.replace(/\.[^/.]+$/, "");

  // 3. SCOPED SEARCH. The declared system if there is one, else each folder candidate.
  for (const sid of forceSys ? [forceSys] : derived) {
    if (shouldCancel()) break;
    const jeu = await search(term, sid);
    if (jeu) return { jeu, rung: "scoped", httpError: null };
  }

  // 4. UNSCOPED SEARCH. The last rung, and the one that can be confidently wrong.
  if (!shouldCancel()) {
    const jeu = await search(term, null);
    if (jeu) return { jeu, rung: "unscoped", httpError: null };
  }

  return { jeu: null, rung: null, httpError: null };
}

async function buildCoverFromJeu(client, jeu, { source, mixFile, useCache, fileName }) {
  if (source.startsWith("mix")) {
    const mixXml = source === "mixcustom" ? await mixFile.text() : BUILTIN_MIXES[source];
    if (!isValidMix(mixXml)) return null;
    const fetchImage = makeImageFetcher(client, useCache);
    const gameRegions = gameRegionsFor(fileName, jeu);
    const resolver = new MixResolver(jeu, fetchImage, undefined, gameRegions);
    const canvas = await renderComposition(mixXml, resolver);
    if ([...resolver.cache.values()].filter(Boolean).length === 0) return null;
    return { blob: await canvasToBlob(canvas, "image/png"), ext: "png" };
  }
  const mediaType = SINGLE_MEDIA[source] || "ss";
  const media = client.pickMedia(jeu, mediaType);
  if (!media) return null;
  const blob = await fetchMediaBlob(client, media.url, useCache);
  if (!blob) return null;
  return { blob, ext: (media.format || "png").toLowerCase() };
}

// Build the cover for a chosen search result, with the same source/convert
// settings as a normal run. Returns { previewBlob, zipBlob, outputPath } | null.
// previewBlob = original cover (for the gallery), zipBlob = what goes to disk.
// We re-fetch the full game record by id (jeuRecherche results are lightweight
// and often lack the medias needed to compose the cover).
export async function assignCover({ gameId, jeu, source, mixFile, useCache, convert, ssid, sspassword, parts, fileName }) {
  const client = new ScreenScraperClient({
    creds: readCreds(ssid, sspassword),
    limiter: new RateLimiter(20),
  });
  let full = jeu;
  if (gameId) {
    try {
      const r = await client.jeuInfos({ gameid: gameId });
      if (r.ok) {
        const j = (await r.json()).response.jeu;
        if (j) full = j;
      }
    } catch (e) {}
  }
  const built = await buildCoverFromJeu(client, full, { source, mixFile, useCache, fileName });
  if (!built) return null;
  const baseName = fileName.replace(/\.[^/.]+$/, "");
  let zipBlob = built.blob;
  let outputPath;
  if (convert === "gw") {
    zipBlob = await toGWCover(built.blob);
    outputPath = gwOutputName(parts, baseName);
  } else {
    outputPath = [...parts.slice(1, -1), baseName + "." + built.ext].join("/");
  }
  return { previewBlob: built.blob, zipBlob, outputPath };
}

// Read the account quota without running a scrape (for the live display).
export async function fetchAccount(ssid, sspassword) {
  const creds = readCreds(ssid, sspassword);
  const client = new ScreenScraperClient({ creds, limiter: new RateLimiter(20) });
  return client.userQuota(); // { status, perMin, perDay, today }
}

export async function loadSystems() {
  // The committed snapshot answers this: no network, no quota, no cache. It used to keep its
  // OWN `coverstudio.systems` localStorage key -- unscoped, so a /wip/ build wrote it into
  // production's storage, and with no expiry, so the first fetch was final. Refreshing the
  // snapshot is `scripts/fetch-ss-systems.mjs`, run deliberately, not per page load.
  return allSystems();
}

/**
 * @param {object} opts
 * @param {File[]} opts.files
 * @param {string} opts.source
 * @param {File|null} opts.mixFile
 * @param {boolean} opts.useCache
 * @param {string} opts.convert — "none" | "gw"
 * @param {string} opts.ssid
 * @param {string} opts.sspassword
 * @param {boolean} opts.skipExisting
 * @param {number|null} opts.forceSys
 * @param {string|null} [opts.forceName] The manifest's `originalName`, used AS GIVEN.
 * @param {object} cb
 * @param {(msg: string) => void} cb.onLog
 * @param {(done: number, total: number) => void} cb.onProgress
 * @param {(text: string) => void} cb.onStatus
 * @param {(cover: { id: string, name: string, blob: Blob, outputPath: string }) => void} cb.onCover
 * @param {(miss: { id: string, name: string, reason: string }) => void} [cb.onMiss]
 * @param {() => boolean} cb.shouldCancel
 */
export async function runCovers(opts, cb) {
  const {
    files,
    source,
    mixFile,
    useCache,
    convert,
    ssid,
    sspassword,
    skipExisting,
    forceSys,
    forceName,
  } = opts;
  const { onLog, onProgress, onStatus, onCover, onMiss, shouldCancel, signal, onAccount } = cb;

  const isMix = source.startsWith("mix");
  const creds = readCreds(ssid, sspassword);
  const hasAccount = !!(creds.ssid && creds.sspassword);
  const limiter = new RateLimiter(20);
  const client = new ScreenScraperClient({ creds, limiter, signal });
  const fetchImage = makeImageFetcher(client, useCache);

  let q = await client.userQuota();
  if (hasAccount && q.status === "bad") {
    // DEGRADE TO ANONYMOUS, DO NOT ABORT. ScreenScraper authenticates on the DEVELOPER
    // credentials; a user account only raises the quota and thread count. This returned
    // `{ error: "badAccount" }` before a single ROM was touched, so one stale saved password
    // stopped every cover for every console -- and because the panel renders any miss as
    // "Cover not found.", nothing said the login was the reason. The owner hit exactly this:
    // a username saved long ago, a password he no longer had, and no way to tell from the UI.
    //
    // A wrong password is not a reason to refuse work we can do without one. Say so plainly,
    // drop the login, and carry on at the anonymous rate.
    onLog(t("badAccount"));
    onLog(t("anonFallback"));
    delete creds.ssid;
    delete creds.sspassword;
    client.creds = creds;
    q = await client.userQuota();
  }
  if (q?.perMin) {
    limiter.max = Math.max(1, q.perMin); // full per-minute rate, no safety margin
    onLog(`rate: ${q.perMin} req/min · quota ${q.today ?? 0}/${q.perDay ?? "?"} today`);
  }
  onAccount?.({
    perMin: q?.perMin ?? null,
    perDay: q?.perDay ?? null,
    today: q?.today ?? null,
    used: q?.today ?? 0,
  });

  const { roms, totalFiles } = buildPlan(files, { skipExisting, forceSys });
  onLog(t("plan", { total: totalFiles, count: roms.length, source }));

  const mixXml = source === "mixcustom"
    ? await mixFile.text()
    : isMix ? BUILTIN_MIXES[source] : null;

  if (isMix && !isValidMix(mixXml)) {
    onLog(t("mixInvalid"));
    return { error: "mixInvalid" };
  }

  const hashers = await createHashers();
  let coverSeq = 0;
  let missSeq = 0;

  const reportMiss = (rom, reason) => {
    onMiss?.({
      id: `miss:${missSeq++}:${rom.file.name}`,
      name: rom.file.name,
      reason,
      systemeid: rom.systemeid,
      systemeids: rom.systemeids,
      sysShort: rom.sysShort,
      parts: rom.parts,
    });
  };

  async function addCover(rom, blob, defaultName) {
    let out = blob;
    let name = defaultName;
    if (convert === "gw") {
      out = await toGWCover(blob);
      name = gwOutputName(rom.parts, stem(rom.file.name));
      if (out && out.size > GW_MAX_BYTES)
        onLog(t("gwTooBig", { name: rom.file.name, size: formatBytes(out.size) }));
    }

    onCover({
      id: `${coverSeq++}:${rom.file.name}`,
      name: rom.file.name,
      blob,
      outputPath: name,
      systemeid: rom.systemeid,
      sysShort: rom.sysShort,
      // WHICH RUNG FOUND IT. A cover from the unscoped search is a guess; one from a hash match
      // is not, and they must not look alike to whatever renders this.
      rung: rom.rung ?? null,
    });
  }

  let ok = 0, miss = 0, fail = 0, done = 0;
  onProgress(0, roms.length);

  try {
    for (const rom of roms) {
      if (shouldCancel()) {
        onLog(t("stopped"));
        break;
      }
      done++;
      onProgress(done, roms.length);
      onAccount?.({
        perMin: q?.perMin ?? null,
        perDay: q?.perDay ?? null,
        today: q?.today ?? null,
        used: (q?.today || 0) + client.requestsMade,
      });

      if (!rom.systemeid) {
        onLog(t("sysUnknown", { name: rom.file.name, folder: rom.sysShort }));
        reportMiss(rom, "no_system");
        fail++;
        continue;
      }

      try {
        const h = await hashFile(rom.file, hashers);
        if (shouldCancel()) { onLog(t("stopped")); break; }
        // Cache by hash (system-agnostic): the md5 identifies the game whatever
        // candidate system it ends up matching.
        const gameKey = `game:${h.md5}`;

        let jeu = useCache ? await cache.getGame(gameKey).catch(() => null) : null;
        // A cached game was found on some earlier run and we no longer know by which rung, so it
        // is reported as cached rather than claimed to be a hash match.
        let rung = jeu ? "cached" : null;
        if (!jeu) {
          const found = await lookupGame(client, rom, { h, forceSys, forceName, shouldCancel });
          jeu = found.jeu;
          rung = found.rung;
          if (shouldCancel()) { onLog(t("stopped")); break; }
          if (found.httpError) { onLog(t("httpErr", { status: found.httpError, name: rom.file.name })); reportMiss(rom, "http_error"); fail++; continue; }
          if (!jeu) { onLog(t("noResult", { name: rom.file.name })); reportMiss(rom, "no_result"); miss++; continue; }
          if (useCache) await cache.setGame(gameKey, jeu).catch(() => {});
        }
        // WHICH RUNG ANSWERED, always logged. A rung-4 cover is a guess and a guess that looks
        // identical to a hash match is the failure this area kept producing.
        rom.rung = rung;
        onLog(t("rung_" + rung, { name: rom.file.name, game: gameDisplayName(jeu) }));

        // Reflect the game's actual system in the badge (a GB game found in the
        // "gbc" folder shows "Game Boy", not the folder's primary guess).
        const realSysId = parseInt(jeu?.systeme?.id, 10);
        if (realSysId) rom.systemeid = realSysId;

        const base = rom.parts.slice(1, -1);
        const baseName = rom.file.name.replace(/\.[^/.]+$/, "");

        if (isMix) {
          const gameRegions = gameRegionsFor(rom.file.name, jeu);
          const resolver = new MixResolver(jeu, fetchImage, undefined, gameRegions);
          const canvas = await renderComposition(mixXml, resolver);
          const got = [...resolver.cache.values()].filter(Boolean).length;
          if (got === 0) {
            onLog(t("mixEmpty", { name: rom.file.name }));
            reportMiss(rom, "mix_empty");
            miss++;
            continue;
          }
          const blob = await canvasToBlob(canvas, "image/png");
          await addCover(rom, blob, base.concat(baseName + ".png").join("/"));
          onLog(t("mixOk", { name: rom.file.name, n: got }));
          ok++;
        } else {
          const mediaType = SINGLE_MEDIA[source] || "ss";
          const media = client.pickMedia(jeu, mediaType);
          if (!media) { onLog(t("noMedia", { type: mediaType, name: rom.file.name })); reportMiss(rom, "no_media"); miss++; continue; }
          const blob = await fetchMediaBlob(client, media.url, useCache);
          if (!blob) { onLog(t("imgFailed", { status: "?", name: rom.file.name })); reportMiss(rom, "image_failed"); fail++; continue; }
          const fmt = (media.format || "png").toLowerCase();
          await addCover(rom, blob, base.concat(baseName + "." + fmt).join("/"));
          onLog(t("ssOk", { name: rom.file.name }));
          ok++;
        }
      } catch (e) {
        if (e?.name === "AbortError" || shouldCancel()) { onLog(t("stopped")); break; }
        if (e instanceof FatalError) throw e;
        onLog(t("errGeneric", { name: rom.file.name, msg: e.message }));
        reportMiss(rom, "error");
        fail++;
      }
    }
  } catch (e) {
    if (e?.name === "AbortError") onLog(t("stopped"));
    else onLog(e instanceof FatalError ? t("fatalStop", { msg: e.message }) : t("errRun", { msg: e.message }));
  }

  if (ok > 0) {
    onLog(t("zipDone") || "Done!");
  } else {
    onLog(t("noImages") || "No images found.");
  }

  return { ok, miss, fail, requests: client.requestsMade };
}
