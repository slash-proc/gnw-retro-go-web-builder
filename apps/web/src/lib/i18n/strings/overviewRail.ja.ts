import type { OverviewRailStrings } from "./overviewRail.js";

export const overviewRailJa: OverviewRailStrings = {
  groupConsole: "本体",
  groupLogs: "ログ",
  details: "詳細",

  externalFlash: "外部フラッシュ",
  adapter: "アダプター",
  thisApp: "このアプリ",

  capacity: "容量",

  probe: "プローブ",
  deviceUid: "デバイス UID",

  sources: "ソース",
  sourcesCount: (listed: number, active: number) => `${listed} 件中 ${active} 件が有効`,
  browserCache: "ブラウザーキャッシュ",
  appVersion: "アプリのバージョン",

  copyDetails: "詳細をコピー",

  output: "出力",
  copy: "コピー",
  save: "保存",
};
