# Vendored device blobs

These are **unmodified** binaries from [gnwmanager](https://github.com/BrianPugh/gnwmanager),
the upstream Game & Watch flashing tool. They run **on the device**, not on the
host — `@gnw/gnw-flasher` loads them over SWD via an `SwdTransport`. They are not
in gnwmanager's git tree (`*.bin` is git-ignored there); they ship inside the
PyPI release wheel, which is the canonical source.

| File | Bytes | SHA-256 | Role |
|------|------:|---------|------|
| `firmware.bin` | 48492 | `fba03a8f17d218c3f9d6576545b6d9b53d82e7f62d9289c80a3709c5261884a1` | RAM flash util ("stub"). Loaded to `0x240E6800`; MSP `0x20020000`, PC `0x240f0679`. Drives the mailbox protocol on-device. |
| `unlock.bin` | 1288 | `39d66709f22574a2d7a176233c065923b4e5a1718f1f95b3e2101e73af3cb3fc` | Unlock payload (used by the later unlock/backup flow; not used by `info`). |

## Source / version

- Package: `gnwmanager` **0.22.1** (PyPI wheel `gnwmanager-0.22.1-py3-none-any.whl`).
- Matching source pinned at `references/gnwmanager` submodule, tag **v0.22.1**.
- License: **Apache-2.0** (see `references/gnwmanager/LICENSE`).

## How to refresh

```sh
url=$(curl -s https://pypi.org/pypi/gnwmanager/json \
  | python3 -c "import sys,json;d=json.load(sys.stdin);print([u['url'] for u in d['urls'] if u['url'].endswith('.whl')][0])")
curl -sL "$url" -o /tmp/gnwm.whl
unzip -o /tmp/gnwm.whl 'gnwmanager/firmware.bin' 'gnwmanager/unlock.bin' -d /tmp/gnwm
cp /tmp/gnwm/gnwmanager/*.bin .
```

Keep the `references/gnwmanager` submodule tag in sync with the wheel version so
the ported protocol constants match the vendored stub.
