import type { OverviewRailStrings } from "./overviewRail.js";

// Russian copy for Overview's rail and its Details pane. Every value here is a LABEL: no
// prose, and a value stands alone in its column.
export const overviewRailRu: OverviewRailStrings = {
  groupConsole: "Консоль",
  groupLogs: "Журналы",
  details: "Подробности",

  externalFlash: "Внешняя флеш-память",
  adapter: "Адаптер",
  thisApp: "Приложение",

  capacity: "Объём",

  probe: "Программатор",
  deviceUid: "UID устройства",

  sources: "Источники",
  sourcesCount: (listed: number, active: number) => `${listed} в списке, ${active} активно`,
  browserCache: "Кэш браузера",
  appVersion: "Версия приложения",

  copyDetails: "Скопировать подробности",

  output: "Вывод",
  copy: "Копировать",
  save: "Сохранить",
};
