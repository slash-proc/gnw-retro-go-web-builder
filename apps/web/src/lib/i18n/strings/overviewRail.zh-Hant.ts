import type { OverviewRailStrings } from "./overviewRail.js";

export const overviewRailZhHant: OverviewRailStrings = {
  groupConsole: "主機",
  groupLogs: "紀錄",
  details: "詳細資料",

  externalFlash: "外部快閃記憶體",
  adapter: "轉接器",
  thisApp: "本程式",

  capacity: "容量",

  probe: "燒錄轉接器",
  deviceUid: "裝置 UID",

  sources: "來源",
  sourcesCount: (listed: number, active: number) => `列出 ${listed} 個，啟用 ${active} 個`,
  browserCache: "瀏覽器快取",
  appVersion: "程式版本",

  copyDetails: "複製詳細資料",

  output: "輸出",
  copy: "複製",
  save: "儲存",
};
