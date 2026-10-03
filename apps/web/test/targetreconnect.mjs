// Exercise the real Connect/teardown methods with a stale adapter session and a returning
// console. Hardware reads are mocked; no test touches a physical device.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { execFileSync } from "node:child_process";
import ts from "typescript";

const source = process.env.REMOTE_CONNECT_SOURCE
  ? readFileSync(process.env.REMOTE_CONNECT_SOURCE,"utf8")
  : process.env.STLINK_BASELINE === "1"
  ? execFileSync("git", ["-c", "safe.directory=/app", "show", "main:apps/web/src/lib/device.svelte.ts"], {cwd:"/app",encoding:"utf8"})
  : readFileSync(new URL("../src/lib/device.svelte.ts", import.meta.url), "utf8");
const ast = ts.createSourceFile("device.svelte.ts", source, ts.ScriptTarget.Latest, true);
const store = ast.statements.find((node) => ts.isClassDeclaration(node) && node.name?.text === "DeviceStore");
assert.ok(store, "DeviceStore must be available to test its actual connection methods");
const names = ["connect", "_teardownConnection", "stopPoll", "enterStockMonitor", "enterRecoveryMode",
  "isConnected", "markTargetUnresponsive", "scheduleTargetReconnect", "retryTargetConnection", "RETRY_POLL_INTERVAL_MS",
  "connectSilent", "chooseAdapter", "REMOTE_RECONNECT_NOTIFY_AFTER", "remoteReconnectFailures"];
const methods = names.map((name) => {
  const node = store.members.find((member) => member.name?.getText(ast) === name);
  assert.ok(node, `Missing method ${name}`);
  return node.getText(ast);
});
const compiled = ts.transpileModule(`class DeviceStore { ${methods.join("\n")} }
globalThis.DeviceStore = DeviceStore;`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;

const header = readFileSync(new URL("../src/lib/ui/DeviceHeader.svelte", import.meta.url), "utf8");
const script = header.slice(header.indexOf(">") + 1, header.indexOf("</script>"));
const headerAst = ts.createSourceFile("header.ts", script, ts.ScriptTarget.Latest, true);
const statusDeclaration = headerAst.statements.filter(ts.isVariableStatement)
  .flatMap((node) => [...node.declarationList.declarations]).find((node) => node.name.getText(headerAst) === "statusText");
assert.ok(statusDeclaration?.initializer?.arguments?.[0], "Header status expression must be available");
const statusExpression = statusDeclaration.initializer.arguments[0].getText(headerAst);
const statusFor = (device) => vm.runInNewContext(statusExpression, { device, locale: { t: { deviceHeader: {
  noDeviceDetected: "No device detected", noValidAdapterSelected: "No valid adapter selected",
} } } });

function fixture({ recovery = false, booting = false, attachGate, attachFailures = 0,
  remote = false, startup = false, attachError = "Transfer count mismatch" } = {}) {
  const calls = { attach: 0, dispose: 0, oldPoll: 0, boot: 0, reads: [], notifications: [] };
  const adapter = {};
  const stale = { busy: () => !remote };
  const fresh = { busy: () => false };
  const availability = { adapterPresent: true };
  const scheduledRetries = [];
  const context = {
    performance, clearInterval, clearTimeout, Date,
    setTimeout: (fn, ms) => {
      if (ms === 2000) { const timer = { fn }; scheduledRetries.push(timer); return timer; }
      const timer = setTimeout(fn, ms); timer.unref(); return timer;
    },
    navigator: { usb: { addEventListener() {}, removeEventListener() {} } },
    dbg() {}, isPickerDismissal: () => false,
    deviceSafety: { linkGone() {} }, lipProgress: { setQuiet() {} },
    auditLog: { add(...args) { calls.notifications.push(args); } }, msg: () => "",
    getKnownProbes: async () => availability.adapterPresent ? [adapter] : [],
    chooseProbe: async () => adapter,
    connectRemoteProbe: async () => {
      calls.attach++;
      if (calls.attach <= attachFailures) throw new Error(attachError);
      if (attachGate) await attachGate;
      return { probeName: "gnwmanager", transport: fresh, isOpen: () => true,
        onLost() {}, dispose: async () => { calls.dispose++; } };
    },
    connectProbe: async (options) => {
      calls.attach++;
      assert.equal(options.device, adapter, "Reconnect should reuse the selected USB adapter");
      assert.equal(calls.dispose, startup ? 0 : 1, "The stale handle must close before reopening the adapter");
      if (calls.attach <= attachFailures) throw new Error(attachError);
      if (attachGate) await attachGate;
      return { device: adapter, probeName: "Fake adapter", transport: fresh, dispose: async () => {} };
    },
    serialTransport: (transport) => transport,
    readRdpLocked: async (transport) => { assert.equal(transport, fresh); return false; },
    isStubAlive: async (transport) => { assert.equal(transport, fresh); return recovery; },
    attachFlasher: (transport) => ({ transport }),
    readInfo: async () => ({ locked: false, externalFlashSizeMiB: 16 }),
  };
  vm.createContext(context);
  vm.runInContext(compiled, context);
  const device = new context.DeviceStore();
  Object.assign(device, {
    adapterType: remote ? "remote" : "usb", remoteHost: "localhost", remotePort: 8765,
    connection: "lost", targetUnresponsive: true, transport: stale,
    probe: { device: adapter, transport: stale, isOpen: () => true, dispose: async () => { calls.dispose++; } },
    selectedAdapter: adapter, _connectPromise: null, _stubBootDepth: booting ? 1 : 0,
    targetPingStalled: true, _suppressAutoRetry: false, targetReconnectTimer: null,
    _deferredDispose: [], _gen: 0, pollTimer: null, pollSuspendDepth: 0,
    adapterFrequencyHz: 4_000_000, itcmOfwModel: "unknown", model: "unknown",
    startupTrace() {}, startPoll() {},
    clearInfo() { if (!startup && !remote) throw new Error("Reconnecting from lost must preserve the inventory"); },
    pollTick: async () => { calls.oldPoll++; },
    refreshItcmOfwHint: async (transport) => {
      assert.equal(transport, fresh, "Variant detection must use the new transport");
      calls.reads.push("ITCM");
      device.itcmOfwModel = "mario";
      device.model = "mario";
    },
    quickRuntimeProbe: async (transport, options) => {
      assert.equal(transport, fresh);
      assert.equal(options.allowIntflash, false, "Stock detection should first use VTOR only");
      calls.reads.push("VTOR");
      device.runtimeKind = "stock-ofw";
      device.runtimeBank = 1;
    },
    ensureStub: async () => { calls.boot++; throw new Error("No Recovery boot should be required"); },
    runScan: async () => {},
  });
  if (startup) Object.assign(device, {
    connection: "disconnected", targetUnresponsive: false, probe: null, transport: null,
    selectedAdapter: null, adapterAvailable: false,
  });
  return { device, calls, fresh, availability, scheduledRetries };
}

{
  const { device, calls, fresh } = fixture();
  await device.connect();
  assert.equal(calls.attach, 1);
  assert.equal(calls.dispose, 1);
  assert.equal(calls.oldPoll, 0, "Connect must not just retry the blocked old poll");
  assert.equal(calls.boot, 0);
  assert.deepEqual(calls.reads, ["ITCM", "VTOR"]);
  assert.equal(device.transport, fresh);
  assert.equal(device.connection, "connected");
  assert.equal(device.runtimeKind, "stock-ofw");
  assert.equal(device.targetUnresponsive, false);
}
{
  const { device, calls } = fixture({ recovery: true });
  await device.connect();
  assert.equal(calls.attach, 1);
  assert.equal(calls.boot, 0, "An existing Recovery utility must be adopted without restarting it");
  assert.equal(device.runtimeKind, "recovery");
  assert.equal(device.utilLoaded, true);
  assert.equal(device.targetUnresponsive, false);
}
{
  const { device, calls } = fixture({ booting: true });
  await device.connect();
  assert.equal(calls.attach, 0, "A Recovery boot must retain ownership of its adapter handle");
  assert.equal(calls.dispose, 0);
  assert.equal(device._reconnectAfterBoot, true);
}
{
  let release;
  const attachGate = new Promise((resolve) => { release = resolve; });
  const { device, calls } = fixture({ attachGate });
  const first = device.connect();
  const second = device.connect();
  assert.equal(first, second, "Overlapping Connect requests must share one attempt");
  release();
  await Promise.all([first, second]);
  assert.equal(calls.attach, 1);
  assert.equal(calls.dispose, 1);
}
{
  const { device, calls, scheduledRetries } = fixture({ attachFailures: 1 });
  device.connection = "connected";
  device.targetUnresponsive = false;
  device.markTargetUnresponsive();
  assert.ok(device.targetReconnectTimer, "An absent target must schedule automatic reconnection");
  scheduledRetries[0].fn();
  await new Promise(setImmediate);
  assert.equal(device.connection, "lost");
  assert.equal(device.targetUnresponsive, true);
  assert.ok(device.targetReconnectTimer, "A failed reattach must retain automatic retries");
  assert.equal(scheduledRetries.length, 2, "A failed automatic attempt must schedule another");
  scheduledRetries[1].fn();
  await new Promise(setImmediate);
  assert.equal(calls.attach, 2);
  assert.equal(device.connection, "connected", "A returning console must reconnect without a button click");
  assert.equal(device.runtimeKind, "stock-ofw");
}
{
  const { device, calls, availability } = fixture();
  availability.adapterPresent = false;
  await device.retryTargetConnection();
  assert.equal(calls.attach, 0, "An absent adapter must not open a picker or attach");
  assert.equal(device.targetUnresponsive, false, "An absent adapter must show the adapter status");
  assert.ok(device.targetReconnectTimer);
  availability.adapterPresent = true;
  await device.retryTargetConnection();
  assert.equal(device.connection, "connected");
}
{
  for (const guard of ["_suppressAutoRetry", "scanning", "pinging", "pollSuspendDepth", "_stubBootDepth"]) {
    const { device, calls } = fixture();
    device[guard] = guard.endsWith("Depth") ? 1 : true;
    await device.retryTargetConnection();
    assert.equal(calls.attach, 0, `Automatic reconnection must respect ${guard}`);
  }
}
{
  const { device, calls, scheduledRetries } = fixture({ startup: true, attachFailures: 1 });
  await device.connectSilent();
  assert.equal(calls.attach, 1);
  assert.equal(device.adapterAvailable, true, "Target absence must preserve the available programmer");
  assert.equal(statusFor(device), "No device detected");
  assert.equal(scheduledRetries.length, 1, "An initial failed attachment must start target retries");
  scheduledRetries[0].fn();
  await new Promise(setImmediate);
  assert.equal(calls.attach, 2);
  assert.equal(device.connection, "connected", "A console plugged in after startup must be detected automatically");
}
{
  const { device, scheduledRetries } = fixture({ startup: true });
  device._suppressAutoRetry = true;
  await device.chooseAdapter();
  assert.equal(device.adapterAvailable, true);
  assert.equal(statusFor(device), "No device detected", "Selecting the programmer must update adapter status immediately");
  assert.equal(device._suppressAutoRetry, false);
  assert.equal(scheduledRetries.length, 1, "Adapter configuration must resume automatic target detection");
  scheduledRetries[0].fn();
  await new Promise(setImmediate);
  assert.equal(device.connection, "connected");
}
{
  const { device } = fixture({ startup: true, attachFailures: 1, attachError: "Unsupported CMSIS-DAP adapter" });
  await device.connectSilent();
  assert.equal(device.adapterAvailable, false);
  assert.equal(statusFor(device), "No valid adapter selected", "An unusable programmer must remain distinct from an absent console");
}
{
  const { device, scheduledRetries } = fixture({ startup: true, attachFailures: 1,
    attachError: "Device unavailable." });
  await device.connectSilent();
  assert.equal(device.adapterAvailable, true, "An enumerated programmer remains selected after USB attachment fails");
  assert.equal(statusFor(device), "No device detected");
  assert.equal(scheduledRetries.length, 1);
  scheduledRetries[0].fn();
  await new Promise(setImmediate);
  assert.equal(device.connection, "connected", "Transient attachment failure must retry without opening a chooser");
}
{
  const { device, calls } = fixture({ remote: true });
  device.connection = "connected";
  device.targetUnresponsive = false;
  await device.connect();
  assert.equal(calls.dispose, 0, "Remote Connect must reuse a healthy session");
  assert.equal(calls.attach, 0, "Confirming remote configuration must not create another server session");
}
{
  let release;
  const attachGate = new Promise(resolve => { release = resolve; });
  const { device, calls } = fixture({ remote: true, startup: true, attachGate });
  const first = device.connect();
  const second = device.connect(undefined, { forcePicker: true });
  assert.equal(first, second, "A remote modal and automatic reconnect must share one attempt, even with forcePicker");
  release();
  await Promise.all([first,second]);
  assert.equal(calls.attach, 1);
  await device.connect();
  assert.equal(calls.attach, 1, "Re-confirming after a successful background connect must reuse its socket");
  await device.connect(undefined, {reconnect:true});
  assert.equal(calls.attach, 2, "An explicit remote reconnect must still replace the session");
}
{
  const {device,calls}=fixture({remote:true,attachFailures:7,attachError:"Could not connect to ws://localhost:8765/gdb"});
  for(let i=1;i<=7;i++) {
    await device.retryTargetConnection();
    assert.equal(calls.notifications.length,i<4?0:1,"Remote reconnect must notify once after four failures");
    assert.ok(device.targetReconnectTimer,"Notification must not stop reconnection");
  }
  await device.retryTargetConnection();
  assert.equal(device.remoteReconnectFailures,0,"Successful connection must reset the outage counter");
  device.connection="lost";device.targetUnresponsive=true;
  for(let i=0;i<4;i++) {
    const fail=async()=>{throw new Error("remote outage");};
    device.refreshItcmOfwHint=fail;
    await device.retryTargetConnection();
  }
  assert.equal(calls.notifications.length,2,"A later outage should get its own single notification");
}
{
  const {device,calls}=fixture({remote:true,attachFailures:1,attachError:"Could not connect to ws://localhost:8765/gdb"});
  await assert.rejects(device.connect(),/Could not connect/);
  assert.equal(calls.notifications.length,1,"Explicit Connect must still report errors immediately");
}
{
  const {device,calls}=fixture({remote:true});
  let reattachments=0;
  device.probe.reattach=async()=>{reattachments++;if(reattachments===1)throw new Error("No device detected");};
  await assert.rejects(device.connect(undefined,{reconnect:true,recoveryOnly:true}),/No device detected/);
  assert.equal(calls.dispose,0,"Target power loss must retain the existing remote session");
  await device.connect(undefined,{reconnect:true,recoveryOnly:true});
  assert.equal(reattachments,2,"The existing remote backend must be reopened after target power-cycle");
  assert.equal(calls.attach,0,"Target reattach must not open a competing WebSocket");
  assert.equal(calls.dispose,0);
}
console.log("target reconnect: 16 scenarios passed");
