import type { OverviewRailStrings } from "./overviewRail.js";

export const overviewRailPt: OverviewRailStrings = {
  groupConsole: "Consola",
  groupLogs: "Registos",
  details: "Detalhes",

  externalFlash: "Flash externa",
  adapter: "Adaptador",
  thisApp: "Esta aplicação",

  capacity: "Capacidade",

  // German reads "Programmieradapter": this row names the PROGRAMMER HARDWARE attached to
  // the device, not a software probe.
  probe: "Programador",
  deviceUid: "UID do dispositivo",

  sources: "Fontes",
  sourcesCount: (listed: number, active: number) => `${listed} listadas, ${active} ativas`,
  browserCache: "Cache do navegador",
  appVersion: "Versão da aplicação",

  copyDetails: "Copiar detalhes",

  output: "Saída",
  copy: "Copiar",
  save: "Guardar",
};
