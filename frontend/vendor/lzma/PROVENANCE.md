# Vendored LZMA-JS (patched)

`lzma_worker.js` is [LZMA-JS](https://github.com/LZMA-JS/LZMA-JS) v2.3.2 (MIT),
from `https://unpkg.com/lzma@2.3.2/src/lzma_worker.js`, with **one** deliberate
modification:

```
mode 1:  {s: 16, f: 64, m: 0}   →   {s: 14, f: 64, m: 1}
```

`s` is the dictionary log-size, so this caps the encoder dictionary at
`1 << 14` = **16 KiB** and uses the BT4 match finder. The gnwmanager device
decoder is fixed at a 16 KiB dictionary (`lzma_prop_data = {0x5d,0x00,0x40,0x00,
0x00}` in `Core/Src/lzma.c`); a larger encoder dictionary would emit
back-references the device can't resolve. LZMA-JS already defaults to lc=3/lp=0/
pb=2 and writes the end-of-stream marker, which the device requires
(`LZMA_STATUS_FINISHED_WITH_MARK`).

We call `LZMA.compress(data, 1)` and strip the 13-byte `.lzma` header to get the
raw stream (see `frontend/lzma.js`). Round-trip against the device decode params
was verified: the patched output decodes cleanly; the unpatched 64 KiB-dict
output does not.
