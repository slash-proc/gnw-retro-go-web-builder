import type { Widen } from "../widen.js";

export const landingEn = {
  title: "Game & Watch",
  mediaPrompt: "Flash or SD card modded device?",
  flashMemory: "Flash Memory",
  sdCard: "SD Card",
  actionPrompt: "Which would you like to manage?",
  manageDevice: "Manage Device",
  unsupportedBrowser: "(Unsupported Browser)",
  requiresAdapter: "(Requires Adapter)",
  manageDeviceAdvanced: "Manage Device (Advanced)",
  manageGames: "Manage Games",
  romsCollection: "(ROMs Collection)",
  back: "← Back",
} as const;

export type LandingStrings = Widen<typeof landingEn>;

export const landingDe: LandingStrings = {
  title: "Game & Watch",
  mediaPrompt: "Gerät mit Flash-Speicher oder SD-Karten-Mod?",
  flashMemory: "Flash-Speicher",
  sdCard: "SD-Karte",
  actionPrompt: "Was möchtest du verwalten?",
  manageDevice: "Gerät verwalten",
  unsupportedBrowser: "(Nicht unterstützter Browser)",
  requiresAdapter: "(Adapter erforderlich)",
  manageDeviceAdvanced: "Gerät verwalten (Erweitert)",
  manageGames: "Spiele verwalten",
  romsCollection: "(ROM-Sammlung)",
  back: "← Zurück",
};
