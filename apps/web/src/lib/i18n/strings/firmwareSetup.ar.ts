import type {
  AdvancedStrings,
  OfficialFirmwareStrings,
  RomSectionStrings,
  DumpSectionStrings,
  FlashSectionStrings,
  EraseSectionStrings,
  FileBrowserSectionStrings,
  RetroGoTabStrings,
} from "./firmwareSetup.js";

export const advancedAr: AdvancedStrings = {
  tabbarLabel: "أدوات متقدمة",
  tabOverview: "نظرة عامة",
  tabFirmwareSetup: "البرنامج الثابت",
  tabRoms: "المكتبة",
  waitingForDevice: "في انتظار اتصال بجهاز…",
  modeGuidedSetup: "موجَّه",
  modeAdvanced: "متقدم",
  // The accessible name of a B / KB / MB selector: a unit of measure, not the console unit.
  unitLabel: "الوحدة",
} as const;

export const officialFirmwareAr: OfficialFirmwareStrings = {
  pageSubtitle: "احفظ برنامجك الثابت الأصلي، ثم رقّعه ليتمكن برنامج ثابت مخصص من الإقلاع.",
  step1Title: "نسخة البرنامج الثابت",
  chromiumRequired: "يحتاج اختيار المجلد إلى متصفح Chromium (مثل WebUSB).",
  pickFolderIntro:
    "اختر مجلدًا يحتوي نسخك الأصلية، أو مجلدًا فارغًا لحفظ نسخة فيه.",
  // Composed around two mono filenames the template puts between them:
  // "نبحث عن <file> + <file> ونتحقق منها."
  pickFolderLookForPre: "نبحث عن",
  pickFolderBodyPost: "ونتحقق منها.",
  internalBackupFilename: "internal_flash_backup_*.bin",
  externalBackupFilename: "flash_backup_*.bin",
  chooseBackupFolder: "اختر مجلد النسخ",
  reconnectLastFolder: "إعادة وصل آخر مجلد",
  // Arabic marks one, two and many on the noun itself, so the boolean picks a whole phrase
  // rather than toggling a suffix the way the English does.
  backupsFoundLegend: (plural: boolean) =>
    plural ? "نسخ أصلية موجودة في هذا المجلد" : "نسخة أصلية موجودة في هذا المجلد",
  invalidChip: (internalOk: boolean, externalOk: boolean) =>
    `✗ غير صالحة (داخلي ${internalOk ? "✓" : "✗"}، خارجي ${externalOk ? "✓" : "✗"})`,
  validBackupSelected: (model: string) => `✓ اختيرت نسخة أصلية صالحة للطراز ${model}.`,
  backupFailedValidation: (model: string, internalOk: boolean, externalOk: boolean) =>
    `فشل التحقق من نسخة ${model} (داخلي ${internalOk ? "✓" : "✗"}، خارجي ${externalOk ? "✓" : "✗"}). خذ نسخة جديدة أدناه.`,
  noBackupYet: "لا توجد نسخة أصلية في هذا المجلد بعد؛ انسخ واحدة من الجهاز المتصل.",
  foundChip: "موجودة",
  changeFolder: "تغيير المجلد",
  backUpAgain: "نسخ هذا الجهاز مرة أخرى",
  rowValid: "صالحة",
  step2BodyThis: (model: string) => `يُرقّع نسخة ${model} ويكتبها مرة أخرى على الجهاز.`,
  step2BodySelected: "يُرقّع النسخة المحددة ويكتبها مرة أخرى على الجهاز.",
  // Composed: "هذا الجهاز يعمل بالفعل ببرنامج ثابت [Retro-Go مُرقَّع]، فلا يوجد عليه برنامج
  // ثابت أصلي لنسخه. لتثبيت برنامج ثابت رسمي [مختلف] (مثل Mario ↔ Zelda)، اختر أعلاه مجلدًا
  // يحتوي نسخة أصلية من Mario أو Zelda، ثم رقّعه أدناه."
  // English puts the noun "firmware" AFTER the first bold; Arabic puts it before, so it moves
  // into the Pre fragment. The second bold is an adjective and follows its noun in Arabic,
  // which is where the template already places it.
  alreadyPatchedNoticePre: "هذا الجهاز يعمل بالفعل ببرنامج ثابت ",
  alreadyPatchedNoticeBold: "Retro-Go مُرقَّع",
  alreadyPatchedNoticePost: "، فلا يوجد عليه برنامج ثابت أصلي لنسخه. لتثبيت برنامج ثابت رسمي ",
  alreadyPatchedNoticeDifferentBold: "مختلف",
  alreadyPatchedNoticeEnd:
    " (مثل Mario ↔ Zelda)، اختر أعلاه مجلدًا يحتوي نسخة أصلية من Mario أو Zelda، ثم رقّعه أدناه.",
  backingUp: "جارٍ النسخ…",
  backUpNow: "انسخ الآن",
  connectToBackUp: "وصّل جهازًا للنسخ.",
  lockedCannotBackUp:
    "هذا الجهاز مقفل، فلا يمكن قراءة فلاشه الداخلي ولا يوجد هنا ما يُنسخ.",
  step2Title: "ترقيع البرنامج الثابت",
  installBootloaderLabel: "تثبيت محمّل الإقلاع",
  installBootloaderHint: "(مستحسن)",
  // The English says "Cross-model:" for BOTH the dangerous and the permitted case. German
  // separates them and Arabic follows it: a conflict and a switch are not the same event.
  crossModelDangerBold: "⚠ تعارض الطرازين:",
  crossModelDangerBody:
    "هذا برنامج Zelda الثابت، لكن العتاد المتصل فُحص كطراز Mario. عتاد Mario تنقصه زرّان يحتاجهما Zelda، فقد تكون النتيجة غير صالحة جزئيًا.",
  crossModelAck: "أفهم ذلك وأريد كتابة برنامج Zelda الثابت على عتاد Mario على أي حال",
  crossModelAllowedBold: "تبديل الطراز:",
  crossModelAllowedNote: (backupModel: string, deviceModel: string) =>
    `هذا برنامج ${backupModel} الثابت على عتاد ${deviceModel}. يعمل ذلك لأن ${deviceModel} يملك كل الأزرار التي يستخدمها ${backupModel}، لكن الجهاز سيتصرف كوحدة ${backupModel}.`,
  tooBigNotice: (model: string, backupMb: string, deviceMb: string) =>
    `⛔ الصورة الخارجية لنسخة ${model} (${backupMb} MB) أكبر من الفلاش الخارجي لهذا الجهاز (${deviceMb} MB)؛ لن تتسع فعليًا ولا يمكن كتابتها هنا.`,
  // German reads this as "overwrites", which the body confirms; "overlaps" understates it.
  overlapWarnBold: "يستبدل بيانات مثبَّتة:",
  overlapWarnBody: (mb: string) =>
    `يكتب الترقيع ${mb} MB في بداية الفلاش الخارجي. كل ما هو مثبَّت هناك (الألعاب وHomebrew، الأنوية وملفات الحفظ) سيحتاج إعادة تثبيت.`,
  enteringRecoveryMode: "جارٍ الدخول إلى وضع الاستعادة…",
  enterRecoveryMode: "ادخل وضع الاستعادة",
  patchFirmwareButton: "ترقيع البرنامج الثابت",
  patchAnywayButton: "ترقيع على أي حال",
  footerSummary: "تبقى نسختك الأصلية على القرص. هذا يعيد كتابة الجهاز فقط.",
  footerSummaryCross: "اقرأ التحذير أعلاه قبل المتابعة.",
  connectToPatchAndFlash: "وصّل جهازًا للترقيع والكتابة.",
  patchedAndFlashed: "✓ رُقّع وكُتب.",
  modalBodyBase: (model: string, withBootloader: boolean) =>
    `يُرقّع البرنامج الثابت الأصلي ${model}${withBootloader ? " (مع محمّل إقلاع بطاقة SD)" : ""} ويكتبه: الداخلي ← البنك 1، الخارجي ← البنك 0. لا تحرّك الجهاز ولا تفصله أثناء الكتابة؛ قد تفشل العملية.`,
  modalBodyDangerPrefix: (base: string) =>
    `⚠ أنت تكتب برنامج ZELDA الثابت على عتاد MARIO، وتنقصه زرّان يحتاجهما Zelda. ${base}`,
  modalTitle: "ترقيع البرنامج الثابت الرسمي وكتابته؟",
  modalConfirmText: "ترقيع وكتابة",
  phasePatch: "ترقيع البرنامج الثابت",
  phaseFlashInternal: "كتابة الفلاش الداخلي (البنك 1)",
  phaseFlashExternal: "كتابة الفلاش الخارجي",
  phaseRescan: "إعادة فحص الجهاز",
  errDeviceLocked:
    "هذا الجهاز مقفل (حماية القراءة RDP). لا يمكن قراءة الفلاش الداخلي لجهاز مقفل، فلا يمكن نسخ برنامجه الثابت. الكتابة على الجهاز تفتح قفله، وفتح القفل يمسح الأصل.",
  unlockModalTitle: "فتح قفل هذا الجهاز؟",
  unlockModalBody:
    "تتطلب الكتابة على هذا الجهاز فتح قفله، وفتح القفل يمسح الفلاشين معًا. لا يمكن قراءة الفلاش الداخلي لجهاز مقفل، فلا يمكن حفظ برنامجه الثابت الأصلي أولًا: سيضيع نهائيًا.",
  unlockModalConfirm: "فتح القفل والمسح",
  unlockErasing: "unlock: إزالة حماية القراءة، وهذا يمسح الفلاشين معًا",
  unlockDone: "unlock: أُزيلت حماية القراءة",
  unlockDeclined: "unlock: رُفض، فالجهاز ما زال مقفلًا ولم يُكتب شيء",
  errFirmwareMismatch: "البرنامج الثابت المُفرَّغ لا يطابق أي ROM أصلي معروف لـ Mario أو Zelda؛ لم تُحفظ النسخة.",
  logPatchingModel: (model: string, intBytes: number, extBytes: number) =>
    `patch: ترقيع الأصلي ${model}، داخلي ${intBytes} B، خارجي ${extBytes} B`,
} as const;

export const romSectionAr: RomSectionStrings = {
  regionIntflash: "البرنامج الثابت الداخلي",
  regionFrogfs: "الألعاب وBIOS واللغات",
  regionLittlefs: "الأنوية وملفات الحفظ",
  phasePrepare: "تحضير الجهاز",
  phaseDownload: "تنزيل البرنامج الثابت",
  phaseMigrateScan: "قراءة الحالة الموجودة",
  subFrogfsState: "قراءة حالة الألعاب السابقة",
  subLfsExtract: "استخراج الأنوية وملفات الحفظ",
  subGamesMigrate: "نقل الألعاب المثبَّتة",
  phasePrepareInstallImage: "تحضير صورة التثبيت",
  subSdCache: "ضبط حد الإزاحة المحجوزة لذاكرة SD",
  phaseBuildInstallImage: "بناء صورة التثبيت",
  subBuildFrogfs: "الألعاب وBIOS واللغات",
  subBuildLittlefs: "الأنوية وملفات الحفظ",
  subPatchSuperblock: "ترقيع الكتلة الفائقة",
  phaseFlashingToDevice: "الكتابة على الجهاز",
  phaseRescan: "إعادة فحص الجهاز",
  phaseSyncSdCores: "مزامنة الأنوية إلى بطاقة SD",
  chooseSdCard: "اختر بطاقة SD",
  flashRetroGo: "كتابة Retro-Go",
  flashThisInstall: "كتابة هذا التثبيت؟",
  flashRegions: (joined: string) => `كتابة ${joined}؟`,
  regionInternalFirmware: "البرنامج الثابت الداخلي",
  regionGamesBiosLanguages: "الألعاب وBIOS واللغات",
  regionCoresSaves: "الأنوية وملفات الحفظ",
  flashBody: (writes: string) => `يكتب: ${writes}. لا تفصل جهازك حتى تنتهي العملية.`,
  nameInternalFirmware: (bank: number) => `البرنامج الثابت الداخلي ← البنك ${bank}`,
  nameGamesBiosLanguages: (addr: string) => `الألعاب وBIOS واللغات ← خارجي ${addr}`,
  nameCoresSaves: (addr: string) => `الأنوية وملفات الحفظ ← خارجي ${addr}`,
  flashConfirmText: "كتابة",
  selectSdCard: "اختر بطاقة SD",
  logConnectingFlashUtil: `device: جارٍ الاتصال وتحميل أداة الفلاش`,
  logFlashUtilReady: (extBytes: number, blockSize: number) =>
    `device: أداة الفلاش جاهزة، الفلاش الخارجي ${extBytes} B، كتلة المسح ${blockSize} B`,
  errNoVersionsPublished: "لم تُنشر أي إصدارات من البرنامج الثابت بعد.",
  logDownloadingBundle: (tag: string) => `bundle: تنزيل ${tag}`,
  logBundleDownloaded: (tag: string, bytes: number, ms: number) =>
    `bundle: نُزّل ${tag}، ${bytes} B في ${ms} ms`,
  logSameVersionRepair: (tag: string) =>
    `migrate: إصلاح النسخة نفسها ${tag}، فرض تفعيل نقل الألعاب`,
  logMigrateSummary: (tag: string, migrateGames: boolean, migrateLfs: boolean) =>
    `migrate: الهدف ${tag}، games=${migrateGames}، saves=${migrateLfs}`,
  logReadPreviousGameState: (hexOffset: string, length: number) =>
    `gamestate: قراءة حالة frogfs عند ${hexOffset}، نافذة ${length} B`,
  logCouldNotReadPreviousGameState: (hexOffset: string, length: number, message: string) =>
    `gamestate: فشلت القراءة عند ${hexOffset}، نافذة ${length} B، المتابعة دون الحالة السابقة: ${message}`,
  logExtractedSavesData: (count: number, bytes: number) =>
    `saves: استُخرجت ${count} مدخلات littlefs، ${bytes} B`,
  logCouldNotExtractSavesData: (message: string) =>
    `saves: فشل استخراج littlefs، المتابعة دون ملفات الحفظ والإعدادات: ${message}`,
  logMigratedGames: (count: number) => `games: قُرئت ${count} ألعاب مثبَّتة من frogfs`,
  logSkippedGameMigration: (requested: boolean, installed: number) =>
    `games: تُخطّي النقل، requested=${requested}، installed=${installed}`,
  logGamesBiosLanguagesBuilt: `frogfs: بُنيت صورة الألعاب وBIOS واللغات`,
  logCoresSavesBuilt: `littlefs: بُنيت صورة الأنوية وملفات الحفظ`,
  logSuperblockPatched: `superblock: رُقّعت داخل كتلة الفلاش الداخلي`,
  logSdCacheBoundarySet: (offset: number) => `sdcache: ضُبطت الإزاحة المحجوزة على ${offset} B، تُبقي ذاكرة ROM الدوّارة بعيدة عن البيانات المحجوزة`,
  logConfirmingLinkResponsive: (alive: boolean, ms: number) =>
    `device: صندوق بريد المحمّل alive=${alive}، ${ms} ms`,
  errExternalPayloadTooBig: (payloadMb: string, deviceMb: string) =>
    `الحمولة الخارجية (${payloadMb} MB) تتجاوز الفلاش الخارجي لهذا الجهاز (${deviceMb} MB)؛ تعذّرت الكتابة.`,
  logRescanning: `device: إعادة فحص البنية والألعاب المثبَّتة`,
  logSdSyncFoundItems: (count: number, bytes: number) =>
    `sd: ${count} ملفات في محتوى SD للحزمة، ${bytes} B`,
  logSdSyncCopyingFile: (path: string, bytes: number) => `sd: كتابة ${path}، ${bytes} B`,
  logSdSyncNoHandleZipFallback: (count: number) =>
    `sd: لا يوجد مقبض مجلد، بناء ملف مضغوط من ${count} ملفات`,
  sdSyncZipFilename: "retro-go-sd-cores.zip",
  installVersionLabel: "الإصدار",
  refreshVersions: "البحث عن إصدارات جديدة",
  migrateGamesLabel: "الاحتفاظ بالألعاب المثبَّتة",
  migrateSavesLabel: "الاحتفاظ بملفات الحفظ والإعدادات",
  bankTargetLabel: "الوجهة",
  bankReplacesStock: "يحل محل الأصلي",
  bankDualBoot: "إقلاع مزدوج",
  retroGoOnlyNotice:
    "لم يُكتشف برنامج ثابت أصلي في البنك 1، فالوجهة المستنتجة هي البنك 1؛ سيكون هذا تثبيتًا لـ Retro-Go وحده (دون إقلاع مزدوج).",
  bank1StockOfwNotice:
    "يحتوي البنك 1 على برنامج ثابت أصلي غير مُرقَّع؛ لن تصل إلى Retro-Go حتى يُرقَّع (انظر «نسخ وترقيع» أعلاه).",
  installOriginMismatchNotice: (deviceBuild: string, viewingMode: string) =>
    `يبدو الجهاز بنسخة ${deviceBuild}. أنت تعرض وضع ${viewingMode}.`,
  layoutAdvancedToggle: "توزيع متقدم",
  footerSummary: (size: string, bank: number, dualBoot: boolean) =>
    `يكتب ${size} إلى البنك ${bank}${dualBoot ? "، مع الاحتفاظ بالبرنامج الثابت الأصلي" : ""}`,
  sdCacheOffsetLabel: "إزاحة ذاكرة SD",
  frogfsOffsetLabel: "إزاحة FrogFS",
  offsetHint: "(بايتات من 0x90000000؛ تحجز المنطقة السفلية)",
  autoPlaceholder: (hex: string) => `تلقائي (${hex})`,
  littlefsSizeLabel: "حجم LittleFS",
  littlefsSizeHint: "(‏8 MB أو أكثر)",
  littlefsSizePlaceholder: "8",
  mbUnit: "MB",
  layoutDefaultsNote: (blockSize: number) =>
    `الافتراضي: تحجز إزاحة FrogFS المنطقة السفلية تلقائيًا حسب توزيع الجهاز. كلاهما يُقرَّب إلى كتلة المسح ${blockSize} B.`,
  scanningProgress: (pct: number) => `جارٍ الفحص… ${pct}%`,
  scanFailed: (err: string) => `فشل الفحص: ${err}`,
  scanToSeeLayout: "افحص الجهاز لرؤية توزيع الفلاش الحالي.",
  connectToSizeAndFlash: "وصّل جهازًا لقياس التثبيت وكتابته.",
  wellFrogfsLine: (range: string, mib: string) => `FrogFS   ${range}، ${mib} MB`,
  wellLittlefsLine: (range: string, mib: string) => `LittleFS ${range}، ${mib} MB`,
  wellDeviceEndLine: (devEnd: string, blockSize: number, freeMib: string) =>
    `نهاية الجهاز ${devEnd}، الكتلة ${blockSize} B، المتاح ${freeMib} MB`,
  wellChecksLine: (endsAtChip: boolean, noOverlap: boolean, aligned: boolean) =>
    `الفحوص: ينتهي عند الشريحة ${endsAtChip ? "✓" : "✗"}، لا تداخل ${noOverlap ? "✓" : "✗"}، محاذى ${aligned ? "✓" : "✗"}`,
  wellSystemsLine: (systems: string) => `الأجهزة: ${systems || "(لا شيء)"}`,
  startBankLabel: (bank: number) => `تشغيل البنك ${bank}`,
  readBackSuperblockDebug: "إعادة قراءة الكتلة الفائقة (تصحيح)",
  startedBankResult: (bank: number) =>
    `شُغّل البنك ${bank}. يعمل الجهاز الآن بذلك البرنامج الثابت؛ لم يعد المحمّل نشطًا؛ أعد الاتصال أو أعد تشغيل الجهاز لاستخدام التطبيق مجددًا.`,
} as const;

export const dumpSectionAr: DumpSectionStrings = {
  scanningDevice: "جارٍ فحص الجهاز…",
  intro: "اقرأ منطقة من الفلاش إلى ملف على حاسوبك.",
  internalFlashTitle: "الفلاش الداخلي",
  externalFlashTitle: "الفلاش الخارجي",
  barHint: "انقر قسمًا لملء المدى، أو اكتبه بنفسك.",
  offsetLabel: "البداية",
  offsetPlaceholder: "0x90000000",
  lengthLabel: "الحجم",
  lengthPlaceholder: "المنطقة كاملة",
  lockedNotice:
    "🔒 لا يمكن قراءة الفلاش الداخلي والجهاز مقفل، وفتح قفله يمسح محتوياته، فلا يوجد هنا ما يُفرَّغ. (البنك 0 والفلاش الخارجي يبقيان قابلين للقراءة.)",
  overrunWarning: (clamped: string) => `الطول يتجاوز المنطقة؛ سيُقصَر إلى ${clamped} بايت.`,
  planCaption: "الخطة",
  // A finite verb, as German's "Liest" confirms: the row says what the operation does.
  readsRow: "يقرأ",
  matchesPartition: (name: string) => `يطابق ${name}`,
  toFileRow: "إلى ملف",
  bytesValue: (bytes: string) => `${bytes} بايت`,
  enterRecoveryMode: "ادخل وضع الاستعادة",
  dumpToFile: "تفريغ إلى ملف",
  footerSummary: "يقرأ عبر SWD. يبقى الجهاز دون تغيير.",
  invalidHint: "أدخل إزاحة وطولًا صالحين.",
  progressLabel: (done: string, total: string) => `${done} / ${total} KB`,
  cancel: "إلغاء",
  cancelHint: "القراءة غير مدمِّرة؛ الإلغاء يتجاهل التفريغ الجزئي (لا ملف).",
  resultSummary: (mib: string, secs: number) => `قُرئ ${mib} MB في ${secs} ث`,
} as const;

export const flashSectionAr: FlashSectionStrings = {
  scanningDevice: "جارٍ فحص الجهاز…",
  enterRecoveryMode: "ادخل وضع الاستعادة",
  intro: "اكتب ملف .bin خامًا إلى بنك عند إزاحة.",
  imageFileLabel: "ملف الصورة",
  chooseImage: "اختر صورة",
  internalFlashTitle: "الفلاش الداخلي",
  externalFlashTitle: "الفلاش الخارجي",
  barHint: "انقر قسمًا لملء الوجهة، أو اكتبها بنفسك.",
  offsetLabel: "البداية",
  offsetPlaceholder: "0x08100000",
  compressLabel: "ضغط النقل",
  verifyLabel: "التحقق بعد الكتابة",
  lockedNotice:
    "🔒 الفلاش الداخلي مقفل، فالكتابة تفتح قفل الجهاز أولًا، وهذا يمسح الفلاشين معًا. (البنك 0 والفلاش الخارجي يبقيان قابلين للكتابة.)",
  alignWarning: (align: number, kind: string) =>
    `يجب أن تكون الإزاحة من مضاعفات ${align} (محاذاة الفلاش ${kind}).`,
  overrunWarning: (region: string) => `الصورة تتجاوز المنطقة ${region} B.`,
  ackLabel: "أفهم أن هذا يستبدل كل ما هو موجود الآن.",
  planCaption: "الخطة",
  writesRow: "يكتب",
  destinationRow: "الوجهة",
  overwritesRow: "يستبدل",
  bytesValue: (bytes: string) => `${bytes} بايت`,
  padCaption: (size: string, paddedHex: string, padded: string) =>
    `${size} ← يُحشى إلى ${paddedHex}، ${padded} بمحاذاة المسح`,
  flashImageButton: "كتابة الصورة",
  footerSummary: "يكتب صورة خامًا. بلا ترقيع وبلا تغيير في التوزيع.",
  modalTitle: "كتابة هذه الصورة؟",
  modalConfirmText: "كتابة",
  planBody: (
    bank: number,
    base: string,
    offset: string,
    filename: string,
    size: string,
    padded: string,
  ) =>
    `الخطة: bank${bank} (${base}) + ${offset} ← ${filename} (${size} B، محشوة ← ${padded}). ` +
    `لا تفصل جهازك حتى تنتهي العملية.`,
  phaseFlashingImage: "كتابة الصورة",
  extIntWordExt: "خارجي",
  extIntWordInt: "داخلي",
} as const;

export const eraseSectionAr: EraseSectionStrings = {
  scanningDevice: "جارٍ فحص الجهاز…",
  enterRecoveryMode: "ادخل وضع الاستعادة",
  intro: "اختر الأقسام التي تريد مسحها. لا يمكن التراجع عن هذا.",
  internalFlashTitle: "الفلاش الداخلي",
  externalFlashTitle: "الفلاش الخارجي",
  barHint: "انقر الأقسام لتحديدها. استخدم Ctrl / Cmd لأكثر من واحد.",
  customRange: "مدى مخصص…",
  lockedNotice:
    "🔒 الفلاش الداخلي مقفل، فمسحه يفتح قفل الجهاز أولًا، وهذا يمسح الفلاشين معًا على أي حال. (الفلاش الخارجي يبقى قابلًا للمسح.)",
  selectedTitle: "المحدد",
  bankWipeWarning: "مسح بنك داخلي يمحو النظام الموجود عليه، سواء البرنامج الثابت الأصلي أو Retro-Go.",
  // Arabic inflects the noun by the count, so the whole phrase is chosen rather than a suffix.
  eraseButton: (count: number, plural: boolean) =>
    plural ? `مسح ${count} أقسام…` : `مسح قسم واحد…`,
  footerSummary: (size: string) => `سيُمسح ${size}. لا يمكن التراجع عن هذا.`,
  modalTitle: (count: number, plural: boolean) =>
    plural ? `مسح ${count} أقسام؟` : `مسح قسم واحد؟`,
  modalBody: (plural: boolean) =>
    plural
      ? "سيمسح هذا الأقسام المحددة نهائيًا بملئها بـ 0xFF. ستضيع أي بيانات أو برنامج ثابت عليها."
      : "سيمسح هذا القسم المحدد نهائيًا بملئه بـ 0xFF. ستضيع أي بيانات أو برنامج ثابت عليه.",
  modalConfirmText: "مسح",
  phaseErase: "مسح",
  phaseRescan: "إعادة فحص الجهاز",
  partitionAtFallback: (addr: string) => `قسم عند ${addr}`,
  erasingLog: (label: string, size: string, addr: string) =>
    `flash: مسح ${label}، ${size} B عند ${addr}`,
  partitionFallback: "قسم",
  rescanningLog: `device: إعادة فحص البنية`,
  selectedSizeAt: (size: string, addr: string) => `${size} بايت عند ${addr}`,
} as const;

export const fileBrowserSectionAr: FileBrowserSectionStrings = {
  intro: "اختر قسمًا أعلاه لقراءة محتوياته.",
  frogfsTitle: "الألعاب وHomebrew ‏(FrogFS)",
  internalFlashTitle: "الفلاش الداخلي",
  externalFlashTitle: "الفلاش الخارجي",
  littlefsTitle: "الأنوية وملفات الحفظ ‏(LittleFS)",
  noFrogfsFiles: "لم يُعثر على ملفات في FrogFS.",
  noLittlefsFiles: "لم يُعثر على ملفات في LittleFS.",
  readingLittlefs: (pct: number) => `جارٍ القراءة ${pct}%`,
  browserNotAvailable: (kind: string) => `متصفح الملفات غير متاح لـ ${kind}.`,
  downloadTitle: (path: string) => `تنزيل ${path} من الجهاز`,
  downloadNeedsRecovery: "ادخل وضع الاستعادة لتنزيل الملفات.",
  downloadFailed: (err: string) => `فشل التنزيل: ${err}`,
  footerSummary: "انقر ملفًا لتنزيله من الجهاز.",
  footerSummaryFrogfs: "قراءة من الجهاز. التنزيل متاح على LittleFS فقط.",
} as const;

export const retroGoTabAr: RetroGoTabStrings = {
  firmwareManagementHeading: "إدارة البرنامج الثابت",
  flashManagementHeading: "إدارة الفلاش",
  railWriteImage: "كتابة صورة",
  railDump: "تفريغ",
  railErase: "مسح",
  backupAndPatchTitle: "نسخ وترقيع",
  installRetroGoTitle: "تثبيت Retro-Go",
  reinstallRetroGoTitle: "إعادة تثبيت Retro-Go",
  upgradeRetroGoTitle: "ترقية Retro-Go",
  fileBrowserTitle: "متصفح الملفات",
  currentlyOnBank: (bank: string, version: string) => `حاليًا على البنك ${bank}، ${version}.`,
  scanningDevice: "جارٍ فحص الجهاز…",
  enterRecoveryMode: "ادخل وضع الاستعادة",
} as const;
