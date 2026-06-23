// Ambient types for untyped vendored imports.
declare module "@webstlink/*";

declare module "@gnw/gnw-patch/vendor/lzma-wasm/liblzma.mjs" {
  const create: (moduleArg?: Record<string, unknown>) => Promise<{
    _malloc(n: number): number;
    _free(p: number): void;
    _lzma_alone_compress(inPtr: number, inLen: number, outPtrPtr: number): number;
    getValue(ptr: number, type: string): number;
    HEAPU8: Uint8Array;
  }>;
  export default create;
}
