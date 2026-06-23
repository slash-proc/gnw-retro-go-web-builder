declare module "*/littlefs.mjs" {
  const create: (moduleArg?: Record<string, unknown>) => Promise<LittlefsModule>;
  export default create;
}

interface LittlefsModule {
  _malloc(n: number): number;
  _free(p: number): void;
  _lfs_w_create(blockSize: number, blockCount: number): number;
  _lfs_w_mount(imgPtr: number, blockSize: number, blockCount: number): number;
  _lfs_w_init(blockSize: number, blockCount: number): number;
  _lfs_w_mount_retry(): number;
  _lfs_w_mkdir(pathPtr: number): number;
  _lfs_w_write(pathPtr: number, dataPtr: number, len: number): number;
  _lfs_w_read(pathPtr: number): number;
  _lfs_w_filedata(): number;
  _lfs_w_filelen(): number;
  _lfs_w_listdir(pathPtr: number): number;
  _lfs_w_dirdata(): number;
  _lfs_w_missing_block(): number;
  _lfs_w_mark_loaded(block: number): void;
  _lfs_w_mark_all_loaded(): void;
  _lfs_w_unmount(): number;
  _lfs_w_image(): number;
  _lfs_w_image_size(): number;
  stringToUTF8(s: string, ptr: number, max: number): void;
  lengthBytesUTF8(s: string): number;
  HEAPU8: Uint8Array;
}
