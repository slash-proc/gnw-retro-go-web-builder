import type { OverviewRailStrings } from "./overviewRail.js";

export const overviewRailNo: OverviewRailStrings = {
  groupConsole: "Konsoll",
  groupLogs: "Logger",
  details: "Detaljer",

  externalFlash: "Ekstern flash",
  adapter: "Adapter",
  thisApp: "Denne appen",

  capacity: "Kapasitet",

  probe: "Programmeringsadapter",
  deviceUid: "Enhets-UID",

  sources: "Kilder",
  sourcesCount: (listed: number, active: number) => `${listed} oppført, ${active} i bruk`,
  browserCache: "Nettleser-cache",
  appVersion: "Appversjon",

  copyDetails: "Kopier detaljer",

  output: "Utdata",
  copy: "Kopier",
  save: "Lagre",
} as const;
