import type { OverviewRailStrings } from "./overviewRail.js";

export const overviewRailDe: OverviewRailStrings = {
  groupConsole: "Konsole",
  groupLogs: "Protokolle",
  details: "Details",

  externalFlash: "Externer Flash-Speicher",
  adapter: "Adapter",
  thisApp: "Diese App",

  capacity: "Kapazität",

  probe: "Programmieradapter",
  deviceUid: "Geräte-UID",

  sources: "Quellen",
  sourcesCount: (listed: number, active: number) => `${listed} gelistet, ${active} aktiv`,
  browserCache: "Browser-Cache",
  appVersion: "App-Version",

  copyDetails: "Details kopieren",

  output: "Ausgabe",
  copy: "Kopieren",
  save: "Speichern",
};
