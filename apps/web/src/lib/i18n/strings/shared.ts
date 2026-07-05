import type { Widen } from "../widen.js";

// Shared UI chrome copy: generic modal/button/control components used across every
// feature area (ModalShell, ConfirmModal, Button, Badge, AccordionSection, InfoTip,
// FilePick, SplitButton, Progress, Card, DeviceControls, StubLoadModal, ConnectGateModal,
// FolderGateModal, InstallProgressModal). Grouped by owning component; `common` holds
// strings reused verbatim by 2+ of them (Cancel/Close/Connect/etc).
export const sharedEn = {
  common: {
    cancel: "Cancel",
    close: "Close",
    connect: "Connect",
    connecting: "Connecting…",
    workingNotePre: "Working — ",
    workingNoteBold: "do not unplug your device",
    workingNotePost: ".",
    done: "✓ Done.",
    changeEllipsis: "Change…",
    chooseEllipsis: "Choose…",
    or: "or",
  },
  confirmModal: {
    defaultConfirmText: "Confirm",
  },
  accordionSection: {
    operationInProgress: "Operation in progress",
  },
  filePick: {
    defaultLabel: "Choose file",
    noFileChosen: "No file chosen",
  },
  splitButton: {
    moreOptions: "More options",
  },
  deviceControls: {
    deviceActions: "Device actions",
    rescan: "Rescan",
    restartRecoveryMode: "Restart Recovery Mode",
    startRecoveryMode: "Start Recovery Mode",
    changeAdapter: "Change Adapter",
    disconnectDevice: "Disconnect Device",
  },
  stubLoadModal: {
    title: "Enter Recovery Mode?",
    body1Pre: "To perform this action (like reading flash, backing up, or installing firmware), the device must enter ",
    body1Bold: "Recovery Mode",
    body1Post: ". This will temporarily halt the running application.",
    body2Pre: "Hold down the device's ",
    body2Bold: "power button",
    body2Post: " while it connects, then set the device down and don't touch it until the operation finishes.",
    continue: "Continue",
  },
  connectGateModal: {
    title: "Device needed",
    subtitle: "Connect your device's adapter to continue.",
    deviceConnectionTitle: "Device Connection",
    connectedFallback: "Connected",
    adapterHint: "An ST-Link v2 (or compatible) adapter",
    chooseAdapter: "Choose Adapter",
    connectionFailed: "Connection failed.",
  },
  folderGateModal: {
    title: "Folders needed",
    subtitlePlural: "Select the folders below to continue.",
    subtitleSingular: "Select the folder below to continue.",
    romFolderTitle: "ROM Folder",
    selectedFallback: "Selected",
    romFolderHint: "Your local collection of ROM files",
    reconnectLastFolder: "Reconnect last folder",
    scanning: "Scanning…",
    sdCardFolderTitle: "SD Card Folder",
    sdCardFolderHint: "The root of your SD card volume",
    continue: "Continue",
  },
  installProgressModal: {
    logLabel: (count: number) => `Log (${count})`,
  },
  // Geometry-bar segment labels (engine/classify.ts's extflashSegments/intflashSegments) —
  // shared across OverviewTab, RomSection, DumpSection, EraseSection, FileBrowserSection (all
  // render the same GeoSegment[] via ui/GeometryBar.svelte), so this lives here rather than in
  // one feature area's string file.
  geometry: {
    freeSpace: "Free Space",
    games: "Games",
    coresAndSaves: "Cores & Saves",
    bankLabel: (n: number) => `Bank ${n}`,
    bankUnknown: "—",
    used: "used",
    free: "free",
    bankFree: (n: number) => `Bank ${n} free`,
    empty: "empty",
  },
  // Bank-picker <select> options shared verbatim by DumpSection and FlashSection (both
  // build the same three-entry bank dropdown off `addr.ts`'s BANK_BASE addresses).
  bankSelect: {
    external: (addr: string) => `External · bank0 (${addr})`,
    internal: (bank: number, addr: string) => `Internal · bank${bank} (${addr})`,
  },
} as const;

export type SharedStrings = Widen<typeof sharedEn>;

export const sharedDe: SharedStrings = {
  common: {
    cancel: "Abbrechen",
    close: "Schließen",
    connect: "Verbinden",
    connecting: "Wird verbunden…",
    workingNotePre: "Wird ausgeführt — ",
    workingNoteBold: "Gerät nicht vom Strom trennen",
    workingNotePost: ".",
    done: "✓ Fertig.",
    changeEllipsis: "Ändern…",
    chooseEllipsis: "Auswählen…",
    or: "oder",
  },
  confirmModal: {
    defaultConfirmText: "Bestätigen",
  },
  accordionSection: {
    operationInProgress: "Vorgang läuft",
  },
  filePick: {
    defaultLabel: "Datei auswählen",
    noFileChosen: "Keine Datei ausgewählt",
  },
  splitButton: {
    moreOptions: "Weitere Optionen",
  },
  deviceControls: {
    deviceActions: "Geräteaktionen",
    rescan: "Erneut scannen",
    restartRecoveryMode: "Recovery-Modus neu starten",
    startRecoveryMode: "Recovery-Modus starten",
    changeAdapter: "Adapter wechseln",
    disconnectDevice: "Gerät trennen",
  },
  stubLoadModal: {
    title: "Recovery-Modus starten?",
    body1Pre: "Für diese Aktion (z. B. Flash auslesen, Backup erstellen oder Firmware installieren) muss das Gerät in den ",
    body1Bold: "Recovery-Modus",
    body1Post: " wechseln. Die laufende Anwendung wird dabei vorübergehend angehalten.",
    body2Pre: "Halte beim Verbinden die ",
    body2Bold: "Ein/Aus-Taste",
    body2Post: " des Geräts gedrückt, lege es danach ab und berühre es nicht mehr, bis der Vorgang abgeschlossen ist.",
    continue: "Weiter",
  },
  connectGateModal: {
    title: "Gerät erforderlich",
    subtitle: "Verbinde den Adapter deines Geräts, um fortzufahren.",
    deviceConnectionTitle: "Geräteverbindung",
    connectedFallback: "Verbunden",
    adapterHint: "Ein ST-Link v2 (oder kompatibler) Adapter",
    chooseAdapter: "Adapter auswählen",
    connectionFailed: "Verbindung fehlgeschlagen.",
  },
  folderGateModal: {
    title: "Ordner erforderlich",
    subtitlePlural: "Wähle die untenstehenden Ordner aus, um fortzufahren.",
    subtitleSingular: "Wähle den untenstehenden Ordner aus, um fortzufahren.",
    romFolderTitle: "ROM-Ordner",
    selectedFallback: "Ausgewählt",
    romFolderHint: "Deine lokale Sammlung von ROM-Dateien",
    reconnectLastFolder: "Letzten Ordner erneut verbinden",
    scanning: "Wird gescannt…",
    sdCardFolderTitle: "SD-Karten-Ordner",
    sdCardFolderHint: "Das Stammverzeichnis deiner SD-Karte",
    continue: "Weiter",
  },
  installProgressModal: {
    logLabel: (count: number) => `Protokoll (${count})`,
  },
  geometry: {
    freeSpace: "Freier Speicher",
    games: "Spiele",
    coresAndSaves: "Emulatoren & Spielstände",
    bankLabel: (n: number) => `Bank ${n}`,
    bankUnknown: "—",
    used: "belegt",
    free: "frei",
    bankFree: (n: number) => `Bank ${n} frei`,
    empty: "leer",
  },
  bankSelect: {
    external: (addr: string) => `Extern · Bank 0 (${addr})`,
    internal: (bank: number, addr: string) => `Intern · Bank ${bank} (${addr})`,
  },
};
