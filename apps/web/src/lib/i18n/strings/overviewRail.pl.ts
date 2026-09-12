import type { OverviewRailStrings } from "./overviewRail.js";

export const overviewRailPl: OverviewRailStrings = {
  groupConsole: "Konsola",
  groupLogs: "Dzienniki",
  details: "Szczegóły",

  externalFlash: "Pamięć zewnętrzna",
  adapter: "Adapter",
  thisApp: "Ta aplikacja",

  capacity: "Pojemność",

  probe: "Sonda",
  deviceUid: "UID urządzenia",

  sources: "Źródła",
  sourcesCount: (listed: number, active: number) => `${listed} na liście, ${active} aktywne`,
  browserCache: "Pamięć podręczna przeglądarki",
  appVersion: "Wersja aplikacji",

  copyDetails: "Kopiuj szczegóły",

  output: "Wyjście",
  copy: "Kopiuj",
  save: "Zapisz",
};
