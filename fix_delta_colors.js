const fs = require('fs');
let romTab = fs.readFileSync('apps/web/src/lib/advanced/RomManagementTab.svelte', 'utf-8');

const oldDelta = `<p class="delta" style="padding: 1rem; border-top: 1px solid var(--surface-sunk); background: var(--surface);">
            <strong>+{romSelection.additions.length + hbAdditions}</strong> add ({MiB(romSelection.additionsBytes + hbAdditionsBytes)} MiB)
            · <strong>−{romSelection.removals.length + hbRemovals}</strong> remove ({MiB(romSelection.removalsBytes + hbRemovalsBytes)} MiB)
          </p>`;

const newDelta = `{@const numAdds = romSelection.additions.length + hbAdditions}
          {@const numRemoves = romSelection.removals.length + hbRemovals}
          <p class="delta" style="padding: 1rem; border-top: 1px solid var(--surface-sunk); background: var(--surface); text-align: center;">
            <span style="color: {numAdds > 0 ? '#007bff' : 'var(--ink-soft)'}"><strong>+{numAdds}</strong> add ({MiB(romSelection.additionsBytes + hbAdditionsBytes)} MiB)</span>
            <span style="color: var(--ink-soft)"> · </span>
            <span style="color: {numRemoves > 0 ? 'var(--caution, #d32f2f)' : 'var(--ink-soft)'}"><strong>−{numRemoves}</strong> remove ({MiB(romSelection.removalsBytes + hbRemovalsBytes)} MiB)</span>
          </p>`;

romTab = romTab.replace(oldDelta, newDelta);

fs.writeFileSync('apps/web/src/lib/advanced/RomManagementTab.svelte', romTab);
