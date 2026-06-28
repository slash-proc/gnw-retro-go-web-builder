<script lang="ts">
  import { device } from "../device.svelte.js";
  import GeometryBar from "../ui/GeometryBar.svelte";
  import type { GeoSegment } from "../engine/classify.js";
  import { extflashSegments } from "../engine/classify.js";
  import type { FrogfsFile, LittlefsTreeNode } from "@gnw/fs-builders";
  import { readLittleFsDir, readLittleFsTree } from "@gnw/fs-builders";
  import { dumpRegion } from "../engine/flasher.js";
  import { kb } from "../util.js";

  let selectedFs = $state<string | null>(null);

  const segments = $derived(extflashSegments(device.partitions, device.info?.externalFlashSizeBytes ?? 0));

  function handleFsClick(s: GeoSegment) {
    if (s.kind === "frogfs" || s.kind === "littlefs") {
      selectedFs = s.kind;
    }
  }

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

  async function loadLittleFs() {
    if (device.installedLfsTree) {
      lfsTree = device.installedLfsTree as TreeNode;
      return;
    }
    if (lfsLoading) return;
    const p = device.partitions.find((p) => p.fs === "littlefs");
    if (!p || !device.flasher) {
      lfsError = "LittleFS partition not found.";
      return;
    }

    lfsLoading = true;
    lfsError = null;
    try {
      const blockSize = p.meta?.blockSize ?? device.info?.minEraseSizeBytes ?? 4096;
      const blockCount = p.meta?.blockCount ?? Math.floor(p.size / blockSize);
      
      const blockCache = new Map<number, Uint8Array>();
      let blocksFetched = 0;
      
      const tree = await readLittleFsTree(blockSize, blockCount, async (block) => {
        if (blockCache.has(block)) return blockCache.get(block)!;
        
        const addr = 0x90000000 + p.offset + p.size - ((block + 1) * blockSize);
        const data = await device.transport!.readMemory(addr, blockSize);
        blockCache.set(block, data);
        
        blocksFetched++;
        lfsProgress = Math.min(0.99, blocksFetched / 20); // Arbitrary scale for UI feedback
        return data;
      });
      lfsProgress = 1;
      
      function sortTree(n: LittlefsTreeNode) {
        if (n.children) {
          n.children.sort((a, b) => {
            if (a.isDirectory && !b.isDirectory) return -1;
            if (!a.isDirectory && b.isDirectory) return 1;
            return a.name.localeCompare(b.name);
          });
          for (const c of n.children) sortTree(c);
        }
      }
      sortTree(tree);
      device.installedLfsTree = tree;
      lfsTree = tree as TreeNode;
    } catch (e) {
      lfsError = String(e);
    } finally {
      lfsLoading = false;
    }
  }

  $effect(() => {
    if (selectedFs === "littlefs" && !lfsTree && !lfsLoading && !lfsError) {
      loadLittleFs();
    }
  });
</script>

<div class="stack">
  <div class="desc">
    <p>Select a filesystem partition on the bar below to view its files.</p>
  </div>
  <GeometryBar segments={segments} onClick={handleFsClick} />

  {#snippet renderTree(nodes: TreeNode[])}
    <ul>
      {#each nodes as node}
        <li>
          {#if node.isDirectory}
            <!-- svelte-ignore a11y_click_events_have_key_events -->
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <div class="folder" onclick={() => toggleNode(node)}>
              <span class="icon">
                {#if node.loading}
                  ⏳
                {:else if openDirs.has(node.path)}
                  📂
                {:else}
                  📁
                {/if}
              </span> {node.name}
            </div>
            {#if openDirs.has(node.path) && node.children}
              {@render renderTree(node.children)}
            {/if}
          {:else}
            <div class="file">
              <span class="icon">📄</span> {node.name} <span class="size">({kb(node.size ?? 0)} KB)</span>
            </div>
          {/if}
        </li>
      {/each}
    </ul>
  {/snippet}

  {#if selectedFs === "frogfs"}
    <div class="fs-view">
      <h3>FrogFS</h3>
      {#if frogfsTree && frogfsTree.children && frogfsTree.children.length > 0}
        <div class="tree">
          {@render renderTree(frogfsTree.children)}
        </div>
      {:else}
        <p class="muted">No files found in FrogFS.</p>
      {/if}
    </div>
  {:else if selectedFs === "littlefs"}
    <div class="fs-view">
      <h3>LittleFS</h3>
      {#if lfsLoading}
        <p class="muted">Reading LittleFS partition over SWD ({Math.round(lfsProgress * 100)}%)...</p>
      {:else if lfsError}
        <p class="error">{lfsError}</p>
      {:else if lfsTree && lfsTree.children && lfsTree.children.length > 0}
        <div class="tree">
          {@render renderTree(lfsTree.children)}
        </div>
      {:else}
        <p class="muted">No files found in LittleFS.</p>
      {/if}
    </div>
  {:else if selectedFs}
    <div class="fs-view">
      <p class="muted">File browser not available for {selectedFs}.</p>
    </div>
  {/if}
</div>

<style>
  .stack {
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
  }
  .desc {
    color: var(--ink-soft);
  }
  .fs-view {
    background: var(--surface);
    border: 1px solid var(--surface-sunk);
    border-radius: var(--r-card);
    padding: 1.5rem;
    box-shadow: var(--shadow-card);
  }
  .fs-view h3 {
    margin-top: 0;
    margin-bottom: 1rem;
    font-size: 1.1rem;
  }
  .tree ul {
    list-style: none;
    padding-left: 1.5rem;
    margin: 0.25rem 0;
  }
  .tree > ul {
    padding-left: 0;
  }
  .folder {
    cursor: pointer;
    font-weight: 500;
    user-select: none;
    padding: 0.25rem 0;
  }
  .folder:hover {
    color: var(--model-accent, var(--brand-blue));
  }
  .file {
    padding: 0.25rem 0;
    color: var(--ink-soft);
  }
  .size {
    font-size: 0.85em;
    opacity: 0.6;
    margin-left: 0.5rem;
  }
  .icon {
    display: inline-block;
    width: 1.5rem;
  }
</style>
