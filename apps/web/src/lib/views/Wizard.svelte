<script lang="ts">
  import { device } from "../device.svelte.js";
  import Card from "../ui/Card.svelte";
  import Button from "../ui/Button.svelte";

  import OfficialFirmwareSection from "../advanced/OfficialFirmwareSection.svelte";
  import RomSection from "../advanced/RomSection.svelte";
  import RomManagementTab from "../advanced/RomManagementTab.svelte";

  // Easy-mode setup: Backup & Patch -> Install Retro-Go -> Install ROMs
  const steps = ["patch", "retrogo", "roms"] as const;
  let stepIdx = $state(0);
  const step = $derived(steps[stepIdx]);

  // Accordion state for RomManagementTab — IDs must match the AccordionSection ids in that component.
  let openSet = $state<Set<string>>(new Set(["select-games", "install-roms"]));
  function onToggle(id: string) {
    const next = new Set(openSet);
    next.has(id) ? next.delete(id) : next.add(id);
    openSet = next;
  }
</script>

<div class="stack">
  <p class="step-label">Step {stepIdx + 1} of {steps.length}</p>

  {#if step === "patch"}
    <Card>
      <div class="stack">
        <h2>Backup & Patch Official Firmware</h2>
        <p class="muted">
          First, select a folder to save your backup. We will back up your original firmware
          and then patch it so your device can dual boot into Retro-Go.
        </p>
        <OfficialFirmwareSection />
        <div><Button variant="action" onclick={() => stepIdx++}>Continue to Install Retro-Go →</Button></div>
      </div>
    </Card>
  {:else if step === "retrogo"}
    <Card>
      <div class="stack">
        <h2>Install Retro-Go</h2>
        <p class="muted">
          Now we install the Retro-Go base system. This provides the custom firmware environment
          necessary to run your games.
        </p>
        <RomSection installMode="flash" />
        <div><Button variant="action" onclick={() => stepIdx++}>Continue to Install ROMs →</Button></div>
      </div>
    </Card>
  {:else if step === "roms"}
    <Card>
      <div class="stack">
        <h2>Install ROMs</h2>
        <p class="muted">
          Finally, select your games and install them!
        </p>
        <RomManagementTab {openSet} {onToggle} onRunning={() => {}} />
        <div><Button variant="action" onclick={() => (stepIdx = 0)}>Start Over</Button></div>
      </div>
    </Card>
  {/if}
</div>

<style>
  h2 {
    font-size: var(--fs-lg);
  }
  .step-label {
    margin: 0;
    font-size: var(--fs-micro);
    color: var(--ink-soft);
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }
</style>
