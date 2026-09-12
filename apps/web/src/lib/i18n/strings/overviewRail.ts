import type { Widen } from "../widen.js";

// Overview's rail and its Details pane (docs/design/proposals/overview-v2/).
//
// A SEPARATE area from `overview` on purpose. The rail is new structure with its own
// vocabulary, and keeping it out of `overview.ts` let this land beside an in-flight change to
// that file. Nothing here duplicates a string that already exists: `Status` is
// `overview.status.title`, `Device log` is `overview.log.heading`, `Activity` is
// `shared.auditLog.title`, `Internal flash` is `overview.banks.heading`, `Read protection` is
// `overview.info.readProtection`, `Firmware backup` is `overview.status.firmwareBackup`,
// `Storage` is `overview.status.storage`, and `Rescan` is `overview.status.rescan`. Read those
// from where they are.
//
// Every value here is a LABEL. The boards carry no prose in these panes: a value stands alone
// in its column, and a sentence appears only where an action has a consequence to state, which
// is nowhere in Details.
export const overviewRailEn = {
  // The two rail groups (README "Structure": CONSOLE / LOGS).
  groupConsole: "Console",
  groupLogs: "Logs",
  // The one rail item with no existing string.
  details: "Details",

  // --- Details pane -----------------------------------------------------------------------
  // Section headings. `Internal flash` is reused from overview.banks.heading; `External flash`
  // gets its own because `overview.extFlash.title` is "External Flash", and the boards
  // sentence-case every heading in this pane.
  externalFlash: "External flash",
  adapter: "Adapter",
  thisApp: "This app",

  // Bank rows.

  // External-flash rows.
  capacity: "Capacity",

  // Adapter rows.
  probe: "Probe",
  deviceUid: "Device UID",

  // This-app rows.
  sources: "Sources",
  sourcesCount: (listed: number, active: number) => `${listed} listed, ${active} active`,
  browserCache: "Browser cache",
  appVersion: "App version",

  // Details' own footer action. `Rescan` sits beside it and is overview.status.rescan.
  copyDetails: "Copy details",

  // --- Device log pane --------------------------------------------------------------------
  // The output panel's own heading, so Copy and Save sit on the line that says what they act
  // on rather than in the page footer.
  output: "Output",
  copy: "Copy",
  save: "Save",
} as const;

export type OverviewRailStrings = Widen<typeof overviewRailEn>;
