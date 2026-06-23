// Throwaway test UI. Fire a request, render the JSON in place. Nothing clever.

import { queryDevice } from "./probe.js";
import { gnwInfo } from "./gnw.js";
import { flashBinary, dumpRegion } from "./flashdump.js";
import { detectDevice, DEVICES, BOOTLOADER_OPTIONS, patchAndFlash } from "./patch.js";

// Validated patch context ({ model, intBytes, extBytes }) set after detection.
let patchState = null;

// Build the model's option controls (checkboxes / number / text) into the DOM.
function renderPatchOptions(model) {
  const container = document.getElementById("patch-options");
  container.innerHTML = "";
  const schema = [...DEVICES[model].options, ...BOOTLOADER_OPTIONS];
  for (const opt of schema) {
    const row = document.createElement("div");
    row.className = "row";
    const id = `patch-opt-${opt.key}`;
    const label = Object.assign(document.createElement("label"), { htmlFor: id, textContent: opt.label });
    let input;
    if (opt.type === "bool") {
      input = Object.assign(document.createElement("input"), { type: "checkbox", id });
    } else if (opt.type === "int") {
      input = Object.assign(document.createElement("input"), { type: "number", id, placeholder: opt.placeholder ?? "" });
      if (opt.min != null) input.min = opt.min;
      if (opt.max != null) input.max = opt.max;
    } else {
      input = Object.assign(document.createElement("input"), { type: "text", id, size: 36, value: opt.default ?? "" });
    }
    input.dataset.key = opt.key;
    input.dataset.kind = opt.type;
    row.append(label, input);
    container.appendChild(row);
  }
}

// Read the rendered controls back into a flat options object (omitting blanks/false).
function collectPatchOptions() {
  const options = {};
  for (const el of document.querySelectorAll("#patch-options [data-key]")) {
    const key = el.dataset.key;
    if (el.dataset.kind === "bool") {
      if (el.checked) options[key] = true;
    } else if (el.dataset.kind === "int") {
      if (el.value !== "") options[key] = Number(el.value);
    } else if (el.value !== "") {
      options[key] = el.value;
    }
  }
  return options;
}

const out = document.getElementById("out");

function render(label, status, body) {
  out.textContent = `${label} → ${status}\n\n${JSON.stringify(body, null, 2)}`;
}

async function call(label, url, options) {
  out.textContent = `${label} → …`;
  try {
    const res = await fetch(url, options);
    const body = await res.json().catch(() => ({}));
    render(label, res.status, body);
  } catch (err) {
    render(label, "network error", { error: String(err) });
  }
}

function resolveBuildPayload() {
  return {
    target: document.getElementById("target").value,
    intflashBank: Number(document.getElementById("intflashBank").value),
    extflashSizeMb: Number(document.getElementById("extflashSizeMb").value),
    sdCard: document.getElementById("sdCard").checked,
  };
}

const actions = {
  health: () => call("GET /api/health", "/api/health"),
  variants: () => call("GET /api/variants", "/api/variants"),
  manifest: () => call("GET /api/manifest", "/api/manifest"),
  resolve: () =>
    call("POST /api/resolve-build", "/api/resolve-build", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(resolveBuildPayload()),
    }),
  flash: () =>
    call("POST /api/flash", "/api/flash", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    }),
  "swd-query": async () => {
    const swdOut = document.getElementById("swd-out");
    const swdLog = document.getElementById("swd-log");
    swdLog.textContent = "";
    swdOut.textContent = "Requesting probe…";
    try {
      const info = await queryDevice(swdLog);
      swdOut.textContent = JSON.stringify(info, null, 2);
    } catch (err) {
      swdOut.textContent = "Error: " + (err?.message ?? String(err));
    }
  },
  "patch-detect": async () => {
    const out = document.getElementById("patch-detect-out");
    const optsRow = document.getElementById("patch-options-row");
    out.textContent = "Hashing & validating…";
    optsRow.style.display = "none";
    patchState = null;
    try {
      const intFile = document.getElementById("patch-int").files[0];
      const extFile = document.getElementById("patch-ext").files[0];
      if (!intFile || !extFile) throw new Error("select both an intflash and an extflash backup");
      const intBytes = new Uint8Array(await intFile.arrayBuffer());
      const extBytes = new Uint8Array(await extFile.arrayBuffer());
      const result = await detectDevice(intBytes, extBytes);
      out.textContent = JSON.stringify(result, null, 2);
      if (result.model && result.internalOk && result.externalOk) {
        patchState = { model: result.model, intBytes, extBytes };
        renderPatchOptions(result.model);
        optsRow.style.display = "";
      } else if (result.model) {
        out.textContent += "\n\n⚠ recognized as " + result.modelName + " but a dump failed validation — not a clean stock backup.";
      }
    } catch (err) {
      out.textContent = "Error: " + (err?.message ?? String(err));
    }
  },
  "patch-run": async () => {
    const out = document.getElementById("patch-out");
    const log = document.getElementById("patch-log");
    log.textContent = "";
    out.textContent = "Patching…";
    const bar = document.getElementById("patch-progress");
    bar.value = 0;
    bar.max = 1;
    document.getElementById("patch-pct").textContent = "";
    const onProgress = (done, total) => {
      bar.max = total;
      bar.value = done;
      document.getElementById("patch-pct").textContent = total
        ? `${Math.floor((100 * done) / total)}% (${done.toLocaleString()} / ${total.toLocaleString()} B)`
        : "";
    };
    try {
      if (!patchState) throw new Error("detect & validate genuine backups first");
      const options = collectPatchOptions();
      const result = await patchAndFlash(patchState, options, log, onProgress);
      out.textContent = JSON.stringify(result, null, 2);
    } catch (err) {
      out.textContent = "Error: " + (err?.message ?? String(err));
    }
  },
  "gnw-info": async () => {
    const swdOut = document.getElementById("swd-out");
    const swdLog = document.getElementById("swd-log");
    swdLog.textContent = "";
    swdOut.textContent = "Booting gnwmanager stub…";
    try {
      const info = await gnwInfo(swdLog);
      swdOut.textContent = JSON.stringify(info, null, 2);
    } catch (err) {
      swdOut.textContent = "Error: " + (err?.message ?? String(err));
    }
  },
  flash: async () => {
    const out = document.getElementById("fd-out");
    const log = document.getElementById("fd-log");
    log.textContent = "";
    out.textContent = "Flashing…";
    resetProgress();
    try {
      const result = await flashBinary(
        {
          location: document.getElementById("fd-location").value,
          offset: document.getElementById("fd-offset").value,
          file: document.getElementById("fd-file").files[0],
          compress: document.getElementById("fd-compress").checked,
          verify: document.getElementById("fd-verify").checked,
        },
        log,
        updateProgress,
      );
      out.textContent = JSON.stringify(result, null, 2);
    } catch (err) {
      out.textContent = "Error: " + (err?.message ?? String(err));
    }
  },
  dump: async () => {
    const out = document.getElementById("fd-out");
    const log = document.getElementById("fd-log");
    log.textContent = "";
    out.textContent = "Dumping…";
    resetProgress();
    try {
      const result = await dumpRegion(
        {
          location: document.getElementById("fd-location").value,
          offset: document.getElementById("fd-offset").value,
          size: document.getElementById("fd-size").value,
        },
        log,
        updateProgress,
      );
      out.textContent = JSON.stringify(result, null, 2);
    } catch (err) {
      out.textContent = "Error: " + (err?.message ?? String(err));
    }
  },
};

// ---- Flash/Dump progress bar -------------------------------------------------
function resetProgress() {
  const bar = document.getElementById("fd-progress");
  bar.value = 0;
  bar.max = 1;
  document.getElementById("fd-pct").textContent = "";
}
let lastPctPaint = 0;
function updateProgress(done, total) {
  const bar = document.getElementById("fd-progress");
  bar.max = total;
  bar.value = done;
  // Throttle the text repaint to keep the UI responsive on big transfers.
  const now = Date.now();
  if (now - lastPctPaint > 100 || done >= total) {
    lastPctPaint = now;
    const pct = total ? Math.floor((100 * done) / total) : 0;
    document.getElementById("fd-pct").textContent = `${pct}% (${done.toLocaleString()} / ${total.toLocaleString()} B)`;
  }
}

document.body.addEventListener("click", (e) => {
  const action = e.target?.dataset?.action;
  if (action && actions[action]) actions[action]();
});
