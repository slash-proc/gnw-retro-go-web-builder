import type { OverviewRailStrings } from "./overviewRail.js";

export const overviewRailFr: OverviewRailStrings = {
  groupConsole: "Console",
  groupLogs: "Journaux",
  details: "Détails",

  externalFlash: "Flash externe",
  adapter: "Adaptateur",
  thisApp: "Cette application",

  capacity: "Capacité",

  probe: "Sonde",
  deviceUid: "UID de l'appareil",

  sources: "Sources",
  sourcesCount: (listed: number, active: number) => `${listed} répertoriées, ${active} actives`,
  browserCache: "Cache du navigateur",
  appVersion: "Version de l'application",

  copyDetails: "Copier les détails",

  output: "Sortie",
  copy: "Copier",
  save: "Enregistrer",
};
