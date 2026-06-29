const fs = require('fs');

let content = fs.readFileSync('apps/web/src/lib/advanced/RomManagementTab.svelte', 'utf-8');

if (!content.includes('import GameDetailsPanel')) {
  content = content.replace(
    'import Carousel from "../ui/Carousel.svelte";',
    'import Carousel from "../ui/Carousel.svelte";\n  import GameDetailsPanel from "./GameDetailsPanel.svelte";'
  );
}

// Below the two-pane:
const replaceTarget = `          </div> <!-- two-pane -->`;
const replacement = `          </div> <!-- two-pane -->

          <!-- Game Details Panel spanning below carousel & list -->
          {#if selectedCarouselId}
            {@const activeGame = visibleGames.find(g => g.key === selectedCarouselId)}
            {@const activeHb = !activeGame ? unknownHomebrew.find(g => g.name === selectedCarouselId) : null}
            {#if activeGame}
              <GameDetailsPanel 
                gameKey={activeGame.key} 
                gameName={activeGame.name} 
                system={activeGame.system} 
                coverUrl={getCoverUrl(activeGame.key)} 
                bind:configuredCheats 
              />
            {:else if activeHb}
              <GameDetailsPanel 
                gameKey={activeHb.name} 
                gameName={activeHb.name} 
                system="homebrew" 
                coverUrl={null} 
                bind:configuredCheats 
              />
            {/if}
          {/if}`;

content = content.replace(replaceTarget, replacement);

fs.writeFileSync('apps/web/src/lib/advanced/RomManagementTab.svelte', content);
