/**
 * The app's ONE owner of `history` and of reading the URL back.
 *
 * Why this exists: every hash write in the app used to be `history.replaceState` (or a bare
 * `location.hash = …`), so the SPA occupied a SINGLE history entry and the browser's Back
 * button always left the app entirely — the owner's report ("pressing back yoinking the user
 * out of the web app"). The rule this module implements:
 *
 *   - a navigation the USER performed (a tab click, opening a source's config page, picking a
 *     rail pane) PUSHES an entry, so Back returns to where they were;
 *   - a navigation the APP derived (restoring on load, the post-scan auto-route, a gate
 *     cancel routing the user out of a tab they cannot use) REPLACES, so no history entry the
 *     user did not create is ever manufactured.
 *
 * Reading is one-directional and idempotent: `onRoute` subscribers are handed a "the URL
 * changed, go read it" ping and MUST NOT write the URL back from it. That is what keeps the
 * state↔URL feedback loop broken — see Advanced.svelte's mount effect, where a tracked
 * read-then-write once froze the page.
 *
 * Both `popstate` and `hashchange` are wired, deliberately:
 *   - `pushState`/`replaceState` fire NEITHER, so our own writes never ping our own readers;
 *   - a Back/Forward press over a hash entry fires BOTH, and each reader is idempotent (it
 *     sets state from `location.hash`), so being told twice costs nothing;
 *   - a plain `location.hash = "#x"` assignment (DeviceHeader's "back to Overview", the
 *     Overview dashboard's deep links) fires only `hashchange` — dropping that listener in
 *     favour of `popstate` alone would silently break those three call sites.
 */

type Reader = () => void;

const readers = new Set<Reader>();
/** Innermost-last stack of open, dismissable overlays. See `pushDismiss`. */
const dismissers: Array<() => void> = [];

/** The hash we believe we are on — restored when a Back press is spent on a modal instead. */
let lastHash = "";
let wired = false;

function read(): void {
  lastHash = location.hash;
  for (const r of [...readers]) r();
}

function onPop(): void {
  const top = dismissers[dismissers.length - 1];
  if (top) {
    // Back dismisses the topmost overlay and is CONSUMED by it: the route does not change, so
    // re-push the hash we were on. `pushState` fires no event of its own, and the `hashchange`
    // the browser had already queued for the Back step now observes the restored hash, so the
    // readers below never see the intermediate URL.
    top();
    history.pushState(null, "", lastHash || location.pathname + location.search);
    return;
  }
  read();
}

function wire(): void {
  if (wired || typeof window === "undefined") return;
  wired = true;
  lastHash = location.hash;
  window.addEventListener("popstate", onPop);
  window.addEventListener("hashchange", read);
}

/**
 * Subscribe to "the URL changed". Returns an unsubscribe, so a component can hand it straight
 * back from an `$effect`. The callback must READ `location` and set state; it must not write
 * the URL.
 */
export function onRoute(fn: Reader): () => void {
  wire();
  readers.add(fn);
  return () => {
    readers.delete(fn);
  };
}

/**
 * Write the hash. `push` is the whole point of this module: true for a navigation the user
 * performed, false for one the app derived. A write to the hash we are already on is dropped
 * either way — pushing a duplicate entry would make Back look broken (one dead press).
 */
export function navigate(hash: string, push: boolean): void {
  wire();
  if (location.hash === hash) return;
  if (push) history.pushState(null, "", hash);
  else history.replaceState(null, "", hash);
  lastHash = hash;
}

/**
 * Register an open overlay's dismiss handler so Back closes it instead of navigating.
 * Returns an unregister, for the effect cleanup.
 *
 * ModalShell calls this for itself, and only when it has an `onDismiss` — which is exactly the
 * modal's own "may this be closed right now" answer (backdrop click and Escape use the same
 * one). So the modals that must survive an operation opt out for free and for the right
 * reason: InstallProgressModal passes `null` while a device write is in flight, as do
 * ConfirmModal's running phase and FilePromptModal while submitting. Since it is a prop read
 * inside a tracked effect, a modal that becomes dismissable when its operation finishes
 * becomes Back-dismissable at the same instant.
 *
 * Limit worth stating: this spends a real Back press rather than pushing an entry of its own,
 * so it can only work while the app HAS an entry behind it. Opening a modal on the very first
 * page of a fresh tab and pressing Back leaves the document, and no script can prevent that.
 */
export function pushDismiss(fn: () => void): () => void {
  wire();
  dismissers.push(fn);
  return () => {
    const i = dismissers.lastIndexOf(fn);
    if (i >= 0) dismissers.splice(i, 1);
  };
}

/** Test seam: drop all subscribers/overlays. Never called by app code. */
export function __resetNav(): void {
  readers.clear();
  dismissers.length = 0;
  lastHash = typeof location === "undefined" ? "" : location.hash;
}
