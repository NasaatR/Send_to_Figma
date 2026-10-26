const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("jsdom");
const root = path.join(__dirname, "..");
const wait = () => new Promise((r) => setImmediate(r));
async function popup(status) {
  const dom = new JSDOM(
      fs.readFileSync(path.join(root, "extension/popup.html"), "utf8"),
      { url: "https://fixture.local/popup", runScripts: "outside-only" },
    ),
    w = dom.window;
  const requests = [],
    saved = [];
  Object.defineProperty(w.navigator, "clipboard", {
    value: { writeText: async (text) => saved.push(text) },
  });
  w.chrome = {
    runtime: {
      id: "test-id",
      sendMessage: async (m) => {
        requests.push(m);
        return { ok: true, data: status };
      },
    },
    storage: {
      local: {
        get: async () => ({
          appearance: { theme: "light", density: "compact" },
        }),
        set: async (s) => saved.push(s),
      },
    },
  };
  w.eval(fs.readFileSync(path.join(root, "shared/icons.js"), "utf8"));
  w.eval(fs.readFileSync(path.join(root, "extension/queue-core.js"), "utf8"));
  w.eval(fs.readFileSync(path.join(root, "extension/popup.js"), "utf8"));
  await wait();
  return { dom, w, requests, saved };
}
test("popup shows frozen offline destination, copies pairing and preserves queue on appearance reset", async () => {
  const s = {
    targetId: "collection-a",
    targetLabel: "File A / References",
    pending: 1,
    queueBytes: 100,
    receivers: [{ targetId: "collection-b", label: "File B / References" }],
    pairingToken: "b".repeat(64),
    jobs: [
      {
        id: "request-first",
        sequence: 1,
        title: "Portrait",
        status: "ready",
        targetId: "collection-a",
        targetLabel: "File A / References",
        size: 100,
      },
    ],
  };
  const p = await popup(s);
  try {
    const d = p.w.document;
    assert.match(d.querySelector("#receiver-text").textContent, /закреплённую/);
    assert.match(
      d.querySelector("#destination").selectedOptions[0].textContent,
      /File A/,
    );
    assert.match(d.querySelector("#jobs").textContent, /Portrait/);
    d.querySelector("#settings-tab").click();
    assert.equal(d.querySelector("#queue-panel").hidden, true);
    d.querySelector("#copy-pairing").click();
    await wait();
    assert.equal(p.saved[0], "b".repeat(64));
    d.querySelector("#theme").value = "dark";
    d.querySelector("#theme").dispatchEvent(new p.w.Event("change"));
    assert.equal(d.documentElement.dataset.theme, "dark");
    d.querySelector("#reset-appearance").click();
    d.querySelector("#save-appearance").click();
    await wait();
    assert.equal(p.saved.at(-1).appearance.theme, "system");
    assert.equal(p.requests.filter((r) => r.command === "cancel").length, 0);
  } finally {
    p.dom.window.close();
  }
});
test("popup retry button sends the displayed operation id and exposes errors", async () => {
  const p = await popup({
    targetId: "",
    pending: 0,
    queueBytes: 100,
    receivers: [],
    jobs: [
      {
        id: "request-failed",
        sequence: 2,
        title: "A",
        status: "failed",
        size: 100,
        error: "Нет прав",
      },
    ],
  });
  try {
    const d = p.w.document;
    assert.match(d.querySelector("#jobs").textContent, /Нет прав/);
    d.querySelector('[title="Повторить вставку"]').click();
    await wait();
    const r = p.requests.find((r) => r.command === "retry");
    assert.equal(r.data.id, "request-failed");
  } finally {
    p.dom.window.close();
  }
});
function plugin() {
  let html = fs.readFileSync(path.join(root, "plugin/ui.html"), "utf8");
  html = html
    .replace(
      "/*__CORE_JS__*/",
      fs.readFileSync(path.join(root, "plugin/core.js"), "utf8"),
    )
    .replace(
      "/*__UI_JS__*/",
      fs.readFileSync(path.join(root, "plugin/ui.js"), "utf8"),
    );
  const dom = new JSDOM(html, {
      url: "https://fixture.local/",
      runScripts: "dangerously",
    }),
    w = dom.window;
  const sends = [];
  w.postMessage = (m) => sends.push(m.pluginMessage);
  return {
    dom,
    w,
    sends,
    deliver(m) {
      w.dispatchEvent(
        new w.MessageEvent("message", {
          source: w,
          data: { pluginMessage: m },
        }),
      );
    },
  };
}
test("plugin pairing starts only after persistence and layout save excludes pairing from export settings", async () => {
  const p = plugin();
  try {
    const d = p.w.document;
    p.deliver({
      type: "init",
      settings: {
        version: 1,
        layout: {
          columns: 4,
          width: 320,
          gap: 24,
          padding: 24,
          maxHeight: 480,
          radius: 8,
          captions: false,
        },
        appearance: { theme: "light", density: "compact" },
        pairingToken: "",
      },
      target: null,
    });
    d.querySelector("#pair-token").value = "a".repeat(64);
    d.querySelector("#start").click();
    assert.equal(p.sends.at(-1).type, "pair");
    p.deliver({
      type: "paired",
      settings: {
        version: 1,
        layout: {
          columns: 4,
          width: 320,
          gap: 24,
          padding: 24,
          maxHeight: 480,
          radius: 8,
          captions: false,
        },
        appearance: { theme: "light", density: "compact" },
        pairingToken: "a".repeat(64),
      },
    });
    assert.equal(p.sends.at(-1).type, "start");
    d.querySelector("#layout-tab").click();
    d.querySelector("#columns").value = "2";
    d.querySelector("#width").value = "200";
    d.querySelector("#save-layout").click();
    assert.equal(p.sends.at(-1).layout.columns, 2);
    assert.equal(p.sends.at(-1).layout.width, 200);
    assert.equal("pairingToken" in p.sends.at(-1), false);
  } finally {
    p.dom.window.close();
  }
});

async function connectionPage() {
  const dom = new JSDOM(
      fs.readFileSync(path.join(root, "extension/setup.html"), "utf8"),
      { url: "https://fixture.local/setup", runScripts: "outside-only" },
    ),
    w = dom.window;
  const state = {
    version: "1.1.0",
    targetId: "collection-one",
    receivers: [{ targetId: "collection-one", label: "Private file name" }],
    pending: 0,
    failed: 0,
    pairingToken: "a".repeat(64),
    jobs: [],
  };
  let failure = "",
    offline = false;
  const copies = [];
  Object.defineProperty(w.navigator, "clipboard", {
    value: { writeText: async (text) => copies.push(text) },
  });
  w.chrome = {
    runtime: {
      getManifest: () => ({ version: "1.1.0" }),
      sendMessage: async (m) => {
        if (offline) return { ok: false, error: "Helper unavailable" };
        if (m.command === "status") return { ok: true, data: state };
        if (m.command === "installation")
          return {
            ok: true,
            data: {
              pluginPath:
                "C:\\Пользователь & Ref\\app\\figma-plugin\\manifest.json",
            },
          };
        if (m.type === "test-image") {
          if (failure) return { ok: false, error: failure };
          state.jobs = [
            {
              id: "test-request",
              status: "ready",
              pageUrl: "https://private.example/token",
            },
          ];
          return { ok: true, data: { id: "test-request" } };
        }
      },
    },
    storage: { local: { get: async () => ({}) } },
  };
  w.eval(fs.readFileSync(path.join(root, "extension/setup.js"), "utf8"));
  await wait();
  return {
    dom,
    w,
    state,
    copies,
    setFailure: (m) => (failure = m),
    setOffline: (v) => (offline = v),
  };
}
test("connection guide waits for insertion ACK and report excludes pairing, URLs and document names", async () => {
  const p = await connectionPage();
  try {
    const d = p.w.document;
    assert.match(d.getElementById("plugin-path").value, /Пользователь/);
    d.getElementById("test-send").click();
    await wait();
    assert.doesNotMatch(d.getElementById("test-result").textContent, /Готово/);
    assert.equal(d.getElementById("test-send").disabled, true);
    p.state.jobs[0].status = "done";
    d.getElementById("refresh").click();
    await wait();
    assert.match(
      d.getElementById("test-result").textContent,
      /Figma подтвердила/,
    );
    assert.equal(d.getElementById("test-send").disabled, false);
    d.getElementById("copy-report").click();
    await wait();
    const report = p.copies.at(-1);
    assert.equal(JSON.parse(report).testState, "done");
    assert.ok(!report.includes("a".repeat(64)));
    assert.ok(!report.includes("private.example"));
    assert.ok(!report.includes("Private file name"));
  } finally {
    p.dom.window.close();
  }
});
test("connection guide retains action failures after a successful status refresh and disables stale pairing offline", async () => {
  const p = await connectionPage();
  try {
    const d = p.w.document;
    p.setFailure("Image upload failed");
    d.getElementById("test-send").click();
    await wait();
    assert.equal(d.getElementById("notice").hidden, false);
    assert.match(d.getElementById("notice").textContent, /Image upload failed/);
    p.setOffline(true);
    d.getElementById("refresh").click();
    await wait();
    assert.equal(d.getElementById("copy-pairing").disabled, true);
    assert.equal(d.getElementById("test-send").disabled, true);
  } finally {
    p.dom.window.close();
  }
});
test("stopped and superseded receiver sockets cannot send late images to the canvas", async () => {
  const p = plugin(),
    sockets = [];
  class Socket {
    static OPEN = 1;
    constructor() {
      this.readyState = 1;
      sockets.push(this);
    }
    send() {}
    close() {
      this.readyState = 3;
    }
  }
  p.w.WebSocket = Socket;
  try {
    const target = { targetId: "collection-one", label: "One", count: 0 };
    p.deliver({ type: "target", target });
    const old = sockets[0],
      late = old.onmessage;
    p.deliver({
      type: "target",
      target: { ...target, targetId: "collection-two" },
    });
    late({
      data: JSON.stringify({
        type: "image",
        job: { id: "late-image", data: "AQ==", targetId: "collection-one" },
      }),
    });
    assert.equal(p.sends.filter((m) => m.type === "import").length, 0);
    const current = sockets[1];
    assert.notEqual(current, old);
    p.w.document.getElementById("start").click();
    assert.equal(current.onmessage, null);
    assert.equal(current.readyState, 3);
  } finally {
    p.dom.window.close();
  }
});
test("receiver keeps reconnecting after a long outage with a capped delay and respects stop", async () => {
  const p = plugin(),
    sockets = [],
    scheduled = [];
  class Socket {
    static OPEN = 1;
    constructor() {
      this.readyState = 1;
      sockets.push(this);
    }
    send() {}
    close() {
      this.readyState = 3;
    }
  }
  p.w.WebSocket = Socket;
  p.w.setTimeout = (fn, ms) => {
    scheduled.push({ fn, ms });
    return scheduled.length;
  };
  p.w.clearTimeout = () => {};
  try {
    p.deliver({
      type: "target",
      target: { targetId: "collection-one", label: "One", count: 0 },
    });
    for (let i = 0; i < 8; i++) {
      sockets.at(-1).onclose();
      const timer = scheduled.at(-1);
      assert.ok(timer.ms <= 30000);
      timer.fn();
    }
    assert.equal(sockets.length, 9);
    assert.equal(
      p.w.document.getElementById("start").textContent,
      "Остановить приём",
    );
    p.w.document.getElementById("start").click();
    scheduled.at(-1).fn();
    assert.equal(sockets.length, 9);
  } finally {
    p.dom.window.close();
  }
});
test("popup keeps row identity and keyboard focus across unchanged polls, then updates a changed job", async () => {
  const s = {
    targetId: "collection-a",
    receivers: [],
    pending: 1,
    queueBytes: 10,
    jobs: [
      {
        id: "request-stable",
        sequence: 1,
        title: "Stable",
        status: "ready",
        size: 10,
      },
    ],
  };
  const p = await popup(s);
  try {
    const d = p.w.document,
      row = d.querySelector(".job"),
      button = row.querySelector("button");
    button.focus();
    d.getElementById("refresh").click();
    await wait();
    assert.equal(d.querySelector(".job"), row);
    assert.equal(d.activeElement, button);
    s.jobs[0].status = "done";
    d.getElementById("refresh").click();
    await wait();
    assert.equal(d.querySelector(".job").dataset.status, "done");
    assert.equal(d.getElementById("notice").hidden, true);
  } finally {
    p.dom.window.close();
  }
});
test("popup search and filter changes neither clear nor mutate queued jobs", async () => {
  const s = {
    targetId: "",
    receivers: [],
    pending: 1,
    failed: 1,
    jobs: [
      {
        id: "request-ready",
        sequence: 1,
        title: "Портрет",
        status: "ready",
        size: 10,
      },
      {
        id: "request-failed",
        sequence: 2,
        title: "Error",
        status: "failed",
        size: 10,
      },
    ],
  };
  const p = await popup(s);
  try {
    const d = p.w.document;
    d.querySelector("[data-filter=failed]").click();
    assert.equal(d.querySelectorAll(".job").length, 1);
    assert.match(d.querySelector(".job").textContent, /Error/);
    d.querySelector("[data-filter=all]").click();
    const search = d.getElementById("search");
    search.value = "порт";
    search.dispatchEvent(new p.w.Event("input"));
    assert.equal(d.querySelectorAll(".job").length, 1);
    search.dispatchEvent(new p.w.KeyboardEvent("keydown", { key: "Escape" }));
    assert.equal(d.querySelectorAll(".job").length, 2);
    assert.equal(
      p.requests.some((r) => r.command === "cancel" || r.command === "batch"),
      false,
    );
  } finally {
    p.dom.window.close();
  }
});
test("bulk cancellation requires confirmation and omits an inflight insertion", async () => {
  const s = {
    targetId: "collection-a",
    receivers: [],
    pending: 2,
    jobs: [
      {
        id: "request-ready",
        sequence: 1,
        title: "Ready",
        status: "ready",
        size: 10,
      },
      {
        id: "request-inflight",
        sequence: 2,
        title: "Busy",
        status: "inflight",
        size: 10,
      },
    ],
  };
  const p = await popup(s);
  try {
    const d = p.w.document,
      dialog = d.getElementById("confirm-dialog");
    dialog.showModal = () => {};
    d.querySelector("[data-filter=active]").click();
    d.getElementById("cancel-waiting").click();
    assert.equal(
      p.requests.some((r) => r.command === "batch"),
      false,
    );
    dialog.returnValue = "cancel";
    dialog.dispatchEvent(new p.w.Event("close"));
    await wait();
    assert.equal(
      p.requests.some((r) => r.command === "batch"),
      false,
    );
    d.getElementById("cancel-waiting").click();
    dialog.returnValue = "confirm";
    dialog.dispatchEvent(new p.w.Event("close"));
    await wait();
    const request = p.requests.find((r) => r.command === "batch");
    assert.deepEqual(Array.from(request.data.ids), ["request-ready"]);
  } finally {
    p.dom.window.close();
  }
});
test("popup preview uses the authenticated local preview and never loads a website image", async () => {
  const s = {
    targetId: "",
    receivers: [],
    pending: 1,
    jobs: [
      {
        id: "request-preview",
        sequence: 1,
        title: "Preview",
        status: "ready",
        size: 10,
        hasPreview: false,
      },
    ],
  };
  const p = await popup(s);
  try {
    p.w.chrome.runtime.sendMessage = async (m) => {
      p.requests.push(m);
      return {
        ok: true,
        data:
          m.command === "thumbnail"
            ? { data: "data:image/png;base64,AQ==" }
            : s,
      };
    };
    s.jobs[0].hasPreview = true;
    p.w.document.getElementById("refresh").click();
    await wait();
    await wait();
    assert.equal(
      p.w.document.querySelector(".job-thumb img").src,
      "data:image/png;base64,AQ==",
    );
    p.w.document.getElementById("refresh").click();
    await wait();
    assert.equal(p.requests.filter((r) => r.command === "thumbnail").length, 1);
  } finally {
    p.dom.window.close();
  }
});
test("layout presets modify only the draft until explicitly saved", () => {
  const p = plugin();
  try {
    const d = p.w.document,
      preset = d.getElementById("layout-preset");
    preset.value = "compact";
    preset.dispatchEvent(new p.w.Event("change"));
    assert.equal(d.getElementById("columns").value, "6");
    assert.equal(d.getElementById("width").value, "180");
    assert.equal(
      p.sends.some((m) => m.type === "settings"),
      false,
    );
    assert.match(
      d.getElementById("layout-save-state").textContent,
      /после сохранения/,
    );
    d.getElementById("save-layout").click();
    assert.equal(p.sends.at(-1).layout.columns, 6);
    assert.equal(p.sends.at(-1).layout.gap, 12);
    assert.equal(
      p.sends.some((m) => m.type === "reflow"),
      false,
    );
  } finally {
    p.dom.window.close();
  }
});
