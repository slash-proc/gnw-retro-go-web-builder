import type { OverviewRailStrings } from "./overviewRail.js";

export const overviewRailEs: OverviewRailStrings = {
  groupConsole: "Consola",
  groupLogs: "Registros",
  details: "Detalles",

  externalFlash: "Flash externo",
  adapter: "Adaptador",
  thisApp: "Esta aplicación",

  capacity: "Capacidad",

  probe: "Sonda",
  deviceUid: "UID del dispositivo",

  sources: "Fuentes",
  sourcesCount: (listed: number, active: number) => `${listed} en la lista, ${active} activas`,
  browserCache: "Caché del navegador",
  appVersion: "Versión de la app",

  copyDetails: "Copiar detalles",

  output: "Salida",
  copy: "Copiar",
  save: "Guardar",
};
