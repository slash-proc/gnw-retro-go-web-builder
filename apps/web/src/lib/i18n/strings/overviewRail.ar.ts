import type { OverviewRailStrings } from "./overviewRail.js";

export const overviewRailAr: OverviewRailStrings = {
  groupConsole: "الجهاز",
  groupLogs: "السجلات",
  details: "التفاصيل",

  externalFlash: "الفلاش الخارجي",
  adapter: "المُحوِّل",
  thisApp: "هذا التطبيق",

  capacity: "السعة",

  probe: "المُبرمِج",

  sources: "المصادر",
  sourcesCount: (listed: number, active: number) => `${listed} مدرج، ${active} نشط`,
  browserCache: "ذاكرة المتصفح المؤقتة",
  appVersion: "إصدار التطبيق",

  copyDetails: "نسخ التفاصيل",

  output: "المُخرَجات",
  copy: "نسخ",
  save: "حفظ",
} as const;
