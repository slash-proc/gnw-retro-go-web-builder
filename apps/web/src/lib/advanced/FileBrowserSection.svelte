<script lang="ts">
  import { device } from "../device.svelte.js";
  import GeometryBar from "../ui/GeometryBar.svelte";
  import type { GeoSegment } from "../engine/classify.js";
  import { extflashSegments, intflashSegments } from "../engine/classify.js";
  import { INT_BAR_NOTE, INT_BAR_SIZE, EXT_BAR_NOTE, extBarSize } from "./addr.js";
  import type { FrogfsFile, LittlefsTreeNode } from "@gnw/fs-builders";
  import { LittleFsImage } from "@gnw/fs-builders";
  import { dumpRegion } from "../engine/flasher.js";
  import { ensureLfsTree, readLfsFile } from "../engine/lfsBrowser.js";
  import { download, formatSize } from "../util.js";
  import { locale } from "../i18n/locale.svelte.js";
  import PaneFooter from "./PaneFooter.svelte";
  import Button from "../ui/Button.svelte";
  import ModalShell from "../ui/ModalShell.svelte";
  import { writeFilesToDeviceLfs } from "../engine/lfsWrite.js";
  import { flashImage } from "../engine/flasher.js";
  import { deviceSafety } from "../installProgress.svelte.js";

  let selectedFs = $state<string | null>(null);
  // The clicked segment, kept so the bar can draw it as selected. Nothing reads it for I/O.
  let selectedSeg = $state<GeoSegment | null>(null);

  const intSegs = $derived(intflashSegments(device.banks));
  const segments = $derived(extflashSegments(device.partitions, device.info?.externalFlashSizeBytes ?? 0));

  function handleFsClick(s: GeoSegment) {
    if (s.kind === "frogfs" || s.kind === "littlefs") {
      selectedFs = s.kind;
      selectedSeg = s;
    }
  }

  // FileBrowser.dc.html:83 — the caption is the partition's human name with its filesystem in
  // parentheses ("Cores, saves (LittleFS)"). The absolute address the board used to print
  // after a `·` was dropped when the boards were resynced in 31cc2f7.
  const captionTitle = $derived(
    selectedFs === "frogfs"
      ? locale.t.fileBrowserSection.frogfsTitle
      : selectedFs === "littlefs"
        ? locale.t.fileBrowserSection.littlefsTitle
        : (selectedFs ?? ""),
  );
  interface TreeNode {
    name: string;
    path: string;
    isDirectory: boolean;
    children?: TreeNode[];
    size?: number;
    loading?: boolean;
  }

  function buildTree(files: FrogfsFile[]): TreeNode {
    const root: TreeNode = { name: "root", path: "", isDirectory: true, children: [] };
    for (const f of files) {
      const parts = f.path.split("/");
      let current = root;
      let currentPath = "";
      for (let i = 0; i < parts.length; i++) {
        const part = parts[i];
        currentPath = currentPath ? `${currentPath}/${part}` : part;
        if (i === parts.length - 1) {
          // File
          current.children!.push({ name: part, path: currentPath, isDirectory: false, size: f.dataSize });
        } else {
          // Directory
          let existing = current.children!.find((c) => c.isDirectory && c.name === part);
          if (!existing) {
            existing = { name: part, path: currentPath, isDirectory: true, children: [] };
            current.children!.push(existing);
          }
          current = existing;
        }
      }
    }
    return root;
  }

  const frogfsTree = $derived(
    device.installedFrogfs?.files ? buildTree(device.installedFrogfs.files) : null
  );

  let openDirs = $state(new Set<string>([""]));

  async function toggleNode(node: TreeNode) {
    if (node.isDirectory) {
      const next = new Set(openDirs);
      if (next.has(node.path)) {
        next.delete(node.path);
        openDirs = next;
      } else {
        next.add(node.path);
        openDirs = next;
      }
    }
  }

  let lfsLoading = $state(false);
  let lfsProgress = $state(0);
  let lfsTree = $state<TreeNode | null>(null);
  let lfsError = $state<string | null>(null);
  const readPct = $derived(Math.round(lfsProgress * 100));
  
  async function loadLittleFs() {
    if (lfsTree && device.installedLfsTree) return;
    if (lfsLoading) return;
    
    lfsLoading = true;
    lfsError = null;
    try {
      lfsTree = await ensureLfsTree((done, total) => { lfsProgress = done / total; }) as TreeNode;
    } catch (e) {
      lfsError = String(e);
    } finally {
      lfsLoading = false;
    }
  }

  // Downloading a file re-reads it block-by-block over SWD via the RAM stub, so it's gated
  // behind Recovery Mode (device.utilLoaded) exactly like every other on-device read path.
  // FrogFS rows stay non-interactive — only LittleFS has a per-file reader today.
  const canDownload = $derived(selectedFs === "littlefs" && device.utilLoaded);

  // The two boards give the pane one summary per partition selection:
  // FileBrowser.dc.html:89 (LittleFS) says a file can be clicked to download it;
  // FileBrowserFrogfs.dc.html:87 (FrogFS) says download is LittleFS-only — which is what
  // the FrogFS rows actually do (they are never rendered as buttons). With no partition
  // selected neither board draws a footer line, so none is shown rather than inventing one.
  const footerSummary = $derived(
    selectedFs === "littlefs"
      ? locale.t.fileBrowserSection.footerSummary
      : selectedFs === "frogfs"
        ? locale.t.fileBrowserSection.footerSummaryFrogfs
        : undefined,
  );

  let downloading = $state<string | null>(null);
  let mutating = $state<string | null>(null);
  let uploadDir = $state<string | null>(null);
  let uploadFile = $state<File | null>(null);
  let uploadInput = $state<HTMLInputElement | null>(null);
  let mutationError = $state<string | null>(null);

  const canMutate = $derived(selectedFs === "littlefs" && device.utilLoaded && !mutating);

  function openUpload(dir: TreeNode) {
    if (!canMutate || dir.path === "") return;
    uploadDir = dir.path;
    uploadFile = null;
    mutationError = null;
  }

  async function submitUpload() {
    if (!uploadDir || !uploadFile || !canMutate) return;
    mutating = `upload:${uploadDir}`;
    mutationError = null;
    deviceSafety.hold();
    try {
      const bytes = new Uint8Array(await uploadFile.arrayBuffer());
      await writeFilesToDeviceLfs((force) => device.ensureStub(undefined, force, true, force), [{ path: `${uploadDir}/${uploadFile.name}`, data: bytes }]);
      uploadDir = null;
      lfsTree = null;
      device.installedLfsTree = null;
      await loadLittleFs();
    } catch (e) {
      mutationError = e instanceof Error ? e.message : String(e);
    } finally {
      deviceSafety.release();
      mutating = null;
    }
  }

  async function deleteFile(node: TreeNode) {
    if (!canMutate || node.isDirectory || !confirm(`Delete ${node.path}?`)) return;
    mutating = `delete:${node.path}`;
    mutationError = null;
    deviceSafety.hold();
    try {
      const tree = await ensureLfsTree();
      const files = new Map<string, Uint8Array>();
      async function collect(n: LittlefsTreeNode, prefix: string) {
        for (const c of n.children ?? []) {
          const p = `${prefix}${c.name}`;
          if (c.isDirectory) await collect(c, `${p}/`);
          else if (p !== node.path) files.set(p, await readLfsFile(p));
        }
      }
      await collect(tree, "");
      const part = device.partitions.find((p) => p.fs === "littlefs");
      if (!part) throw new Error("LittleFS partition not found.");
      const bs = part.meta?.blockSize ?? device.info?.minEraseSizeBytes ?? 4096;
      const bc = part.meta?.blockCount ?? Math.floor(part.size / bs);
      const image = await LittleFsImage.create(bs, bc);
      const dirs = new Set<string>(["cores", "data"]);
      for (const p of files.keys()) {
        const bits = p.split("/");
        for (let i = 1; i < bits.length; i++) dirs.add(bits.slice(0, i).join("/"));
      }
      for (const d of [...dirs].sort((a, b) => a.split("/").length - b.split("/").length)) image.mkdir(`/${d}`);
      for (const [p, data] of files) image.writeFile(`/${p}`, data);
      await flashImage((force) => device.ensureStub(undefined, force, true, force), 0, part.offset, image.finish(), undefined, undefined, { compress: true, verify: false });
      lfsTree = null;
      device.installedLfsTree = null;
      await loadLittleFs();
    } catch (e) {
      mutationError = e instanceof Error ? e.message : String(e);
    } finally {
      deviceSafety.release();
      mutating = null;
    }
  }

  async function downloadFile(node: TreeNode) {
    if (!canDownload || downloading) return;
    downloading = node.path;
    try {
      download(node.name, await readLfsFile(node.path));
    } catch (e) {
      alert(locale.t.fileBrowserSection.downloadFailed(String(e)));
    } finally {
      downloading = null;
    }
  }

  $effect(() => {
    if (selectedFs === "littlefs" && !lfsTree && !lfsLoading && !lfsError) {
      loadLittleFs();
    }
  });
</script>

<div class="stack">
  <!-- FileBrowser.dc.html:81 draws TWO headed bars, the same pair Write/Dump/Erase draw:
       `Internal flash` / `bank 1 · bank 2` / `2 × 256 KB`, then `External flash` /
       `bank 0` / the device capacity. Only the extflash segments are clickable here —
       there is no file system to browse on an internal bank. -->
  <div class="bars">
    {#if intSegs.length > 0}
      <GeometryBar
        size="tall"
        segments={intSegs}
        title={locale.t.fileBrowserSection.internalFlashTitle}
        note={INT_BAR_NOTE}
        sizeLabel={INT_BAR_SIZE}
      />
    {/if}
    <GeometryBar
      size="tall"
      segments={segments}
      title={locale.t.fileBrowserSection.externalFlashTitle}
      note={EXT_BAR_NOTE}
      sizeLabel={extBarSize(device.extSizeMB)}
      isSelected={(s) => s === selectedSeg}
      onClick={handleFsClick}
    />
  </div>

  <!-- FileBrowser.dc.html:85 — stroked SVG icons (folder `#5c5c5c`, file `#9a9aa0`,
       green `#3e9e4e` download arrow), each row a flex line with a `1px solid #ededed`
       rule and the size right-aligned in mono. -->
  {#snippet folderIcon()}
    <svg class="ic" viewBox="0 0 20 20" fill="none" stroke="var(--ink-soft)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"
      ><path d="M2.5 6a1.5 1.5 0 0 1 1.5-1.5h3l1.5 2h6.5A1.5 1.5 0 0 1 16.5 8v6a1.5 1.5 0 0 1-1.5 1.5H4A1.5 1.5 0 0 1 2.5 14z"></path></svg
    >
  {/snippet}
  {#snippet fileIcon()}
    <svg class="ic" viewBox="0 0 20 20" fill="none" stroke="var(--ink-dim)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"
      ><path d="M5 2.5h6l4 4v11H5z"></path><path d="M11 2.5v4h4"></path></svg
    >
  {/snippet}
  {#snippet downloadIcon()}
    <svg class="ic dl" viewBox="0 0 24 24" fill="none" stroke="var(--zelda-green)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"
      ><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg
    >
  {/snippet}

  {#snippet renderTree(nodes: TreeNode[])}
    <ul>
      {#each nodes as node}
        <li>
          {#if node.isDirectory}
            <!-- svelte-ignore a11y_click_events_have_key_events -->
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <div class="row folder" class:busy={node.loading} onclick={() => toggleNode(node)}>
              {@render folderIcon()}
              <span class="name">{node.name}</span>
              {#if canMutate && node.path !== ""}
                <button class="mini-action" type="button" title={`Upload into ${node.path}`} onclick={(e) => { e.stopPropagation(); openUpload(node); }}>＋</button>
              {/if}
            </div>
            {#if openDirs.has(node.path) && node.children}
              {@render renderTree(node.children)}
            {/if}
          {:else if canDownload}
            <div class="row file downloadable"
              class:busy={downloading === node.path}
              title={locale.t.fileBrowserSection.downloadTitle(node.path)}
            >
              {@render fileIcon()}
              <span class="name">{node.name}</span>
              <span class="size">{formatSize(node.size ?? 0)}</span>
              <button class="mini-action" type="button" disabled={downloading !== null || mutating !== null} title={locale.t.fileBrowserSection.downloadTitle(node.path)} onclick={() => void downloadFile(node)}>{@render downloadIcon()}</button>
              <button class="mini-action danger" type="button" disabled={mutating !== null} title={`Delete ${node.path}`} onclick={() => void deleteFile(node)}>×</button>
            </div>
          {:else}
            <div
              class="row file"
              title={selectedFs === "littlefs" ? locale.t.fileBrowserSection.downloadNeedsRecovery : undefined}
            >
              {@render fileIcon()}
              <span class="name">{node.name}</span>
              <span class="size">{formatSize(node.size ?? 0)}</span>
            </div>
          {/if}
        </li>
      {/each}
    </ul>
  {/snippet}

  {#if uploadDir !== null}
    <ModalShell onDismiss={mutating ? null : () => (uploadDir = null)} maxWidth="30rem">
      {#snippet children()}
        <h3>Upload to /{uploadDir}</h3>
        <p class="muted">Choose one file to add to this LittleFS directory.</p>
        <input bind:this={uploadInput} type="file" onchange={(e) => (uploadFile = (e.currentTarget as HTMLInputElement).files?.[0] ?? null)} />
        {#if mutationError}<p class="error">{mutationError}</p>{/if}
        <div class="actions">
          <Button variant="cancel" onclick={() => (uploadDir = null)} disabled={!!mutating}>Cancel</Button>
          <Button variant="action" onclick={() => void submitUpload()} disabled={!uploadFile || !!mutating}>Upload</Button>
        </div>
      {/snippet}
    </ModalShell>
  {/if}

  <!-- FileBrowser.dc.html:83-84 — an uppercase caption naming the partition, the read
       status right-aligned opposite it, then a 4px read-progress track, then the white
       list surface. -->
  {#if selectedFs}
    <div class="fsblock">
      <div class="caprow">
        <div class="cap">{captionTitle}</div>
        {#if selectedFs === "littlefs" && lfsLoading}
          <span class="capstat">{locale.t.fileBrowserSection.readingLittlefs(readPct)}</span>
        {/if}
      </div>

      {#if selectedFs === "littlefs" && lfsLoading}
        <div class="readbar"><div class="readfill" style="width: {readPct}%"></div></div>
      {/if}

      {#if selectedFs === "frogfs"}
        {#if frogfsTree && frogfsTree.children && frogfsTree.children.length > 0}
          <div class="fs-view">
            <div class="tree">
              {@render renderTree(frogfsTree.children)}
            </div>
          </div>
        {:else}
          <p class="muted">{locale.t.fileBrowserSection.noFrogfsFiles}</p>
        {/if}
      {:else if selectedFs === "littlefs"}
        {#if lfsLoading}
          <!-- The tree only exists once the whole partition has been read, so the
               progress track above stands alone until it does. -->
        {:else if lfsError}
          <p class="error">{lfsError}</p>
        {:else if lfsTree && lfsTree.children && lfsTree.children.length > 0}
          <div class="fs-view">
            <div class="tree">
              {@render renderTree(lfsTree.children)}
            </div>
          </div>
        {:else}
          <p class="muted">{locale.t.fileBrowserSection.noLittlefsFiles}</p>
        {/if}
      {:else}
        <p class="muted">{locale.t.fileBrowserSection.browserNotAvailable(selectedFs)}</p>
      {/if}
    </div>
  {/if}
  <PaneFooter summary={footerSummary} />
</div>

<style>
  /* Write/Dump/Erase/FileBrowser.dc.html — the pane body column is `gap: 28px`
     (FirmwareRail's `.panebody` already is); the section's own stack continues that
     column, so it uses the same rhythm. */
  .stack {
    display: flex;
    flex-direction: column;
    gap: 28px;
  }
  .bars {
    display: flex;
    flex-direction: column;
    gap: 1.125rem;
  }
  /* FileBrowser.dc.html:82 — caption, status, track and surface stack at `gap: 14px`. */
  .fsblock {
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
  .caprow {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 1rem;
  }
  /* FileBrowser.dc.html:83 — 11px/700/0.11em uppercase, on the page ground. */
  .cap {
    font-size: var(--fs-label);
    font-weight: 700;
    letter-spacing: var(--label-track);
    color: var(--ink-soft);
    text-transform: uppercase;
  }
  .capstat {
    font-size: var(--fs-micro);
    color: var(--ink-soft);
  }
  /* FileBrowser.dc.html:85 — `height: 4px; border-radius: 2px` on the sunk track. */
  .readbar {
    display: flex;
    height: 4px;
    border-radius: 2px;
    overflow: hidden;
    background: var(--surface-sunk);
  }
  .readfill {
    background: var(--zelda-green);
  }
  /* FileBrowser.dc.html:86 — the panel is `#ffffff` + `border-radius: 6px` with
     NO border and NO shadow; rows carry the separation via `1px solid #ededed`. */
  .fs-view {
    background: var(--surface);
    border-radius: var(--r-card);
    padding: 2px 16px;
  }
  .tree ul {
    list-style: none;
    padding-inline-start: 1.25rem;
    margin: 0;
  }
  /* Artboard row ladder: 12px base indent, +20px per level. */
  .tree > ul {
    padding-inline-start: 12px;
  }
  /* One shared row shape for folders and files: icon · name · size · arrow,
     separated by the artboard's in-surface rule rather than by boxes. */
  .row {
    display: flex;
    align-items: center;
    gap: 9px;
    width: 100%;
    padding: 8px 0;
    border-bottom: 1px solid var(--rule);
    /* FileBrowser.dc.html:86 — rows are 13px: folders at 600, files at 400. */
    font-size: var(--fs-btn-sm);
    text-align: start;
    background: none;
    border-inline-start: 0;
    border-inline-end: 0;
    border-top: 0;
    font-family: inherit;
    color: var(--ink);
  }
  .row .name {
    flex-grow: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .folder {
    cursor: pointer;
    font-weight: 600;
    user-select: none;
  }
  /* FileBrowser.dc.html:86 — a file row's NAME is the page ink at weight 400; only its
     icon (--ink-dim) and its size (--ink-soft) are quiet. */
  .file {
    color: var(--ink);
    font-weight: 400;
  }
  .row.busy {
    opacity: 0.6;
  }
  .folder:hover,
  .file.downloadable:hover {
    color: var(--model-accent);
  }
  .mini-action {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1.6rem;
    height: 1.6rem;
    padding: 0;
    border: 0;
    background: transparent;
    color: var(--zelda-green);
    cursor: pointer;
    font-size: 1.2rem;
    line-height: 1;
  }
  .mini-action:hover:not(:disabled) { color: var(--model-accent); }
  .mini-action:disabled { opacity: 0.45; cursor: default; }
  .mini-action.danger { color: var(--action-red); }
  .actions { display: flex; justify-content: flex-end; gap: 1.25rem; margin-top: 1.25rem; }
  h3 { margin: 0 0 0.5rem; font-size: var(--fs-title); }
  input[type="file"] { width: 100%; margin-top: 0.75rem; }
  .size {
    font-family: var(--font-mono);
    font-size: var(--fs-micro);
    color: var(--ink-soft);
  }
  .ic {
    width: 14px;
    height: 14px;
    flex: none;
  }
  /* FileBrowser.dc.html:86 — the download arrow sits 12px after the size. */
  .ic.dl {
    width: 13px;
    height: 13px;
    margin-inline-start: 12px;
  }
</style>
