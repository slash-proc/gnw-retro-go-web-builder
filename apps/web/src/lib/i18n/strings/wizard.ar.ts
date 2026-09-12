import type { WizardStrings } from "./wizard.js";

// Log lines keep their English channel prefix (`backup:`, `sd:`, `frogfs:`, `device:`) and
// translate only the prose after it, as every sibling locale does: the prefix is a channel
// name a maintainer greps for, not copy.
//
// Navigation arrows are MIRRORED. In a right-to-left page "onward" points left, so
// `step3.continueButtonLabel` carries ←. (`spine.back` carried the other half of this rule
// until the chooser became one page and its Back button went away with the second one.)
export const wizardAr: WizardStrings = {
  step1: {
    titlePatch: "ترقيع الجهاز",
    titleBackupAndPatch: "نسخ احتياطي وترقيع",
    bodyBroken:
      "سيحدد هذا مجلد النسخ الاحتياطي ويُرقّع جهازك بالملفات الأصلية الناقصة. تأكد من وجود شحن كافٍ في جهازك ولا تفصله!",
    bodyNormal:
      "سيُطلب منك اختيار مجلد على حاسوبك. هذا مجلد مهم تُحفظ فيه نسخة البرنامج الثابت الأصلي لجهازك. لا تفقد هذه الملفات! بعد الاختيار يجري النسخ الاحتياطي والترقيع تلقائيًا.",
    confirmPatch: "ترقيع",
    confirmSelectFolderAndStart: "اختر المجلد وابدأ",
    phaseLocateBackup: "تحديد نسخة احتياطية موجودة",
    phaseReadDevice: "قراءة الجهاز (تفريغ)",
    phasePatch: "ترقيع البرنامج الثابت",
    phaseFlashInternal: "كتابة الفلاش الداخلي (البنك 1)",
    phaseFlashExternal: "كتابة الفلاش الخارجي",
    phaseRescan: "إعادة فحص الجهاز",
    logReusingBackup: (model: string, intBytes: number, extBytes: number) =>
      `backup: إعادة استخدام نسخة على القرص للطراز ${model}، داخلي ${intBytes} B، خارجي ${extBytes} B، دون قراءة الجهاز`,
    logNoBackupBroken: `backup: لا توجد نسخة صالحة على القرص وملفات الجهاز ناقصة، يتعذّر الإصلاح`,
    errMustSelectBackup:
      "ملفات الجهاز ناقصة. يجب أن تختار المجلد الذي يحتوي نسختك الاحتياطية الصالحة السابقة لإصلاحه.",
    logNoBackupReadingDevice: (model: string, extBytes: number) =>
      `backup: لا توجد نسخة صالحة على القرص، جارٍ تفريغ البرنامج الثابت الأصلي من الجهاز (الطراز ${model}، خارجي ${extBytes} B)`,
    errDumpedFirmwareMismatch: "البرنامج الثابت المُفرَّغ لا يطابق أي ROM أصلي معروف.",
    logDetectedModel: (model: string, intBytes: number, extBytes: number) =>
      `backup: التفريغ يطابق الأصلي ${model} (داخلي ${intBytes} B، خارجي ${extBytes} B)`,
    logSavingBackup: `backup: كتابة ملفات النسخة الداخلية والخارجية في المجلد المحدد`,
    buttonAction: (isBroken: boolean) => (isBroken ? "ترقيع" : "نسخ احتياطي وترقيع"),
    skip: "تخطٍ",
    titleBackupOnly: "نسخ البرنامج الثابت الأصلي",
    bodyBackupOnly:
      "سيُطلب منك اختيار مجلد على حاسوبك تُحفظ فيه نسخة من البرنامج الثابت الأصلي لجهازك. احتفظ بهذه الملفات في مكان آمن، فلا يمكنك تنزيلها مرة أخرى. لا شيء يُكتب على الجهاز: يحل Retro-Go محل البرنامج الثابت الأصلي في الخطوة التالية.",
    buttonBackupOnly: "نسخ احتياطي",
  },
  step2: {
    title: "تثبيت Retro-Go",
    bodyReinstall: "ستؤدي إعادة التثبيت إلى استبدال Retro-Go على جهازك.",
    bodyUpgrade: (tag: string) => `ستؤدي الترقية إلى ${tag} إلى استبدال Retro-Go على جهازك.`,
    bodyEraseWarning: "تحذير: يمسح هذا الألعاب والبيانات الموجودة.",
    confirmInstall: "تثبيت",
    confirmUpgrade: "الترقية",
    confirmDowngrade: "الرجوع لإصدار أقدم",
    checkboxMigrateGames: "نقل الألعاب",
    checkboxMigrateSaves: "نقل ملفات الحفظ",
    confirmGateSelectSdCard: "اختر بطاقة SD",
    phaseReadExistingState: "قراءة الحالة الموجودة",
    subReadPreviousGameState: "قراءة حالة الألعاب السابقة",
    subExtractCoresSaves: "استخراج الأنوية وملفات الحفظ",
    subMigrateInstalledGames: "نقل الألعاب المثبَّتة",
    phaseDownloadFirmware: "تنزيل البرنامج الثابت",
    phasePrepareInstallImage: "تحضير صورة التثبيت",
    subSetSdCacheBoundary: "ضبط حد الإزاحة المحجوزة لذاكرة SD",
    phaseBuildInstallImage: "بناء صورة التثبيت",
    subBuildGamesBiosLanguages: "الألعاب وBIOS واللغات",
    subBuildCoresSaves: "الأنوية وملفات الحفظ",
    subPatchSuperblock: "ترقيع الكتلة الفائقة",
    phaseFlashingRetroGo: "كتابة Retro-Go",
    phaseRescan: "إعادة فحص الجهاز",
    phaseSyncSdCores: "مزامنة أنوية SD",
    regionInternalFirmware: "البرنامج الثابت الداخلي",
    regionGamesBiosLanguages: "الألعاب وBIOS واللغات",
    regionCoresSaves: "الأنوية وملفات الحفظ",
    logMigrateSummary: (kind: string, migrateGames: boolean, migrateSaves: boolean) =>
      `migrate: ${kind}، games=${migrateGames}، saves=${migrateSaves}`,
    logMigrateKindReinstall: `إعادة تثبيت النسخة المثبَّتة`,
    logMigrateKindUpgrade: `ترقية`,
    logReadPreviousGameState: (hexOffset: string, length: number) =>
      `gamestate: قراءة حالة frogfs عند ${hexOffset}، نافذة ${length} B`,
    logCouldNotReadPreviousGameState: (hexOffset: string, length: number, message: string) =>
      `gamestate: فشلت القراءة عند ${hexOffset}، نافذة ${length} B، المتابعة دون الحالة السابقة: ${message}`,
    logExtractedSavesSettings: (count: number, bytes: number) =>
      `saves: استُخرجت ${count} مدخلات littlefs، ${bytes} B`,
    logCouldNotExtractSavesSettings: (message: string) =>
      `saves: فشل استخراج littlefs، المتابعة دون ملفات الحفظ والإعدادات: ${message}`,
    logMigratedGames: (count: number, bytes: number) =>
      `games: قُرئت ${count} ألعاب مثبَّتة من frogfs، ${bytes} B`,
    logSkippingGameMigration: (requested: boolean, installed: number) =>
      `games: تُخطّي النقل، requested=${requested}، installed=${installed}`,
    logTargetVersion: (tag: string) => `bundle: الإصدار الهدف ${tag}`,
    logNoVersion: `(لا شيء)`,
    logBundleDownloaded: (tag: string, bytes: number, ms: number) =>
      `bundle: نُزّل ${tag}، ${bytes} B في ${ms} ms`,
    logGamesBiosLanguagesBuilt: `frogfs: بُنيت صورة الألعاب وBIOS واللغات`,
    logCoresSavesBuilt: `littlefs: بُنيت صورة الأنوية وملفات الحفظ`,
    logSuperblockPatched: `superblock: رُقّعت داخل كتلة الفلاش الداخلي`,
    logSdCacheBoundarySet: (offset: number) =>
      `sdcache: ضُبطت الإزاحة المحجوزة على ${offset} B، تُبقي ذاكرة الألعاب الدوّارة بعيدة عن البيانات المحجوزة`,
    logConfirmingLinkResponsive: (alive: boolean, ms: number) =>
      `device: صندوق بريد المحمّل alive=${alive}، ${ms} ms`,
    logSdSyncStarting: `sd: مزامنة ملفات الأنوية إلى البطاقة`,
    logSdSyncFoundItems: (count: number, bytes: number) =>
      `sd: ${count} ملفات في محتوى SD للحزمة، ${bytes} B`,
    logSdSyncCopyingFile: (path: string, bytes: number) => `sd: كتابة ${path}، ${bytes} B`,
    logSdSyncGeneratingZip: (count: number) =>
      `sd: لا يوجد مقبض مجلد، بناء ملف مضغوط من ${count} ملفات`,
    sdSyncZipFilename: "retro-go-sd-cores.zip",
    upgradeButtonLabel: (tag: string) => `الترقية إلى ${tag}`,
    reinstallButtonLabel: "إعادة التثبيت",
    installButtonLabel: "تثبيت",
    versionLatest: "(الأحدث)",
  },
  step3: {
    continueButtonLabel: "المتابعة إلى المكتبة ←",
  },
  chooser: {
    title: "ماذا يجب أن يشغّل هذا الجهاز؟",
    whatIsRetroGo: "Retro-Go برنامج ثابت مخصص يشغّل ألعاب أجهزة أخرى على هذا الجهاز.",
    dualBoot: "إقلاع مزدوج",
    onlyRetroGo: "Retro-Go فقط",
    returnToStock: "العودة إلى الأصلي",
    escapePrompt: "شيء آخر؟",
    escapeAction: "استخدم تبويب الإعدادات المتقدمة",
    tooSmallForRetroGo: (mb: number) => `يحتاج Retro-Go إلى 8 MB. هذا الجهاز فيه ${mb} MB.`,
    tooSmallForDualBoot: (mb: number) => `يحتاج الإقلاع المزدوج إلى 16 MB. هذا الجهاز فيه ${mb} MB.`,
  },
  spine: {
    backupAndPatchOriginal: "نسخ وترقيع البرنامج الثابت الأصلي",
    backUpOriginal: "نسخ البرنامج الثابت الأصلي",
    installRetroGo: "تثبيت Retro-Go",
    addSources: "إضافة مصادر البرمجيات",
    addRoms: "الإضافة إلى المكتبة",
    selectBackup: "اختيار نسخة من البرنامج الثابت الأصلي",
    restoreOriginal: "استعادة البرنامج الثابت الأصلي",
    restoreButtonLabel: "استعادة",
    removeRetroGo: "إزالة Retro-Go",
    skipCaution:
      "لا يمكن التراجع عن هذا، وتنزيل البرنامج الثابت الأصلي غالبًا غير قانوني في بلدك.",
    skipAnyway: "تخطٍ على أي حال",
    chipOptional: "اختياري",
    runAgain: "تشغيل مرة أخرى",
    sourcesButtonLabel: "إضافة مصادر",
    selectFolderButtonLabel: "اختيار مجلد",
    backupFound: (model: string) => `عُثر على نسخة: ${model}`,
  },
  restore: {
    modalBody:
      "ستُعاد كتابة البرنامج الثابت الأصلي لجهازك تمامًا كما نُسخ. يمسح هذا Retro-Go وكل ما ثُبّت معه. الألعاب وملفات الحفظ والإعدادات لا تُنقل ولا يمكن استرجاعها بعد ذلك. أبقِ الجهاز موصولًا حتى تنتهي العملية.",
    confirm: "استعادة",
    needBackup: "اختر أولًا نسخة صالحة من البرنامج الثابت الأصلي لهذا الجهاز.",
    noneFound:
      "لم يُعثر على نسخة صالحة من البرنامج الثابت الأصلي في ذلك المجلد. يجب أن يحتوي على زوج ملفات النسخ المكتوب عند فتح قفل الجهاز.",
    wrongHardware: (backup: string, hardware: string) =>
      `تلك النسخة لبرنامج ${backup} الثابت، لكن هذا عتاد ${hardware}. كتابتها ستجعل الجهاز غير صالح للاستخدام، لذا لا يمكن استعادتها هنا.`,
    tooBig: (mb: string, capMb: string) =>
      `تحتاج تلك النسخة إلى ${mb} MB من الفلاش الخارجي، لكن هذا الجهاز فيه ${capMb} MB فقط.`,
    logRestoring: (model: string, intBytes: number, extBytes: number) =>
      `flash: استعادة الأصلي ${model} حرفيًا، داخلي ${intBytes} B ← البنك 1، خارجي ${extBytes} B ← البنك 0`,
  },
  common: {
    errOperationTimedOut:
      "انتهت مهلة العملية (قد يكون الجهاز معلّقًا). أعد تشغيل الجهاز وحاول مرة أخرى.",
    rescanningDeviceGeometry: `device: إعادة فحص البنية`,
  },
} as const;
