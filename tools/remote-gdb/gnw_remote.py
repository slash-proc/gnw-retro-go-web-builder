#!/usr/bin/env python3
"""Browser WebSocket adapter over gnwmanager's Python OpenOCD backend.

Binary frames relay GDB RSP in --gdb-host mode (gwmeu). In GPIO mode the
browser uses an explicitly advertised JSON extension for gnwmanager's live
backend primitives: GDB attach must not halt stock firmware during polling.
No mailbox controller, GPIO driver, or flash algorithm lives in this helper.
"""
import argparse
import asyncio
import contextlib
import json
import logging
from pathlib import Path
import socket
import ssl
import subprocess
import threading
import time
from concurrent.futures import ThreadPoolExecutor

from websockets.asyncio.server import serve

LOG = logging.getLogger("gnw-remote")
DEFAULT_PORT = 8765
MAX_MEMORY = 65536
_GPIO_BACKEND_TYPE = None


def free_port():
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def gpio_backend(frequency):
    # Bindings and launch configuration from slash-proc/gnwmanager main
    # 69e3893. A small ownership override avoids upstream open() killing ALL
    # openocd processes and probing unrelated USB programmers first.
    global _GPIO_BACKEND_TYPE
    from gnwmanager.ocdbackend import openocd_backend as upstream

    if _GPIO_BACKEND_TYPE is None:
        class OwnedGPIOBackend(upstream.OpenOCDBackend):
            def open(self):
                command = next(cmd for name, cmd in upstream._openocd_launch_commands(self._address[1]) if name == "rpi-gpio")
                if self._remote_pi5:
                    # RP1 GPIO access is supplied by OpenOCD, not a new GPIO driver.
                    command = command[:3] + [
                        "-c", "source [find interface/raspberrypi5-gpiod.cfg]",
                        "-c", "adapter gpio swclk -chip $GPIO_CHIP 25",
                        "-c", "adapter gpio swdio -chip $GPIO_CHIP 24",
                        "-c", "transport select swd",
                        "-c", "source [find target/stm32h7x.cfg]",
                    ]
                command += ["-c", "bindto 127.0.0.1", "-c", "gdb_port disabled", "-c", "telnet_port disabled"]
                self._socket = socket.socket()
                self._socket.settimeout(5)
                self._openocd_process = subprocess.Popen(
                    command, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE,
                )
                self._stderr_thread = threading.Thread(
                    target=upstream._drain_stderr,
                    args=(self._openocd_process.stderr, self._stderr_buffer, logging.DEBUG), daemon=True,
                )
                self._stderr_thread.start()
                deadline = time.monotonic() + 5
                while time.monotonic() < deadline:
                    if self._openocd_process.poll() is not None:
                        raise RuntimeError("No device detected: " + "\n".join(self._stderr_buffer)[-2000:])
                    try:
                        self._socket.connect(self._address)
                        if not self._remote_pi5:
                            self.set_frequency(self._remote_frequency)
                        return self
                    except (ConnectionRefusedError, ConnectionAbortedError):
                        time.sleep(0.1)
                raise TimeoutError("OpenOCD target attachment timed out")

            def set_frequency(self, hz):
                # OpenOCD linuxgpiod uses a fixed clock on Pi 5.
                if not self._remote_pi5:
                    return super().set_frequency(hz)

            def close(self):
                # Only terminate the child we own. Closing a browser connection must
                # not reset, halt, or resume its target, or kill other OpenOCD sessions.
                self._socket.close()
                if self._openocd_process and self._openocd_process.poll() is None:
                    self._openocd_process.terminate()
                    try:
                        self._openocd_process.wait(timeout=2)
                    except subprocess.TimeoutExpired:
                        self._openocd_process.kill()
                        self._openocd_process.wait()
                if self._stderr_thread:
                    self._stderr_thread.join(timeout=2)

        _GPIO_BACKEND_TYPE = OwnedGPIOBackend

    backend = _GPIO_BACKEND_TYPE(port=free_port())
    model_path = Path("/proc/device-tree/model")
    backend._remote_pi5 = model_path.exists() and "Raspberry Pi 5" in model_path.read_text()
    backend._remote_frequency = frequency
    return backend


class HardwareSession:
    """All backend calls, including cleanup, run on one worker in request order."""
    def __init__(self, frequency, factory=None):
        self.frequency = frequency
        self.factory = factory or gpio_backend
        self.backend = None

    def close(self):
        backend, self.backend = self.backend, None
        if backend:
            backend.close()

    def execute(self, method, args):
        if method == "attach":
            self.close()
            self.backend = self.factory(self.frequency)
            try:
                self.backend.open()
            except Exception as error:
                diagnostic = "\n".join(getattr(self.backend, "_stderr_buffer", []))[-2000:]
                self.close()
                raise RuntimeError(f"No device detected: {error}\n{diagnostic}") from error
            return True
        if self.backend is None:
            raise RuntimeError("No device detected")
        backend = self.backend
        if method in ("read_memory", "write_memory"):
            addr = args[0]
            if not isinstance(addr, int) or not 0 <= addr <= 0xffffffff:
                raise ValueError("Invalid memory address")
            data = args[1] if method == "read_memory" else bytes.fromhex(args[1])
            size = data if method == "read_memory" else len(data)
            if not isinstance(size, int) or not 0 <= size <= MAX_MEMORY or addr + size > 0x100000000:
                raise ValueError("Invalid memory size")
            if method == "read_memory":
                # Aligned single words use the binding's mdw path rather than four mdbs.
                result = backend.read_uint32(addr).to_bytes(4, "little") if size == 4 and addr % 4 == 0 else backend.read_memory(addr, size)
                if len(result) != size:
                    raise RuntimeError("Short device memory read")
                return result.hex()
            backend.write_memory(addr, data)
            return None
        if method in ("read_register", "write_register"):
            name = args[0].lower()
            registers = {f"r{i}" for i in range(16)} | {"sp", "lr", "pc", "xpsr", "msp", "psp"}
            if name not in registers:
                raise ValueError("Unknown ARM register")
            if method == "read_register":
                return backend.read_register(name)
            value = args[1]
            if not isinstance(value, int) or not 0 <= value <= 0xffffffff:
                raise ValueError("Invalid register value")
            backend.write_register(name, value)
            return None
        if method == "set_frequency":
            frequency = args[0]
            if not isinstance(frequency, int) or not 1 <= frequency <= 10000000:
                raise ValueError("Invalid SWD frequency")
            backend.set_frequency(frequency)
            return None
        if method in ("halt", "resume", "reset_and_halt") and not args:
            getattr(backend, method)()
            return None
        raise ValueError("Unsupported remote adapter operation")


async def relay_gdb(ws, host, port):
    reader, writer = await asyncio.open_connection(host, port)
    writer.get_extra_info("socket").setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)

    async def from_gdb():
        while data := await reader.read(MAX_MEMORY):
            await ws.send(data)
        await ws.close()

    task = asyncio.create_task(from_gdb())
    try:
        async for message in ws:
            if not isinstance(message, bytes):
                raise ValueError("GDB forwarding expects binary WebSocket frames")
            writer.write(message)
            await writer.drain()
    finally:
        task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await task
        writer.close()
        await writer.wait_closed()


async def hardware(ws, frequency):
    session = HardwareSession(frequency)
    executor = ThreadPoolExecutor(max_workers=1)
    loop = asyncio.get_running_loop()
    await ws.send(json.dumps({"type": "hello", "version": 1, "backend": "gnwmanager"}))
    try:
        async for message in ws:
            if isinstance(message, bytes):
                # The browser's harmless qSupported distinguishes this helper from a
                # byte-only GDB relay. No target attach or implicit halt is performed.
                if message == b"$qSupported#37":
                    await ws.send(b"+$PacketSize=10000#21")
                elif message != b"+":
                    raise ValueError("Use the advertised gnwmanager backend extension")
                continue
            request = json.loads(message)
            request_id = request.get("id")
            try:
                result = await loop.run_in_executor(executor, session.execute, request["method"], request.get("args", []))
                response = {"id": request_id, "result": result}
            except Exception as error:
                LOG.debug("Backend operation failed", exc_info=True)
                response = {"id": request_id, "error": str(error) or type(error).__name__}
            await ws.send(json.dumps(response))
    finally:
        await loop.run_in_executor(executor, session.close)
        executor.shutdown(wait=False)


async def run(args):
    active = False

    async def handle(ws):
        nonlocal active
        if ws.request.path != "/gdb":
            await ws.close(1008, "Unknown endpoint")
            return
        if active:
            await ws.close(1013, "Remote adapter already in use")
            return
        active = True
        try:
            if args.gdb_host:
                await relay_gdb(ws, args.gdb_host, args.gdb_port)
            else:
                await hardware(ws, args.frequency)
        except Exception:
            LOG.warning("Remote adapter session ended", exc_info=True)
            await ws.close(1011, "Remote adapter backend unavailable")
        finally:
            active = False

    tls = None
    if args.cert:
        tls = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        tls.load_cert_chain(args.cert, args.key)
    async with serve(handle, args.bind, args.port, ssl=tls, max_size=MAX_MEMORY * 2 + 1024,
                     origins=args.origin or None, compression=None, ping_interval=20, ping_timeout=20):
        LOG.info("Listening at %s://%s:%s/gdb", "wss" if tls else "ws", args.bind, args.port)
        await asyncio.Future()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--bind", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT)
    parser.add_argument("--frequency", type=int, default=1000000)
    parser.add_argument("--gdb-host", help="Forward raw GDB to this host instead of using Raspberry Pi GPIO")
    parser.add_argument("--gdb-port", type=int, default=1234)
    parser.add_argument("--cert", help="TLS certificate for wss://")
    parser.add_argument("--key", help="TLS private key")
    parser.add_argument("--origin", action="append", help="Allowed browser origin; repeat for multiple sites")
    parser.add_argument("--verbose", action="store_true")
    args = parser.parse_args()
    if bool(args.cert) != bool(args.key):
        parser.error("--cert and --key must be supplied together")
    logging.basicConfig(level=logging.DEBUG if args.verbose else logging.INFO)
    asyncio.run(run(args))


if __name__ == "__main__":
    main()
