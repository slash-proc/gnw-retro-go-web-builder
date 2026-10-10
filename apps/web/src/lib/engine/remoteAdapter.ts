import type { ProbeHandle } from "./transport.js";
import { GdbRemoteClient, RemoteGdbTransport, remoteGdbUrl } from "./remoteGdb.js";
export { DEFAULT_REMOTE_PORT, remoteGdbUrl } from "./remoteGdb.js";
export type AdapterType = "usb" | "remote";

export async function connectRemoteProbe(host: string, port: number, availability: (available: boolean) => void): Promise<ProbeHandle & { onLost: (cb: () => void) => void }> {
  const url = remoteGdbUrl(host, port);
  const client = new GdbRemoteClient(url);
  // The interactive device-test harness samples the same transport operations shown by the
  // install progress UI. Keep this dev-only and expose summaries only; RSP payloads are ROM and
  // firmware contents and must never be copied into diagnostics.
  if (import.meta.env.DEV && typeof window !== "undefined") {
    (window as Window & { __gnwGdbDebug?: { snapshot: () => ReturnType<typeof client.debugSnapshot> } }).__gnwGdbDebug = {
      snapshot: () => client.debugSnapshot(),
    };
  }
  try {
    await client.connect();
    availability(true);
    return {
      transport: new RemoteGdbTransport(client),
      probeName: `gnwmanager ${url}`,
      isOpen: () => client.available,
      reattach: client.isManaged ? () => client.reattach() : undefined,
      dispose: async () => client.close(),
      onLost: (cb) => client.onLost(cb),
    };
  } catch (error) {
    availability(client.available);
    client.close();
    throw error;
  }
}
