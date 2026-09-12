import type { LandingStrings } from "./landing.js";

export const landingIt: LandingStrings = {
  title1: "Game & Watch web builder",
  mediaPrompt: "Come è modificato il dispositivo?",
  flashMemory: "Memoria flash",
  flashMemoryDesc: "I giochi risiedono sul chip flash interno.",
  sdCard: "Scheda SD",
  sdCardDesc: "I giochi risiedono su una mod con scheda SD.",
  title2: "Cosa si vuole fare?",
  actionPrompt: "Si può cambiare in qualsiasi momento una volta entrati.",
  manageDevice: "Gestione dispositivo",
  manageDeviceDesc: "Backup, patch, installazione del firmware. Richiede un adattatore.",
  unsupportedBrowser: "Richiede Chromium, Chrome o Edge.",
  manageDeviceAdvanced: "Gestione dispositivo (avanzata) →",
  manageLibrary: "Gestione libreria",
  manageLibraryDesc: "Composizione e installazione della libreria.",
  back: "← Indietro",
} as const;
