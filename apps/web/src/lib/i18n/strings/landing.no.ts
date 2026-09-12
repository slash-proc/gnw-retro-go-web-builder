import type { LandingStrings } from "./landing.js";

export const landingNo: LandingStrings = {
  title1: "Game & Watch web-builder",
  mediaPrompt: "Hvordan er enheten din modifisert?",
  flashMemory: "Flashminne",
  flashMemoryDesc: "Spillene ligger på den interne flashbrikken.",
  sdCard: "SD-kort",
  sdCardDesc: "Spillene ligger på en SD-kortmod.",
  title2: "Hva vil du gjøre?",
  actionPrompt: "Du kan bytte når som helst når du er inne.",
  manageDevice: "Behandle enhet",
  manageDeviceDesc: "Sikkerhetskopier, patch, installer firmware. Krever adapter.",
  unsupportedBrowser: "Krever Chromium, Chrome eller Edge.",
  manageDeviceAdvanced: "Behandle enhet (avansert) →",
  manageLibrary: "Behandle bibliotek",
  manageLibraryDesc: "Bygg og installer biblioteket ditt.",
  back: "← Tilbake",
} as const;
