import sys

with open("apps/web/src/lib/advanced/RomManagementTab.svelte", "r") as f:
    content = f.read()

# Remove the `.folder` block (lines 476 to 497)
import re
content = re.sub(
    r'<!-- Folder selector \(mandatory\)\. -->\s*<div class="folder">.*?</div>\s*<!-- 1\. Select games',
    '<!-- 1. Select games',
    content,
    flags=re.DOTALL
)

# Replace the seltable layout
old_seltable_start = """          <div class="selctrls">
            <label class="missing"><input type="checkbox" bind:checked={showMissing} /> Show missing only</label>
            {#if consoleFilter !== "all" && consoleFilter !== "homebrew"}
              <button class="link" onclick={() => romSelection.setSystem(consoleFilter, true)}>select all</button>
              <button class="link" onclick={() => romSelection.setSystem(consoleFilter, false)}>clear</button>
            {/if}
            {#if consoleFilter === "all" || consoleFilter === "homebrew"}
               <!-- Homebrew special actions could go here if needed -->
            {/if}
            <button class="link" onclick={() => romSelection.selectAllMissing()}>Add all missing</button>
          </div>

          <div class="rows">"""

new_seltable_start = """          <div class="two-pane">
            <div class="games-pane">
              <div class="games-pane-header">
                <h2>Games</h2>
                <button class="folder-btn" title="Change ROM Folder" onclick={() => roms.pickFolder()}>
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>
                </button>
              </div>
              <div class="selctrls">
                <button class="action-btn" onclick={() => romSelection.setSystem(consoleFilter, true)}>Select All</button>
                <button class="action-btn" onclick={() => romSelection.setSystem(consoleFilter, false)}>Unselect All</button>
              </div>
              
              <div class="rows">"""

content = content.replace(old_seltable_start, new_seltable_start)

# Now find the end of `.rows`
# The rows loop ends at:
#              {#each unknownHomebrew as g (g.name)}
# ...
#              {/each}
#            {/if}
#          </div>

old_rows_end = """              {/each}
            {/if}
          </div>"""

new_rows_end = """              {/each}
            {/if}
          </div>
          </div> <!-- end games-pane -->
          <div class="carousel-pane">
            <Carousel 
              covers={carouselCovers} 
              bind:selectedId={selectedCarouselId} 
              getUrl={getCoverUrl} 
              systemLabel={(c) => c.system}
            />
          </div>
          </div> <!-- end two-pane -->"""

content = content.replace(old_rows_end, new_rows_end)

# Add CSS for two-pane
css_to_add = """
  .two-pane {
    display: grid;
    grid-template-columns: 350px 1fr;
    gap: 1rem;
    height: 600px;
    background: #e6e6e6;
    border-radius: 8px;
    padding: 1rem;
  }
  .games-pane {
    display: flex;
    flex-direction: column;
    background: white;
    border-radius: 8px;
    border: 1px solid #ccc;
    overflow: hidden;
  }
  .games-pane-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0.5rem 1rem;
    background: #f0f0f0;
    border-bottom: 1px solid #ccc;
  }
  .games-pane-header h2 {
    margin: 0;
    font-size: 1.25rem;
    font-weight: normal;
  }
  .folder-btn {
    background: none;
    border: none;
    cursor: pointer;
    color: #333;
    padding: 4px;
    border-radius: 4px;
  }
  .folder-btn:hover { background: #ddd; }
  .selctrls {
    display: flex;
    gap: 0.5rem;
    padding: 0.5rem;
    background: #f8f8f8;
    border-bottom: 1px solid #ddd;
  }
  .action-btn {
    flex: 1;
    padding: 0.5rem;
    background: #e0c060;
    border: 1px solid #b09040;
    border-radius: 4px;
    font-weight: bold;
    cursor: pointer;
    box-shadow: 0 2px 4px rgba(0,0,0,0.1);
  }
  .action-btn:hover { background: #ebd070; }
  .action-btn:active { transform: translateY(1px); box-shadow: none; }
  .carousel-pane {
    display: flex;
    flex-direction: column;
    height: 100%;
  }
  /* Ensure rows scroll properly within pane */
  .rows {
    flex: 1;
    overflow-y: auto;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0;
  }
  .row {
    padding: 0.5rem;
    border-bottom: 1px solid #eee;
    background: white;
    border-radius: 0;
  }
  .row:last-child { border-bottom: none; }
  .row:hover { background: #f9f9f9; }
"""

content = content.replace("</style>", css_to_add + "\n</style>")

with open("apps/web/src/lib/advanced/RomManagementTab.svelte", "w") as f:
    f.write(content)

