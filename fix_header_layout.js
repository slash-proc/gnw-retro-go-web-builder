const fs = require('fs');
let file = fs.readFileSync('apps/web/src/lib/ui/DeviceHeader.svelte', 'utf-8');

// Replace the HTML body
const htmlOld = `<header class="band">
  {#if !device.isConnected && !device.everConnected}
    <span class="dot {device.connection}" title={device.connection} aria-hidden="true"></span>
  {/if}
  <strong class="brand">GNW Web Builder</strong>
  <span class="spacer"></span>

  {#if device.isConnected || device.everConnected}
    <div class="overview-line">
      <span class="dot {statusColor}" aria-hidden="true"></span>
      <strong class="status">{statusText}</strong>
      
      <span class="divider"></span>
      
      <span class="chip mono" class:dim={!scanned}>
        Storage: {scanned ? \`\${device.extSizeMB ?? "?"} MB\` : "— MB"}
      </span>
      
      <span class="divider"></span>

      <span class="key">RG:</span>
      <span class="val">{retroGoStatus}</span>
      
      <span class="divider"></span>

      <span class="key">OFW:</span>
      <span class="val ofw" class:dim={!ofw}>{ofwText}</span>
      
      <span class="divider"></span>

      <button
        class="scan"
        disabled={!scanClickable}
        onclick={() => device.ensureStub().then(() => device.runScan()).catch(() => {})}
      >
        <span class="scanled" class:hot={scanActionable} aria-hidden="true"></span>
        {scanClickable ? "Scan" : device.scanning ? "Scanning…" : "No connection"}
      </button>
    </div>
  {/if}

  <span class="spacer"></span>
  
  <button class="icon" onclick={() => theme.toggle()} title="Toggle light / dark" aria-label="Toggle theme">
    {theme.mode === "dark" ? "☀" : "☾"}
  </button>
  
  {#if device.isConnected}
    <Button variant="quiet" onclick={() => device.disconnect()}>Disconnect</Button>
  {:else}
    <SplitButton
      variant="default"
      label={device.connection === "connecting" ? "Connecting…" : "Connect"}
      disabled={device.connection === "connecting"}
      onclick={() => connect()}
      items={[{ label: "Choose adapter…", onclick: () => connect(true) }]}
    />
  {/if}
</header>`;

const htmlNew = `<header class="band">
  <div class="header-left">
    {#if !device.isConnected && !device.everConnected}
      <span class="dot {device.connection}" title={device.connection} aria-hidden="true"></span>
    {/if}
    <strong class="brand">GNW Web Builder</strong>
  </div>

  {#if device.isConnected || device.everConnected}
    <div class="overview-line">
      <button
        class="scan"
        class:grayed-out={device.utilLoaded}
        disabled={!device.isConnected || device.scanning}
        onclick={() => device.ensureStub().then(() => device.runScan()).catch(() => {})}
      >
        {device.scanning ? "Syncing…" : "Sync"}
      </button>

      <span class="dot {statusColor}" aria-hidden="true"></span>
      <strong class="status">{statusText}</strong>
      
      <span class="divider"></span>

      <span class="key">RG:</span>
      <span class="val">{retroGoStatus}</span>
      
      <span class="divider"></span>

      <span class="key">OFW:</span>
      <span class="val ofw" class:dim={!ofw}>{ofwText}</span>
    </div>
  {/if}

  <div class="header-right">
    <button class="icon" onclick={() => theme.toggle()} title="Toggle light / dark" aria-label="Toggle theme">
      {theme.mode === "dark" ? "☀" : "☾"}
    </button>
    
    {#if device.isConnected}
      <Button variant="quiet" onclick={() => device.disconnect()}>Disconnect</Button>
    {:else}
      <SplitButton
        variant="default"
        label={device.connection === "connecting" ? "Connecting…" : "Connect"}
        disabled={device.connection === "connecting"}
        onclick={() => connect()}
        items={[{ label: "Choose adapter…", onclick: () => connect(true) }]}
      />
    {/if}
  </div>
</header>`;

file = file.replace(htmlOld, htmlNew);

// Replace CSS
file = file.replace(
  '  .band {\n    display: flex;\n    align-items: center;\n    gap: 0.7rem;\n    color: #161616;\n    padding: 0.45rem 1.25rem;\n    flex-wrap: wrap;\n  }',
  '  .band {\n    display: flex;\n    align-items: center;\n    justify-content: space-between;\n    gap: 0.7rem;\n    color: #161616;\n    padding: 0.45rem 1.25rem;\n    flex-wrap: nowrap;\n  }\n  .header-left, .header-right {\n    display: flex;\n    align-items: center;\n    gap: 0.7rem;\n    flex: 1;\n  }\n  .header-right {\n    justify-content: flex-end;\n  }'
);

file = file.replace(
  '  .spacer {\n    flex: 1;\n  }',
  ''
);

file = file.replace(
  '  /* Overview Line */\n  .overview-line {\n    display: flex;\n    align-items: center;\n    gap: 0.45rem;\n    margin-left: 1rem;\n    flex-wrap: wrap;\n  }',
  '  /* Overview Line */\n  .overview-line {\n    display: flex;\n    align-items: center;\n    gap: 0.45rem;\n    flex-shrink: 0;\n  }'
);

file = file.replace(
  '  .scanled {\n    width: 0.5rem;\n    height: 0.5rem;\n    border-radius: 50%;\n    background: rgba(0, 0, 0, 0.28);\n    flex: none;\n  }\n  .scanled.hot {\n    background: #e02020;\n    box-shadow: 0 0 3px rgba(224, 32, 32, 0.7);\n  }',
  ''
);

file = file.replace(
  '  .scan:disabled {\n    color: rgba(26, 23, 20, 0.45);\n    background: rgba(0, 0, 0, 0.08);\n    border-color: rgba(0, 0, 0, 0.15);\n    box-shadow: none;\n    cursor: not-allowed;\n  }\n  .scan:disabled .scanled {\n    background: rgba(0, 0, 0, 0.25);\n    box-shadow: none;\n  }',
  '  .scan:disabled {\n    color: rgba(26, 23, 20, 0.45);\n    background: rgba(0, 0, 0, 0.08);\n    border-color: rgba(0, 0, 0, 0.15);\n    box-shadow: none;\n    cursor: not-allowed;\n  }\n  .scan.grayed-out:not(:disabled) {\n    color: rgba(26, 23, 20, 0.6);\n    background: rgba(0, 0, 0, 0.08);\n    border-color: rgba(0, 0, 0, 0.15);\n    box-shadow: none;\n  }'
);

fs.writeFileSync('apps/web/src/lib/ui/DeviceHeader.svelte', file);
