// The slot the Advanced rail's anchored footer bar renders into (audit 5.1).
//
// Every Advanced artboard's right-hand column is `flex-column; justify-content: space-between`
// holding TWO siblings: the padded, max-width-880 body, and a full-column-width bar on the
// bottom edge (Write.dc.html, Dump.dc.html, Erase.dc.html, FileBrowser.dc.html,
// BackupPatch*.dc.html — identical in all of them). The bar therefore cannot live inside the
// capped body, but its contents (labels, enabled-ness, click handlers) belong to whichever
// section is mounted.
//
// So the section declares its bar with `<PaneFooter>` wherever is convenient in its own markup;
// PaneFooter renders nothing in place and instead publishes the summary + snippet here, and
// FirmwareRail renders them as the pane column's second child. Snippets close over their owning
// component's scope, so the bar stays fully reactive to the section's state.
import { getContext, setContext } from "svelte";
import type { Snippet } from "svelte";

const KEY = Symbol("gnw.advanced.paneFooter");

export interface PaneFooterSlot {
  summary: string | null;
  content: Snippet | null;
}

/** Called by FirmwareRail (the pane owner) once, above the sections. */
export function createPaneFooterSlot(): PaneFooterSlot {
  const slot = $state<PaneFooterSlot>({ summary: null, content: null });
  setContext(KEY, slot);
  return slot;
}

/** Called by PaneFooter. Returns undefined when a section is rendered outside the rail. */
export function paneFooterSlot(): PaneFooterSlot | undefined {
  return getContext<PaneFooterSlot | undefined>(KEY);
}
