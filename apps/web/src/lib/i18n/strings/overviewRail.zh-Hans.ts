import type { OverviewRailStrings } from "./overviewRail.js";

export const overviewRailZhHans: OverviewRailStrings = {
  groupConsole: "主机",
  groupLogs: "日志",
  details: "详细信息",

  externalFlash: "外部闪存",
  adapter: "适配器",
  thisApp: "本应用",

  capacity: "容量",

  probe: "调试器",
  deviceUid: "设备 UID",

  sources: "源",
  sourcesCount: (listed: number, active: number) => `已列出 ${listed} 个，启用 ${active} 个`,
  browserCache: "浏览器缓存",
  appVersion: "应用版本",

  copyDetails: "复制详细信息",

  output: "输出",
  copy: "复制",
  save: "保存",
};
