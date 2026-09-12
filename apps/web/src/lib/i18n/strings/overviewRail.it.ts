import type { OverviewRailStrings } from "./overviewRail.js";

export const overviewRailIt: OverviewRailStrings = {
  groupConsole: "Console",
  groupLogs: "Log",
  details: "Dettagli",

  externalFlash: "Flash esterna",
  adapter: "Adattatore",
  thisApp: "Questa app",

  capacity: "Capacità",

  probe: "Programmatore",
  deviceUid: "UID dispositivo",

  sources: "Sorgenti",
  sourcesCount: (listed: number, active: number) => `${listed} elencate, ${active} attive`,
  browserCache: "Cache del browser",
  appVersion: "Versione app",

  copyDetails: "Copia dettagli",

  output: "Output",
  copy: "Copia",
  save: "Salva",
} as const;
