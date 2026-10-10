import { expect } from "../fixtures.mjs";
import { goToTab } from "./navigation.mjs";

/** Wait for scanning, cover preparation, and carousel decode work to actually drain. */
export async function waitForLibrarySettled(page, {
  fullCollection = false,
  timeoutMs = 720_000,
  onAtlasObserved = null,
} = {}) {
  await expect(page.getByRole("searchbox")).toBeVisible({ timeout: 60_000 });
  await expect(page.locator(".scan-layers")).toHaveCount(0, { timeout: 180_000 });

  let settledState = null;
  const coverPreparation = page.locator(".background-status");
  if (fullCollection || await coverPreparation.count()) {
    const atlasObservation = () => page.evaluate(() => {
      const covers = window.__gnwCoverDebug?.snapshot?.();
      const carousel = window.__gnwCarouselDebug?.snapshot?.();
      const detail = document.querySelector(".background-status__detail")?.innerText ?? "";
      const match = detail.match(/(\d+)\s*\/\s*(\d+)/);
      const fraction = match && Number(match[2]) > 1 ? Number(match[1]) / Number(match[2]) : 0;
      return {
        // This is only a point to record mid-preparation diagnostics, not a
        // completion threshold. Completion is established below by atlas ready
        // plus drained queues; requiring a large fraction here can time out on
        // a slow real collection before the actual settle wait even begins.
        observed: fraction > 0.02 || covers?.atlas?.ready === true,
        state: {
          progressText: document.querySelector(".background-status")?.innerText ?? null,
          covers: covers ?? null,
          carousel: carousel ?? null,
          fraction,
        },
      };
    });
    await expect.poll(async () => (await atlasObservation()).observed,
      { timeout: 150_000, intervals: [500, 1000] }).toBe(true);
    if (onAtlasObserved) await onAtlasObserved((await atlasObservation()).state);

    // Require the queues to remain empty through the carousel debounce interval, so a
    // briefly idle instant cannot be mistaken for completed atlas/cover preparation.
    let idleSince = null;
    await expect.poll(async () => {
      const state = await page.evaluate(() => {
        const covers = window.__gnwCoverDebug?.snapshot?.();
        const carousel = window.__gnwCarouselDebug?.snapshot?.();
        return { covers, carousel };
      });
      const covers = state.covers;
      const carousel = state.carousel;
      const drained = !!covers && !!carousel
          && covers.atlas?.ready === true && covers.atlas?.signatureMatches === true
          && covers.active === 0 && covers.queueDepth === 0
          && carousel.activeDecodes === 0 && carousel.queueDepth === 0;
      if (!drained) { idleSince = null; return false; }
      idleSince ??= Date.now();
      if (Date.now() - idleSince < 1_200) return false;
      settledState = state;
      return true;
    }, { timeout: timeoutMs, intervals: [250, 500, 1000] }).toBe(true);
  }
  // The app may leave its progress container mounted but hidden after the work drains.
  // Settled means it is no longer visible, not that the DOM node was destroyed.
  await expect(coverPreparation).toBeHidden({ timeout: 30_000 });
  return fullCollection ? settledState : null;
}

export async function openAndSettleLibrary(page, options) {
  await goToTab(page, "library");
  await waitForLibrarySettled(page, options);
}

/** Assert the large real collection is present, virtualized, and includes Game Boy. */
export async function assertFullLibrary(page) {
  const inferredCount = await page.locator(".rows").evaluate((list) => {
    const rows = list.querySelectorAll(":scope > .row").length;
    const virtual = [...list.querySelectorAll(":scope > .virtual-spacer")]
      .reduce((sum, spacer) => sum + parseFloat(spacer.style.height || "0"), 0);
    return rows + Math.round(virtual / 50);
  });
  const allFilter = page.getByRole("button", { name: /^All \(/ });
  const allCount = Number((await allFilter.innerText()).match(/\((\d+)\)/)?.[1]);
  const systems = (await page.locator(".consoles button.console").allInnerTexts())
    .map((value) => value.replace(/\s+/g, " ").trim());
  expect(inferredCount, "the full Library should contain more than 1,000 virtualized rows").toBeGreaterThan(1000);
  expect(inferredCount).toBeGreaterThanOrEqual(allCount - 2);
  expect(inferredCount).toBeLessThanOrEqual(allCount);
  expect(systems.some((value) => /^GB(?:\s|\()/m.test(value)),
    "Game Boy should be represented when its ROMs are in the configured collection").toBe(true);
  return { inferredCount, allCount, systems };
}

export async function findGameBoyTetris(page) {
  const search = page.getByRole("searchbox");
  await search.fill("Tetris (USA) (Rev-A)");
  const row = page.locator(".row").filter({ hasText: "Tetris (USA) (Rev-A)" });
  await expect(row).toHaveCount(1);
  await expect(row.first()).toContainText("GB");
  return row.first();
}
