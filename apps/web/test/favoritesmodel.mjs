#!/usr/bin/env node
/**
 * Favouriting is a LOCAL act on a row; `/data/favorites.txt` is a DERIVED act over the
 * favourited-and-installed intersection.
 *
 *   docker compose exec dev sh -c 'cd /app/apps/web && node test/favoritesmodel.mjs'
 *
 * The owner: "anything should be able to be a favorite. my goal is to have anything that's
 * favorited and installed also show up in the on-device favorites list."
 *
 * Those are two different sets, and the store used to treat them as one by keying on device
 * path. A row with no installed file had no path, so it could not be starred at all -- which is
 * why the star was missing from so many rows. The two are separated now, and this pins the
 * separation rather than the plumbing:
 *
 *   - every row shape can be starred, including one with no device path at all;
 *   - the file holds exactly the favourited rows that will be on the device;
 *   - a favourited-but-not-installed row is remembered and simply absent from the file;
 *   - installing it later puts it in the file with no second action from the user;
 *   - marks stored under the old device-path key survive.
 *
 * `test/favorites.mjs` still owns the FILE FORMAT, which is Retro-Go's and not ours. Nothing
 * here re-litigates that; this is about which paths reach it.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";

const here = dirname(fileURLToPath(import.meta.url));
const esbuild = await import("esbuild");

let passed = 0;
const failures = [];
const check = (name, fn) => {
  try {
    fn();
    passed++;
  } catch (e) {
    failures.push(`${name}: ${e.message}`);
  }
};
const ok = (c, m) => {
  if (!c) throw new Error(m);
};
const eq = (a, b, m) => {
  if (JSON.stringify(a) !== JSON.stringify(b))
    throw new Error(`${m}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
};

/** A localStorage stand-in, so a run can start from whatever a previous version left behind. */
function makeStorage(seed = {}) {
  const map = new Map(Object.entries(seed));
  // `_reads` is what makes "the restore happened at construction" observable from outside. A
  // lazy load reads nothing until someone calls a method, so the count is the whole assertion.
  const reads = [];
  return {
    getItem: (k) => {
      reads.push(k);
      return map.has(k) ? map.get(k) : null;
    },
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    _dump: () => Object.fromEntries(map),
    _reads: reads,
  };
}

/**
 * A fresh copy of the store per case.
 *
 * The module holds a singleton with a lazy load, so every case needs its own module instance or
 * the first case's `load()` decides what every later one sees. The cache-busting query is what
 * makes each `import()` a new instance.
 */
let seq = 0;
const outDir = mkdtempSync(join(tmpdir(), "gnw-favmodel-"));
const built = (
  await esbuild.build({
    entryPoints: [join(here, "../src/lib/favorites.svelte.ts")],
    bundle: true,
    format: "esm",
    write: false,
    platform: "neutral",
  })
).outputFiles[0].text.replace(/\$state\.raw|\$state/g, "(x=>x)");

async function freshStore(storage) {
  const f = join(outDir, `fav${seq++}.mjs`);
  writeFileSync(f, built);
  globalThis.localStorage = storage;
  return await import(`file://${f}`);
}

const V1 = "gnw.favorites.v1";
const V2 = "gnw.favorites.v2";

// --- every row shape is starrable -------------------------------------------------------------
await (async () => {
  const { favorites } = await freshStore(makeStorage());
  check("ANY row can be starred, whatever the firmware could address", () => {
    // The shapes the old device-path key excluded, in the owner's words "including things that
    // haven't been prepared": a converter title with nothing prepared, a homebrew with several
    // device files, a game not installed. All are just row ids here.
    for (const id of ["nes/Mario.nes", "doom/DOOM.wad", "openlara-title-key", "gw/Ball.gw"]) {
      ok(favorites.toggle(id) === true, `${id} must be starrable`);
      ok(favorites.has(id), `${id} must read back as starred`);
    }
  });

  check("unstarring is remembered, so a sync can remove it", () => {
    favorites.toggle("nes/Mario.nes");
    ok(!favorites.has("nes/Mario.nes"), "no longer starred");
    ok(favorites.unstarred.has("nes/Mario.nes"), "and recorded as explicitly unstarred");
  });
})();

// --- the file is the intersection ---------------------------------------------------------------
await (async () => {
  const { favorites } = await freshStore(makeStorage());
  favorites.toggle("nes/Mario.nes"); // installed
  favorites.toggle("md/Aladdin.md"); // NOT installed
  favorites.toggle("doom/DOOM.wad"); // not prepared, no path at all

  // Only the first will be on the device after this sync.
  const resolve = (id) => (id === "nes/Mario.nes" ? "/roms/nes/Mario.nes" : null);

  check("THE FILE HOLDS FAVOURITED AND INSTALLED, NOTHING ELSE", () => {
    const text = favorites.fileFor("", resolve);
    eq(text, "/roms/nes/Mario.nes\n", "only the row that will be on the device");
  });

  check("a favourited row that is not installed is REMEMBERED, not lost", () => {
    ok(favorites.has("md/Aladdin.md"), "still starred locally");
    ok(favorites.has("doom/DOOM.wad"), "including one with no device path at all");
  });

  check("installing it later adds it, with no second action from the user", () => {
    // The same store, nothing re-starred: only the resolver's answer changed.
    const now = (id) =>
      id === "nes/Mario.nes" ? "/roms/nes/Mario.nes" : id === "md/Aladdin.md" ? "/roms/md/Aladdin.md" : null;
    const text = favorites.fileFor("", now);
    eq(text.split("\n").filter(Boolean).sort(), ["/roms/md/Aladdin.md", "/roms/nes/Mario.nes"],
      "the newly installed favourite appears on its own");
  });

  check("a path the firmware could never resolve is still refused at write time", () => {
    // Local intent is unconditional; what reaches the FILE is not. `/roms/homebrew/` is the
    // prefix the firmware explicitly refuses, so writing it would be writing a dead line.
    const bad = (id) => (id === "doom/DOOM.wad" ? "/roms/homebrew/DOOM.whd" : null);
    eq(favorites.fileFor("", bad), "", "an unresolvable shape is not written");
  });
})();

// --- unstarring removes what the device holds ---------------------------------------------------
await (async () => {
  const { favorites } = await freshStore(makeStorage());
  favorites.toggle("nes/Mario.nes");
  favorites.toggle("nes/Mario.nes"); // starred then unstarred
  check("unstarring removes the line the device already had", () => {
    const text = favorites.fileFor("/roms/nes/Mario.nes\n/roms/md/Other.md\n",
      (id) => (id === "nes/Mario.nes" ? "/roms/nes/Mario.nes" : null));
    eq(text, "/roms/md/Other.md\n", "ours goes, the device's own line stays");
  });
})();

// --- the migration ------------------------------------------------------------------------------
await (async () => {
  const seeded = makeStorage({
    [V1]: JSON.stringify({
      starred: [
        "/roms/nes/Mario.nes",
        "/roms/md/Aladdin.md",
        "/homebrews/OpenLara.bin",
        "/roms/homebrew/Thing.bin",
      ],
      unstarred: ["/roms/gb/Tetris.gb"],
    }),
  });
  const { favorites } = await freshStore(seeded);

  check("OLD MARKS SURVIVE: a ROM path becomes a row id", () => {
    // `/roms/<system>/<file>` inverts exactly, because a ROM row's id is `<system>/<file>`.
    ok(favorites.has("nes/Mario.nes"), "the NES star carried across");
    ok(favorites.has("md/Aladdin.md"), "and the Mega Drive one");
  });

  check("an old mark that cannot be mapped is KEPT, not discarded", () => {
    // A homebrew's row id is its manifest key, which the filename does not carry. Dropping it
    // would lose a user's mark to a refactor; it is kept verbatim and still written.
    ok(!favorites.has("OpenLara.bin"), "no phantom row id is invented for it");
    eq([...favorites.legacy].sort(), ["/homebrews/OpenLara.bin", "/roms/homebrew/Thing.bin"],
      "both unmappable marks are kept as legacy paths");
    const text = favorites.fileFor("", () => null);
    ok(text.includes("/homebrews/OpenLara.bin"), "and it still reaches the file");
  });

  check("old unstars carry across too", () => {
    ok(favorites.unstarred.has("gb/Tetris.gb"), "so a removal is not silently forgotten");
  });

  check("/roms/homebrew/ is NOT mapped to a row id", () => {
    // The firmware refuses that prefix, and `homebrew/<file>` is not a homebrew row id either,
    // so mapping it would invent a row nothing ever matches. ARMED by the seed above, which
    // really does contain such a path -- without it this check passes on an empty migration.
    ok(!favorites.has("homebrew/Thing.bin"), "no row id invented from the refused prefix");
    ok(favorites.legacy.has("/roms/homebrew/Thing.bin"), "it is kept verbatim instead");
  });
})();

await (async () => {
  const seeded = makeStorage({
    [V1]: JSON.stringify({ starred: ["/roms/nes/Old.nes"], unstarred: [] }),
    [V2]: JSON.stringify({ starred: ["nes/New.nes"], unstarred: [], legacy: [] }),
  });
  const { favorites } = await freshStore(seeded);
  check("once migrated, the old key is never read again", () => {
    // ARMED: if the v1 branch could still win, a user who un-starred something after migrating
    // would see it come back.
    ok(favorites.has("nes/New.nes"), "the current store wins");
    ok(!favorites.has("nes/Old.nes"), "and the superseded one is not re-applied");
  });
})();

// --- IT SURVIVES A RELOAD, AND ONE CLICK AFTER A RELOAD DOES NOT DESTROY THE REST ------------
//
// The owner: "In the Library, items added to Favorites aren't there on a reload. That should
// persist."
//
// The cause was not the storage, which round-trips fine; it was WHERE the restore ran.
// `has()` lazily called `load()`, and the first caller of `has()` is a `$derived`
// (`RomManagementTab.svelte`'s `visibleGames` / `favoritesCount`, through `rowAccess`).
// Assigning `$state` inside a `$derived` throws `state_unsafe_mutation` in Svelte 5, and
// `load()` had already set its `loaded` flag on the line before, so the retry was a no-op and
// the sets stayed empty for the life of the page.
//
// These checks cannot see the Svelte error -- the runes are stubbed out here -- so they pin the
// property that made the bug possible: the restore must have happened BEFORE any reader runs,
// which is exactly what a lazy load cannot promise.
await (async () => {
  const storage = makeStorage();
  const first = await freshStore(storage);
  first.favorites.toggle("nes/Mario.nes");
  first.favorites.toggle("gw/Ball.gw");

  // A SECOND MODULE INSTANCE OVER THE SAME BYTES. This is the reload: nothing carries across but
  // the serialized blob, so a check that passed through a live object would prove nothing.
  //
  // The snapshot is taken HERE, between the import and the first method call, and that placement
  // is the whole check. Counting reads at the end of the case instead let a lazy load pass: by
  // then `toggle()` had triggered it, so the key really had been read, just far too late.
  const readsBeforeFirstCall = storage._reads.length;
  const reloaded = await freshStore(storage);
  const readsAtImport = storage._reads.slice(readsBeforeFirstCall).filter((k) => k === V2).length;

  check("a star set before a reload is still set after it", () => {
    ok(reloaded.favorites.has("nes/Mario.nes"), "the first star survived the reload");
    ok(reloaded.favorites.has("gw/Ball.gw"), "and so did the second");
  });

  check("the restore ran at construction, before any reader could", () => {
    // ARMED against the real bug rather than its symptom. The round-trip check above passes
    // even with the pre-fix lazy load, because the test calls a method and the method loads;
    // only the import-time count separates "restored before anyone read" from "restored on
    // first read", and it is the second of those that lost every star in the browser.
    ok(readsAtImport >= 1, `the store must read its key at construction, saw ${readsAtImport}`);
  });

  check("ONE CLICK AFTER A RELOAD DOES NOT WIPE THE OTHER STARS", () => {
    // The destructive half. With the sets left empty by a failed restore, `toggle` started from
    // nothing and `persist` wrote that over the user's real list.
    reloaded.favorites.toggle("md/Aladdin.md");
    const stored = JSON.parse(storage._dump()[V2]);
    eq(
      [...stored.starred].sort(),
      ["gw/Ball.gw", "md/Aladdin.md", "nes/Mario.nes"],
      "the new star joins the stored ones instead of replacing them",
    );
  });
})();

// --- A STAR OUTLIVES THE ROW IT NAMES ---------------------------------------------------------
//
// THE DECISION: it is KEPT, not dropped. A row can vanish because a folder was detached or a
// card was swapped, and neither is the user saying "unstar this". Dropping it would mean the
// star quietly disappears the moment a source goes away and does not come back when it
// returns, which is the same class of loss the reload bug caused.
await (async () => {
  const storage = makeStorage({
    [V2]: JSON.stringify({ starred: ["nes/Gone.nes"], unstarred: [], legacy: [] }),
  });
  const { favorites } = await freshStore(storage);

  check("a star naming a row that no longer exists is kept, and resolves to nothing", () => {
    ok(favorites.has("nes/Gone.nes"), "still remembered");
    eq(favorites.fileFor("", () => null), "", "and contributes no line while the row is absent");
  });

  check("and it starts writing again by itself when the row comes back", () => {
    const text = favorites.fileFor("", (id) =>
      id === "nes/Gone.nes" ? "/roms/nes/Gone.nes" : null,
    );
    eq(text, "/roms/nes/Gone.nes\n", "no second action from the user");
  });
})();

for (const f of failures) console.log(`  x ${f}`);
console.log(
  `favorites model: ${failures.length ? `${failures.length} FAILED, ` : ""}${passed} checks passed`,
);
process.exit(failures.length ? 1 : 0);
