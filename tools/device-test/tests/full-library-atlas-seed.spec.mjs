import { test, expect } from "../fixtures.mjs";
import { inspectNativeSources } from "../native-seed.mjs";
import { assertFullLibrary, findGameBoyTetris, waitForLibrarySettled } from "../workflows/library.mjs";
import { goToTab } from "../workflows/navigation.mjs";
import { writeFile } from "node:fs/promises";
import path from "node:path";

test("warm and verify a persistent full-library atlas profile", async ({ page }, testInfo) => {
  test.setTimeout(1_800_000);
  const expected = JSON.parse(process.env.GNW_TEST_DIRECTORY_MAP || "[]");
  const cacheExpected = process.env.GNW_TEST_ATLAS_CACHE_EXPECTED === "1";
  const phase = process.env.GNW_TEST_ATLAS_PHASE || (cacheExpected ? "restart" : "warm");
  await page.goto("/#sources/local-directories");
  // A native directory seed can still retain the app's initial intent chooser. Match
  // the regular preset validator: choose flash media, then enter device management.
  const flash = page.getByRole("button", { name: /Flash Memory.*internal flash chip/i });
  if (await flash.isVisible().catch(() => false)) await flash.click();
  const manage = page.getByRole("button", { name: /^Manage Device Backup/i });
  if (await manage.isVisible().catch(() => false)) await manage.click();
  await page.goto("/#sources/local-directories");

  const sources = await inspectNativeSources(page);
  expect(sources.map((source) => source.name).sort()).toEqual(expected.map((source) => source.name).sort());
  for (const source of sources) {
    expect(source.native, `${source.name} should use a native directory handle`).toBe(true);
    expect(source.permission, `${source.name} should retain its persistent permission`).toBe("granted");
    expect(source.readable, `${source.name} should remain readable after Chromium restart`).toBe(true);
  }

  // Inspect OPFS before opening the Library so a second-process validation proves the
  // persisted atlas files survived profile copy/restart, rather than being rebuilt in-page.
  const cachedBeforeLibrary = await page.evaluate(async () => {
    const { loadSel } = await import("/src/lib/persist.js");
    const { readCarouselAtlas } = await import("/src/lib/sources/carouselAtlas.js");
    const folders = loadSel("localFolders.v1", []);
    const atlases = await Promise.all(folders.map(async (folder) => {
      const atlas = await readCarouselAtlas(folder.id);
      return atlas ? {
        sourceId: folder.id,
        pages: atlas.pages.length,
        placements: atlas.placements.length,
        sourceSignature: atlas.sourceSignature,
      } : null;
    }));
    return atlases.filter(Boolean);
  });
  if (cacheExpected) {
    expect(cachedBeforeLibrary.length, "saved atlas pages should decode from OPFS before Library is opened").toBeGreaterThan(0);
  }

  await goToTab(page, "library");
  const settled = await waitForLibrarySettled(page, { fullCollection: true, timeoutMs: 900_000 });
  const collection = await assertFullLibrary(page);
  const tetris = await findGameBoyTetris(page);
  await expect(tetris).toBeVisible();
  await page.getByRole("searchbox").fill("");

  const runtime = await page.evaluate(() => ({
    covers: window.__gnwCoverDebug?.snapshot?.() ?? null,
    carousel: window.__gnwCarouselDebug?.snapshot?.() ?? null,
  }));
  expect(runtime.covers?.atlas?.ready, "the complete atlas should be ready").toBe(true);
  expect(runtime.covers?.atlas?.signatureMatches, "the atlas should match the current full-library source signature").toBe(true);
  expect(runtime.covers?.atlas?.sources, "the atlas should cover at least one configured source").toBeGreaterThan(0);
  expect(runtime.covers?.atlas?.pages, "the atlas should contain reusable page images").toBeGreaterThan(0);

  const cache = {
    validated: true,
    persistentSourceCount: cachedBeforeLibrary.length,
    persistentPageCount: cachedBeforeLibrary.reduce((sum, atlas) => sum + atlas.pages, 0),
    runtimeSourceCount: runtime.covers.atlas.sources,
    runtimePageCount: runtime.covers.atlas.pages,
    signatureMatches: runtime.covers.atlas.signatureMatches,
    collectionCount: collection.allCount,
  };
  const result = {
    cache,
    cacheExpected,
    phase,
    cachedBeforeLibrary,
    nativeSources: sources.map(({ name, usedBy, native, permission, readable }) => ({ name, usedBy, native, permission, readable })),
    collection,
    settled: {
      atlas: settled?.covers?.atlas ?? null,
      coverQueueDepth: settled?.covers?.queueDepth ?? null,
      activeCoverReads: settled?.covers?.active ?? null,
      carouselQueueDepth: settled?.carousel?.queueDepth ?? null,
      activeDecodes: settled?.carousel?.activeDecodes ?? null,
    },
    runtime: runtime.covers?.atlas ?? null,
  };
  const reportDir = process.env.GNW_TEST_REPORT_DIR;
  const resultName = `atlas-profile-cache-${phase}.json`;
  if (reportDir) await writeFile(path.join(reportDir, resultName), JSON.stringify(result, null, 2) + "\n");
  await testInfo.attach(resultName, {
    body: Buffer.from(JSON.stringify(result, null, 2) + "\n"),
    contentType: "application/json",
  });
});
