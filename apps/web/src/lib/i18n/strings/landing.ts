import type { Widen } from "../widen.js";

// Landing (views/Landing.svelte): the two-step entry — pick the mod your device has, then
// pick what you came to do. Copy is lifted verbatim from the Landing1 / Landing2 artboards
// (docs/design/mockups): a 34px title, a 15px grey rubric under it, and a title + 14px
// description on each card.
export const landingEn = {
  title1: "Game & Watch web builder",
  mediaPrompt: "How is your device modded?",
  flashMemory: "Flash Memory",
  flashMemoryDesc: "Games live on the internal flash chip.",
  sdCard: "SD Card",
  sdCardDesc: "Games live on an SD Card mod.",
  title2: "What would you like to do?",
  actionPrompt: "You can switch at any time once you are in.",
  manageDevice: "Manage Device",
  manageDeviceDesc: "Backup, patch, install firmware. Requires an adapter.",
  unsupportedBrowser: "Needs Chromium, Chrome, or Edge.",
  manageDeviceAdvanced: "Manage Device (advanced) →",
  manageLibrary: "Manage Library",
  manageLibraryDesc: "Build and install your library.",
  back: "← Back",
} as const;

export type LandingStrings = Widen<typeof landingEn>;
