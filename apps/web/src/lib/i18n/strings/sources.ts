import type { Widen } from "../widen.js";

// Sources tab copy (views/Sources.svelte + lib/sources/). Literal copy only — every
// runtime/device/manifest-derived value (a repo slug, a version tag, a console name, a count)
// stays in component logic and is interpolated in, never translated.
export const sourcesEn = {
  tab: "Sources",
  heading: "Sources",
  colCores: "Cores",
  colHomebrew: "Homebrew",
  // The Sources tab's left rail (SourcesRail.dc.html): two group headings and the one entry
  // label the columns did not already provide (the other reuse colCores/colHomebrew).
  railLocal: "Local sources",
  railRemote: "Remote sources",
  railDirectories: "Directories",
  // The pane subtitles under each remote pane's title, both artboard-verbatim. The cores line
  // is the one place the UI says what a "core" IS: the word is libretro jargon where
  // "emulator" was guessable, so the rename would leave a newcomer worse off without it. It
  // names both halves the term covers, in the owner's own framing -- an emulator (nes, snes)
  // or a game engine (doom, openlara) -- and says what one DOES, which is add a console tab.
  coresSubtitle: "Emulators and game engines that add a console to the Game & Watch.",
  homebrewSubtitle: "Custom games/applications for the Game & Watch.",
  emptyColumn: "No sources",
  selectAllSources: "Select all",
  clearSelection: "Clear selection",
  // The Guided Setup modal's way out to the full Sources tab (ModalSources artboard).
  allSources: "All sources",

  // Add-source form
  addSource: "Add source",
  addTitle: "Add a source",
  modeUrl: "URL",
  modeBundle: "Bundle zip",
  // Owner ruling: the app's vocabulary for this object is "source", never "repository".
  // Not drawn by ReposAdd.dc.html (the field carries no visible label there) — this is the
  // input's accessible name only, so it says what the field is for rather than what a
  // GitHub URL is called. The error strings below keep "repository": those describe a
  // GitHub artifact, not this app's concept.
  urlLabel: "Source URL",
  urlPlaceholder: "owner/repo or https://github.com/owner/repo",
  urlHint: "The project must publish a GitHub Pages mirror of its releases.",
  bundleLabel: "Offline bundle",
  importing: "Checking the bundle...",
  bundleUnverified: "From a bundle, unverified",
  bundleReimport: "Re-import to install",
  add: "Add",
  // The remote pane's bulk action (SourcesUpdateAll artboard). "all" is load-bearing: it is
  // what separates this from the per-row version picker, and it is scoped to the ONE pane the
  // user is looking at, not every source. A pinned row is re-fetched, not un-pinned.
  updateAll: "Update all",
  // The look-up step (ReposAdd artboard): the URL field's own button, and the "Found"
  // summary it produces. Every VALUE in that summary — the project title, the type, the
  // version tag and date, the ABI number, the filenames and sizes — is manifest data and is
  // interpolated in as untrusted text; only these labels are translated.
  lookUp: "Look up",
  found: {
    caption: "Found",
    name: "Name",
    type: "Type",
    installs: "Installs",
    // Appended after the ABI number, and ONLY when the connected device's firmware actually
    // satisfies it. An unknown device ABI makes no claim at all, so nothing is appended.
    abiSupported: "supported",
  },
  adding: "Checking the project...",

  // Row state
  active: "Active",
  inactive: "Inactive",
  activate: "Activate",
  deactivate: "Deactivate",
  configure: "Configure",
  remove: "Remove",
  loading: "Loading...",
  retry: "Retry",
  // SourcesCuratedUnreadable.dc.html: the section-scoped note under a rail's list when one or
  // more curated entries could not be resolved. It claims NO cause — `importCurated()` discards
  // the error and offline / 404 / malformed are indistinguishable to it. The failed projects'
  // titles are runtime values and are rendered separately, not translated.
  curatedUnreadable: (count: number) =>
    count === 1 ? "1 curated source could not be read" : `${count} curated sources could not be read`,
  noSelection: "Select a source to configure it.",
  // Detail view (ReposDetail / ReposDetailReady artboards): the back affordance and the
  // footer bar's one-line context sentence, verbatim.
  backToSources: "Back to sources",
  notActiveHint: "Not active. Activating adds it to the Library tab.",
  activeHint: "Active. Install it from the Library tab.",

  // Meta line facts
  romsMatched: (count: number) => `${count} ROMs matched`,
  oneRomMatched: "1 ROM matched",
  noRoms: "0 ROMs matched",
  noRomFolder: "No ROM folder picked",
  needsUserFiles: "Additional files required",
  prerelease: "Prerelease",
  needsNewerFirmware: "Needs newer firmware",

  // Errors. Never show a raw fetch message; each code maps to one of these.
  errBadUrl: "That is not a GitHub repository URL.",
  errNoPages: "This repository has no GitHub Pages mirror, so a browser cannot read its files.",
  errNoVersions: "This repository has a Pages site but does not publish dist/versions.json.",
  errMalformed: "The project published a file this tool could not read.",
  errUnsupportedSchema: (version: string) =>
    `This project uses distribution format ${version}, which this tool does not support. Update the tool.`,
  errNetwork: "Could not reach the project. Check your connection and try again.",
  // Why a PREPARE failed, grouped by what the user can do about it (sources/errorText.ts's
  // `prepareMessageKind`). The CODE is not shown: it reaches the activity log through
  // `roms.selectGames.convertFailed`, which keeps its untranslated diagnostic shape.
  errPrepareUnreadable: "This source published a converter this tool could not run.",
  errPrepareInput: "A file you supplied was not accepted.",
  errPrepareCollision: "Two files differ only in case, so the card can hold only one of them.",
  errPrepareInterrupted: "The conversion did not finish.",
  // The manifest-driven file prompt (ui/FilePromptModal.svelte). Its subject name, the note
  // under it, input labels/descriptions, variant names and filenames all come from a manifest
  // (a converter tool, or a core's bios[]) and are interpolated in as untrusted
  // TEXT — only the copy around them is translated here. `subtitleConverted` is the one line
  // with no manifest source: it describes how converters work, not what any project says.
  filePrompt: {
    title: (name: string) => `${name} needs additional files`,
    subtitleBios: (name: string) => `${name} games will not start without it.`,
    subtitleConverted: "Files are converted in your browser. Nothing is uploaded.",
    fallbackInputLabel: (id: string) => `File "${id}"`,
    required: "required",
    optional: "optional",
    choose: "Choose",
    // The whole-directory shortcut, offered only for an `allowMultiple` input (see
    // `sources/inputPrompt.ts`'s `acceptsFolder`). Distinct from `choose` because the two sit
    // side by side and name different things: files, or the folder holding them.
    chooseFolder: "Choose folder",
    found: "Found",
    added: "Added",
    addedCount: (count: number) => `${count} added`,
    expectedSha: "Expected SHA-1",
    currentSha: "Current",
    // The disclosure holding EVERY optional input, or nothing at all — never a partial
    // remainder, so the artboard's "8 more optional files" loses its "more".
    optionalTail: (count: number) => (count === 1 ? "1 optional file" : `${count} optional files`),
    errInvalid: (name: string) => `The provided ${name} file is invalid`,
    errTooLarge: (limit: string) => `This file is larger than the ${limit} this input accepts.`,
    errMissing: "Choose a file for this input to continue.",
    errNotMultiple: "This input accepts a single file.",
    errUnusable: "This file cannot be used here.",
    errRead: "That file could not be read.",
    // The modal's own submit button. Artboard-verbatim: ModalFilesConvert says "Prepare",
    // ModalFilesBios says "Add to library". Deliberately NOT roms.selectGames.actionPrepare —
    // that is the Library table's lowercase action badge, a different control.
    submitPrepare: "Prepare",
    submitAddToLibrary: "Add to library",
  },
  errBundleInvalid: "This file is not a bundle zip this tool can read.",
  errBundleMissingFile:
    "The bundle's manifest names a file the zip does not contain.",
  errBundleConflict: "Already added from its repository.",
  // BIOS status (lib/sources/bios.ts; spec/07-cores.md "BIOS"). Every value shown beside
  // these — a filename, a system name — comes from the source's own manifest and is never
  // translated. Copy is taken verbatim from the approved LibrarySummary artboard; there is
  // deliberately no explanatory prose here.
  bios: {
    label: "BIOS",
    needsAFile: "needs a file",
    missingFile: "Missing file",
    missingDetail: (system: string, filename: string) => `${system} needs ${filename}.`,
  },
  // Detail view rows (ReposDetail / ReposDetailReady artboards), verbatim. `abiLabel` is the
  // ROW LABEL only: the ABI number beside it is device/manifest data and is interpolated in.
  // The three type chips are the artboard's own lowercase category words.
  detail: {
    version: "Version",
    // The green affordance beside the resolved version (ReposDetailReady). It reveals the
    // picker; the picker's own option labels are manifest data (a tag, a date) and are never
    // translated.
    getOlderVersion: "Get older version",
    compatibility: "Compatibility",
    abiLabel: "Firmware ABI",
    published: "Published",
    installs: "What gets installed",
    total: "Total",
    typeBinary: "binary",
    typeData: "data",
    typeBuilt: "built",
    notBuiltYet: "not built yet",
  },
  // Files a source needs but cannot ship — a core's BIOS slots, a homebrew
  // converter's inputs. Copy verbatim from the ReposDetail artboard's "Additional files".
  additional: {
    heading: "Additional files",
    hashMatches: "Hash matches",
    required: "Required",
    optional: "Optional",
    requiredFor: (extensions: string) => `Required for ${extensions}`,
    chooseFile: "Choose file",
  },
  // The RELEASE panel of the per-source config page (SourcesHomebrewConfig /
  // SourcesCoreConfig artboards). LABELS ONLY: every value beside these is manifest or
  // versions-entry data — a tag, a date, an ABI number, a system's `longName`, a file
  // extension — and is never translated. `storageFlash`/`storageSd` are the two members of
  // the manifest's `storage` enum written as words; the enum itself stays "flash"/"sd".
  release: {
    heading: "Release",
    needsUserFiles: "Needs user files",
    yes: "Yes",
    no: "No",
    requiresAbi: "Requires ABI",
    abiOrNewer: (version: number) => `${version} or newer`,
    validTargets: "Valid Targets",
    storageFlash: "Flash",
    storageSd: "SD card",
    systems: "Systems",
    fileTypes: "File types",
  },
  // The SOURCES panel: the local folders one source draws user files from. "Shared" is a
  // folder with an empty `usedBy` (offered to every target); "Dedicated" is one that names
  // this target. `missing`/`needsPermission` are the folder model's two non-ready states.
  folders: {
    heading: "Sources",
    none: "No folders yet.",
    shared: "Shared",
    dedicated: "Dedicated",
    missing: "Missing",
    needsPermission: "Needs permission",
    usedBy: "Used by",
    biosGroup: "System files",
    biosUsedBy: "BIOS",
    ofwBackupUsedBy: 'OFW Backup',
    any: "Any",
    count: (n: number) => (n === 1 ? "1 folder" : `${n} folders`),
    // The add-a-directory page (SourcesAddRoms / SourcesAddHomebrewDir artboards, now one
    // page). The field labels, the folder row's empty value and its picker control are
    // artboard-verbatim; "Used by"/"Any" above are the same words that page uses, and its two
    // menu group headings are colCores/colHomebrew, already translated. The TITLE is the one
    // composed string here: the two boards say "Add a ROM folder" and "Add a homebrew folder"
    // and one merged page can say neither, so it names what the thing now is.
    addDirectoryTitle: "Add a directory",
    fieldFolder: "Folder",
    fieldName: "Name",
    nameOptional: "(optional)",
    noFolderChosen: "No folder chosen",
    choose: "Choose\u2026",
    chooseAgain: "Grant permission by choosing folder again",
    subtitleDirectories: "Folders holding your game and homebrew files.",
    // The configure page is the SAME page, relabelled (SourcesConfigureRoms /
    // SourcesConfigureHomebrewDir), and likewise one title now. "Nothing yet" is the homebrew
    // board's wording for a card with no associations, where the ROMs board says "Any" — both
    // are on the canvas.
    configureDirectoryTitle: "Configure directory",
    save: "Save",
  },
  // --- Cache pane (SourcesCache.dc.html) -----------------------------------------------
  // The third LOCAL SOURCES rail entry. Category labels, `Clear`, `Total`, `Used`,
  // `Protected`, its `?` explanation and `Empty cache` are all artboard-verbatim. `keptYes` is the
  // other half of the binary the artboard draws as `No`; nothing else here is invented.
  cache: {
    heading: "Cache",
    contents: "Contents",
    storage: "Storage",
    catFirmware: "Firmware bundles",
    catArtifact: "Source artifacts",
    catConverter: "Converter modules",
    catConverted: "Converted files",
    catCover: "Cover art",
    catOffline: "Offline bundles",
    catOther: "Other",
    clear: "Clear",
    total: "Total",
    files: (n: number) => (n === 1 ? "1 file" : `${n} files`),
    used: "Used",
    usedOf: (used: string, quota: string) => `${used} of ${quota}`,
    protected: "Protected",
    protectedHelp: "The browser will not delete this to free up space.",
    keptYes: "Yes",
    keptNo: "No",
    empty: "Empty cache",
  },
  // --- SD card pane (docs/design/proposals/sd-source/, CardSizeBar is the chosen board) ---
  // The FIRST local-sources rail entry, above Directories, holding exactly one selection.
  //
  // Two facts this vocabulary has to keep apart, because the page draws them side by side and
  // they have different provenance. USED is measured: the walk reads every file's size. FREE is
  // INFERRED from a capacity the USER stated, because no browser API reports a picked
  // directory's volume (see docs/SDCARD_CAPACITY.md). `capacity` is therefore a control and
  // everything in `Contents` is not, which is how the page says which is which without a
  // sentence explaining it.
  //
  // There is no `filesystem` key: the user is not asked. exFAT beats FAT32 by less than the
  // 100 MB safety margin at every measured size, so the answer could not change the figure.
  //
  // `catRoms` is the word ROM about a FOLDER OF FILES, not about the Library tab, which is why
  // it is listed in core-vocabulary.mjs's ABOUT_FILES beside railRoms.
  sd: {
    heading: "SD Card",
    card: "Card",
    contents: "Contents",
    capacity: "Capacity",
    files: "Files",
    total: "Total",
    none: "None",
    rescan: "Rescan",
    unreadable: "This folder cannot be read.",
    freeOf: (free: string, capacity: string) => `${free} free of ${capacity}`,
    fileCount: (n: number) => (n === 1 ? "1 file" : `${n} files`),
    // The owner's wording, with the limit as runtime data so the constant stays in one place
    // (MAX_ENTRIES, sdStorage.svelte.ts). The store reports WHICH limit it hit, so the other
    // two causes get their own sentence rather than being described as too many files.
    truncEntries: (limit: string) =>
      `Too many files on SD card. Unable to calculate more than ${limit} files`,
    truncDepth: "Folders on this card are nested too deeply to count them all.",
    truncFile: "A file on this card could not be read, so these totals are a minimum.",
    catBios: "BIOS",
    catCovers: "Covers",
    catFonts: "Fonts",
    catHomebrew: "Homebrew",
    catLanguage: "Language",
    catRoms: "ROMs",
    catSaves: "Saves",
    catScreenshots: "Screenshots",
    catOther: "Other",
  },
} as const;

export type SourcesStrings = Widen<typeof sourcesEn>;
