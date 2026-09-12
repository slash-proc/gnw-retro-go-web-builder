#!/usr/bin/env node
/**
 * Refresh `src/lib/screenscraper/systems.json` from ScreenScraper.
 *
 *   docker compose exec dev sh -c 'cd /app/apps/web && node scripts/fetch-ss-systems.mjs'
 *
 * THE ONLY THING HERE THAT TALKS TO THE API. Everything else reads the committed snapshot, so
 * the app never needs the network or the credentials to answer "what can be scraped". Run this
 * when a console is missing, not on a schedule: the call spends the shared developer quota.
 *
 * Credentials come from `config.js`'s `devCreds()` and are never printed or written anywhere.
 */
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { devCreds, API } from "../src/lib/screenscraper/config.js";

const TYPE = {
  Console: "Console", Ordinateur: "Computer", Arcade: "Arcade",
  "Console Portable": "Handheld", Accessoire: "Accessory", Smartphone: "Smartphone",
  "Emulation Arcade": "Arcade emu", "Machine Virtuelle": "Virtual machine",
  Flipper: "Pinball", "Console & Arcade": "Console + arcade", Autres: "Other",
};

const url = new URL("systemesListe.php", API);
const creds = devCreds();
url.searchParams.set("devid", creds.devid);
url.searchParams.set("devpassword", creds.devpassword);
url.searchParams.set("softname", "CoverStudio");
url.searchParams.set("output", "json");

const res = await fetch(url);
const body = await res.text();
let parsed;
try {
  parsed = JSON.parse(body);
} catch {
  // ScreenScraper answers a bad login with PLAIN TEXT and HTTP 200, so a parse failure is the
  // real signal. Print what it said rather than a JSON error that names the wrong problem.
  console.error(`ScreenScraper did not return JSON: ${body.slice(0, 200)}`);
  process.exit(1);
}

const list = parsed?.response?.systemes ?? [];
if (list.length === 0) {
  console.error("ScreenScraper returned no systems; refusing to overwrite the snapshot");
  process.exit(1);
}

const rows = list
  .map((s) => ({
    id: Number(s.id),
    name: s?.noms?.nom_eu || s?.noms?.nom_us || s?.noms?.nom_jp || "",
    shortcodes: [
      ...new Set(
        [s?.noms?.nom_recalbox, s?.noms?.nom_retropie]
          .filter(Boolean)
          .flatMap((v) => String(v).split(","))
          .map((v) => v.trim())
          .filter(Boolean),
      ),
    ],
    extensions: s.extensions
      ? String(s.extensions).split(",").map((e) => e.trim()).filter(Boolean).slice(0, 14)
      : [],
    type: TYPE[s.type] || s.type || "Other",
    company: s.compagnie || "",
  }))
  .sort((a, b) => a.id - b.id);

const out = join(dirname(fileURLToPath(import.meta.url)), "../src/lib/screenscraper/systems.json");
writeFileSync(out, `${JSON.stringify(rows, null, 1)}\n`);
console.log(`wrote ${rows.length} systems to ${out}`);
