/**
 * The SD-card folder pick's FAILURE state, and the tiny state machine that produces it.
 *
 * `romScan.ts`'s `pickSdCardFolder()` has two very different non-success outcomes and they must
 * never be conflated:
 *   - the user CANCELLED the picker — `pickFolder()` returns `null` for it (AbortError on the
 *     native picker, an empty pick on the `<input>` shim). That is a no-op by design and the
 *     user must see nothing at all.
 *   - the pick or the subsequent scan THREW — a `DOMException` that may be a permissions
 *     denial, a removed volume, or a scan failure. The code cannot tell which, so the copy
 *     promises no cause (`shared.folderGateModal.errRead`).
 * Only the second sets this state, which `FolderGateModal.svelte` draws on the gate row that
 * raised the picker (`ModalFolderSdUnreadable.dc.html`). It is store-level singleton state
 * because the same picker is raised from more than one surface.
 *
 * The state machine lives here rather than in `romScan.ts` so it can be tested with no browser
 * and no device store: `runSdCardFolderPick()` takes every dependency it has injected
 * (`test/sdfolderpick.mjs`).
 */

/** The minimum a picked directory handle has to offer for the failure row. */
export interface PickedFolderLike {
  readonly name: string;
}

class SdFolderPickState {
  /** True once a genuine pick/scan failure happened; false for a cancel and after any re-pick. */
  failed = $state(false);
  /** Name of the folder that failed, when one was actually picked before the failure. */
  failedFolder = $state<string | null>(null);

  clear() {
    this.failed = false;
    this.failedFolder = null;
  }

  fail(name: string | null) {
    this.failed = true;
    this.failedFolder = name;
  }
}

export const sdFolderPick = new SdFolderPickState();

export interface SdFolderPickDeps<H extends PickedFolderLike> {
  /** Raise the picker. Returns null when the user cancels. Throws on a real failure. */
  pick: () => Promise<H | null>;
  /** Adopt the picked folder (store the handle, scan it). Throws on a real failure. */
  adopt: (handle: H) => Promise<void>;
  /** Where the outcome is recorded. */
  state?: { clear(): void; fail(name: string | null): void };
  /** Failure logging (the console/debug trail this used to be limited to). */
  onError?: (e: unknown, handle: H | null) => void;
}

/**
 * Run one SD-card folder pick. Any completed pick — success OR cancel — clears a previous
 * failure first: a stale error sitting under a folder the user has since changed is worse than
 * no error at all.
 */
export async function runSdCardFolderPick<H extends PickedFolderLike>(
  deps: SdFolderPickDeps<H>,
): Promise<void> {
  const state = deps.state ?? sdFolderPick;
  state.clear();
  let handle: H | null = null;
  try {
    handle = await deps.pick();
    if (handle) await deps.adopt(handle);
  } catch (e) {
    // Cancellation never reaches here (`pick()` returns null for it), so this is genuine.
    state.fail(handle ? handle.name : null);
    deps.onError?.(e, handle);
  }
}
