import type { SharedStrings } from "./shared.js";

/**
 * Arabic counts in four shapes, not two: one, two (a dual form of its own), three to ten, and
 * eleven upwards. `verifyHeadline` is the only string here that inflects a noun by a number, so
 * the rule lives beside it rather than in a shared helper nothing else would use.
 */
function blocksWord(n: number): string {
  if (n === 1) return "كتلة واحدة";
  if (n === 2) return "كتلتان";
  if (n >= 3 && n <= 10) return `${n} كتل`;
  return `${n} كتلة`;
}

function retriesWord(n: number): string {
  if (n === 1) return "محاولة واحدة";
  if (n === 2) return "محاولتين";
  if (n >= 3 && n <= 10) return `${n} محاولات`;
  return `${n} محاولة`;
}

export const sharedAr: SharedStrings = {
  common: {
    cancel: "إلغاء",
    close: "إغلاق",
    connect: "اتصال",
    connecting: "جارٍ الاتصال…",
    // The three fragments are joined with no literal space between them, so the spacing is
    // mine. Composed: "جارٍ العمل. لا تفصل جهازك."
    workingNotePre: "جارٍ العمل. ",
    workingNoteBold: "لا تفصل جهازك",
    workingNotePost: ".",
    done: "✓ تم.",
    changeEllipsis: "تغيير…",
    chooseEllipsis: "اختيار…",
    or: "أو",
  },
  confirmModal: {
    defaultConfirmText: "تأكيد",
  },
  splitButton: {
    moreOptions: "خيارات أخرى",
  },
  deviceControls: {
    deviceActions: "إجراءات الجهاز",
    rescan: "إعادة الفحص",
    restartRecoveryMode: "إعادة تشغيل وضع الاستعادة",
    startRecoveryMode: "بدء وضع الاستعادة",
    changeAdapter: "تغيير المُحوِّل",
    disconnectDevice: "فصل الجهاز",
  },
  stubLoadModal: {
    title: "الدخول إلى وضع الاستعادة؟",
    // Composed: "لتنفيذ هذا الإجراء (مثل قراءة الفلاش أو النسخ الاحتياطي أو تثبيت البرنامج
    // الثابت)، يجب أن يدخل الجهاز وضع الاستعادة. سيوقف هذا التطبيق العامل مؤقتًا."
    // The bold noun phrase ends the clause in Arabic as it does in English, so the split holds.
    body1Pre:
      "لتنفيذ هذا الإجراء (مثل قراءة الفلاش أو النسخ الاحتياطي أو تثبيت البرنامج الثابت)، يجب أن يدخل الجهاز ",
    body1Bold: "وضع الاستعادة",
    body1Post: ". سيوقف هذا التطبيق العامل مؤقتًا.",
    // Composed: "اضغط مع الاستمرار على زر الطاقة في الجهاز أثناء الاتصال، ثم ضع الجهاز جانبًا
    // ولا تلمسه حتى تنتهي العملية."
    // English puts the possessive BEFORE the bold ("the device's power button"); Arabic puts it
    // after, so "في الجهاز" moves into the Post fragment.
    body2Pre: "اضغط مع الاستمرار على ",
    body2Bold: "زر الطاقة",
    body2Post: " في الجهاز أثناء الاتصال، ثم ضع الجهاز جانبًا ولا تلمسه حتى تنتهي العملية.",
    continue: "متابعة",
  },
  connectGateModal: {
    title: "الجهاز مطلوب",
    subtitle: "وصّل مُحوِّل جهازك للمتابعة.",
    deviceConnectionTitle: "اتصال الجهاز",
    connectedFallback: "متصل",
    adapterHint: "مُحوِّل ST-Link v2 (أو متوافق)",
    chooseAdapter: "اختر المُحوِّل",
    connectionFailed: "فشل الاتصال.",
  },
  folderGateModal: {
    title: "المجلدات مطلوبة",
    romFolderTitle: "مجلد ملفات ROM",
    selectedFallback: "مُحدَّد",
    romFolderHint: "مجموعتك المحلية من ملفات ROM",
    reconnectLastFolder: "إعادة وصل آخر مجلد",
    scanning: "جارٍ الفحص…",
    sdCardFolderTitle: "مجلد بطاقة SD",
    sdCardFolderHint: "جذر وحدة بطاقة SD",
    errRead: "تعذّرت قراءة هذا المجلد.",
    continue: "متابعة",
  },
  auditLog: {
    title: "النشاط",
    empty: "لا شيء لعرضه بعد.",
    reloaded: "أُعيد التحميل",
    sessions: "الجلسات",
    sevAll: "الكل",
    sevDebug: "تصحيح",
    sevInfo: "معلومات",
    sevWarning: "تحذير",
    sevError: "خطأ",
    srcConverter: "المحوِّل",
    srcDevice: "الجهاز",
    srcSources: "المصادر",
    filterPlaceholder: "تصفية",
    showing: (shown: number, total: number) => `عرض ${shown} من ${total}`,
    copy: "نسخ",
    save: "حفظ",
    saveFilename: "gnw-activity.txt",
    notificationsTitle: "الإشعارات",
    noneWaiting: "لا نشاط بعد",
    openActivity: "فتح النشاط",
    clearNotifications: "مسح",
    dismissNotification: "تجاهل",
    recoveryFailed: (reason: string) => `لم يبدأ وضع الاستعادة: ${reason}`,
    connectFailed: (reason: string) => `تعذر الاتصال: ${reason}`,
    scanFailed: (reason: string) => `لم يكتمل الفحص: ${reason}`,
    foldersFailed: (reason: string) => `تعذرت قراءة المجلدات: ${reason}`,
    cheatsFailed: (reason: string) => `تعذر تحميل أكواد الغش: ${reason}`,
  },
  installProgressModal: {
    logLabel: (count: number) => `السجل (${count})`,
    saveLog: "حفظ السجل",
    copyLog: "نسخ السجل",
    blocksFailed: "الكتل التي فشلت",
    blockLabel: (n: number) => `الكتلة ${n}`,
    verifyHeadline: (blocks: number, retries: number) =>
      `لم تتطابق ${blocksWord(blocks)} بعد ${retriesWord(retries)}.`,
    partlyWrittenBank: (bank: number) => `البنك ${bank} مكتوب جزئيًا ولن يُقلع.`,
    partlyWrittenExt: "الفلاش الخارجي مكتوب جزئيًا.",
    wiringAdvice: "تكرار فشل الكتل سببه غالبًا توصيل المُبرمِج. أعد تركيبه ثم أعد المحاولة.",
    cancelCaption: "يتوقف بعد الكتلة الحالية",
    cancelPending: "جارٍ الإيقاف",
    cancelTitle: "إيقاف الكتابة؟",
    cancelBody: "ما كُتب يبقى مكتوبًا. التثبيت غير مكتمل حتى تشغّله مرة أخرى.",
    cancelKeep: "متابعة الكتابة",
    cancelStop: "إيقاف",
    cancelledNote: "توقف. التثبيت غير مكتمل.",
    logStopping: "سيتوقف عند حد الكتلة التالية.",
    logStopped: "توقف.",
  },
  geometry: {
    freeSpace: "مساحة حرة",
    games: "الألعاب وبرامج Homebrew",
    coresAndSaves: "الأنوية وملفات الحفظ",
    bankLabel: (n: number) => `البنك ${n}`,
    bankUnknown: "—",
    used: "مستخدَم",
    free: "متاح",
    bankFree: (n: number) => `المتاح في البنك ${n}`,
    empty: "فارغ",
    externalFlash: "الفلاش الخارجي",
    reservedSdCache: "محجوز (ذاكرة SD المؤقتة)",
  },
  units: {
    b: "B",
    kb: "KB",
    mb: "MB",
    gb: "GB",
    space: " ",
  },
} as const;
