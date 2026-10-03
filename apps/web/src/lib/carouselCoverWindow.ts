export const CAROUSEL_COVER_RADIUS = 60;
// 121 carousel originals plus room for an open details cover. Window eviction is stricter.
export const CAROUSEL_COVER_CACHE_LIMIT = 128;

export type CarouselCoverWindow = {
  center: number;
  behind: number;
  ahead: number;
  retain: number[];
  read: number[];
};

/** Keep 120 neighbors. Fast motion transfers 50 trailing slots to the leading side;
 * below 30 cards/second that bias fades back to the stationary 60/60 window. */
export function carouselCoverWindow(count: number, center: number, speed: number, direction: number): CarouselCoverWindow {
  center = Math.max(0, Math.min(count - 1, Math.round(center)));
  const moving = speed > 0;
  const sign = direction < 0 ? -1 : 1;
  const shift = Math.round(50 * Math.min(1, Math.max(0, speed) / 30));
  const behind = CAROUSEL_COVER_RADIUS - shift;
  const ahead = CAROUSEL_COVER_RADIUS + shift;
  const retain: number[] = [];
  const read: number[] = [];
  if (count > 0) {
    retain.push(center);
    read.push(center);
  }
  for (let distance = 1; distance <= ahead; distance++) {
    const forward = center + sign * distance;
    if (forward >= 0 && forward < count) { retain.push(forward); read.push(forward); }
    const backward = center - sign * distance;
    if (distance <= behind && backward >= 0 && backward < count) {
      retain.push(backward);
      if (!moving) read.push(backward);
    }
  }
  return { center, behind, ahead, retain, read };
}

/** Revoke originals outside the current window; persisted previews are independent. */
export function pruneCarouselCoverUrls(cache: Map<string, string>, retain: ReadonlySet<string>, revoke: (url: string) => void): number {
  let removed = 0;
  for (const [key, url] of cache) {
    if (retain.has(key)) continue;
    revoke(url);
    cache.delete(key);
    removed++;
  }
  return removed;
}

/** Called for queued reads AND their completions, so obsolete work cannot repopulate a window. */
export function carouselCoverReadAllowed(key: string, read: ReadonlySet<string>, detail: string): boolean {
  return read.has(key) || key === detail;
}
