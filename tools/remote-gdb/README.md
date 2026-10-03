# Remote adapter helper

The browser uses port **8765**, separately from gwmeu's GDB TCP port 1234.
Choose **Configure Adapter → Remote GDB via Websocket**, host `localhost`, port `8765`.
USB Programmer remains the default. Adapter settings persist in browser storage.

## Raspberry Pi

Install OpenOCD with GPIO support and Python dependencies in a virtual environment:

```sh
python3 -m venv --system-site-packages .venv
.venv/bin/pip install -r tools/remote-gdb/requirements.txt
.venv/bin/python tools/remote-gdb/gnw_remote.py
```

An existing pip-installed gnwmanager can also be used; install `websockets>=14,<16`
into the same Python environment. The helper was tested with gnwmanager 0.21.1
on a Pi 400 without a target attached. No changes to gnwmanager are needed.

Wiring follows gnwmanager: **SWCLK GPIO25 (pin22), SWDIO GPIO24 (pin18), GND**.
Pi 4 uses gnwmanager's sysfsgpio OpenOCD configuration. Pi 5 selects OpenOCD's
`raspberrypi5-gpiod.cfg` and preserves these pins; its clock is fixed by that driver.
Pi 5 and actual device read/write operations still need hardware verification.

The helper binds to loopback by default. From your browser computer, forward it:

```sh
ssh -L 8765:127.0.0.1:8765 doug@10.2.3.122
```

For direct LAN access, supply `--bind 0.0.0.0` and `--origin <browser-origin>`.
For an HTTPS browser that requires a secure WebSocket, supply `--cert <certificate>`
and `--key <private-key>` and enter `wss://<certificate-hostname>` in the Host field.
Use a certificate trusted by your browser. Only one browser session can own the adapter.

## gwmeu / existing GDB server

```sh
python tools/remote-gdb/gnw_remote.py --gdb-host localhost --gdb-port 1234
```

This mode forwards binary GDB RSP frames over `/gdb`, retaining the old QEMU branch's
TCP_NODELAY behavior. It never automatically halts or resumes on connection or register reads.
Explicit browser control operations still halt, resume, or reset.

## Protocol and device status

For physical GPIO devices, the helper advertises a gnwmanager extension and delegates
memory/register/clock operations to its low-level Python OpenOCD bindings. This avoids
GDB attachment halts and high-level `GnW.read_memory()` mailbox writes during live scans.
The browser keeps responsibility for recovery, mailbox coordination, safe ARM control,
status polling, and reconnects, using the same device store as USB adapters.

A reachable helper with an absent target is distinct from an unavailable adapter.
Backend calls and cleanup are serialized on one worker. Closing a session terminates
only the helper's own OpenOCD child, without resetting the target or killing unrelated
OpenOCD processes. The server doesn't implement GPIO bitbanging or flash algorithms.

Run browser transport regressions with `npm run check --workspace @gnw/web` in the
repository's development container. Run helper regressions with
`python tools/remote-gdb/test_helper.py` in the helper's Python environment.
