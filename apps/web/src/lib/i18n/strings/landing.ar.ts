import type { LandingStrings } from "./landing.js";

// The two arrows are MIRRORED, not copied. In a right-to-left page the visual direction of
// travel reverses: "back" points right and "onward" points left. The glyph is chosen for the
// direction it will actually point after the page mirrors, and its position in the string is
// its logical position (first character sits rightmost in an RTL paragraph), so `back` keeps
// its arrow leading and `manageDeviceAdvanced` keeps its arrow trailing, exactly as English.
export const landingAr: LandingStrings = {
  title1: "منشئ الويب لأجهزة Game & Watch",
  mediaPrompt: "كيف عُدِّل جهازك؟",
  flashMemory: "ذاكرة الفلاش",
  flashMemoryDesc: "الألعاب مخزَّنة على شريحة الفلاش الداخلية.",
  sdCard: "بطاقة SD",
  sdCardDesc: "الألعاب مخزَّنة على تعديل بطاقة SD.",
  title2: "ماذا تريد أن تفعل؟",
  actionPrompt: "يمكنك التبديل في أي وقت بعد الدخول.",
  manageDevice: "إدارة الجهاز",
  manageDeviceDesc: "نسخ احتياطي وترقيع وتثبيت البرنامج الثابت. يتطلب مُحوِّلاً.",
  unsupportedBrowser: "يتطلب Chromium أو Chrome أو Edge.",
  manageDeviceAdvanced: "إدارة الجهاز (متقدم) ←",
  manageLibrary: "إدارة المكتبة",
  manageLibraryDesc: "كوّن مكتبتك وثبّتها.",
  back: "→ رجوع",
} as const;
