import type { OverviewRailStrings } from "./overviewRail.js";

export const overviewRailUk: OverviewRailStrings = {
  groupConsole: "Консоль",
  groupLogs: "Журнали",
  details: "Подробиці",

  externalFlash: "Зовнішня флеш-пам’ять",
  adapter: "Адаптер",
  thisApp: "Застосунок",

  capacity: "Обсяг",

  probe: "Програматор",
  deviceUid: "UID пристрою",

  sources: "Джерела",
  // Label-and-value on both halves, so neither number has to agree with a noun: `активних: 1`
  // and `активних: 5` are both correct, where a bare `1 активних` would not be.
  sourcesCount: (listed: number, active: number) => `у списку: ${listed}, активних: ${active}`,
  browserCache: "Кеш браузера",
  appVersion: "Версія застосунку",

  copyDetails: "Копіювати подробиці",

  output: "Вивід",
  copy: "Копіювати",
  save: "Зберегти",
} as const;
