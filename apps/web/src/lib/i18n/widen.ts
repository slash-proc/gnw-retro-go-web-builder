// Widen the `as const` literal string/function-return types back to `string` so translated
// tables (e.g. de.ts, and each area file's DE export) can hold different text while still
// being structurally checked against the EN shape (same keys, same function arities).
export type Widen<T> = T extends string
  ? string
  : T extends (...args: infer A) => string
    ? (...args: A) => string
    : { [K in keyof T]: Widen<T[K]> };
