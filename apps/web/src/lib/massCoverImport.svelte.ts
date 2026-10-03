/** Shared state for the mass cover import, which must stay single-instance across panel remounts. */
export const massCoverImport = $state({
  active: false,
  minimized: false,
  modalOpen: false,
  cancelRequested: false,
  current: 0,
  total: 0,
  showGeneratedCovers: true,
  previewBlob: null as Blob | null,
  previewMessage: null as string | null,
});
