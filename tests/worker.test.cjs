const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { randomUUID } = require("node:crypto");
function worker() {
  const requests = [],
    notifications = [],
    listeners = {},
    jobs = new Map();
  let seq = 0,
    gets = 0;
  const listener = (key) => ({ addListener: (f) => (listeners[key] = f) });
  const chrome = {
    runtime: {
      id: "test-extension",
      lastError: null,
      getURL: (p) => "chrome-extension://test-extension/" + p,
      onInstalled: listener("installed"),
      onStartup: listener("startup"),
      onMessage: listener("message"),
      sendMessage: async (m) => ({
        ok: true,
        data: m.data,
        mime: "image/png",
        width: 12,
        height: 8,
        captureMode: m.crop ? "screen" : "original",
      }),
      connectNative() {
        const port = {
          onMessage: { addListener: (f) => (port.receive = f) },
          onDisconnect: { addListener: (f) => (port.disconnect = f) },
          postMessage(m) {
            requests.push(m);
            let data;
            const v = m.data;
            if (m.type === "reserve") {
              data = {
                ...v,
                sequence: ++seq,
                status: "capturing",
                targetLabel: "References",
              };
              jobs.set(v.id, data);
            } else if (m.type === "upload") {
              data = { ...jobs.get(v.id), status: "ready" };
              jobs.set(v.id, data);
            } else if (m.type === "status")
              data = {
                pending: jobs.size,
                receivers: [],
                jobs: [...jobs.values()],
              };
            else if (m.type === "fail") {
              data = jobs.get(v.id);
              if (data) data.status = "failed";
            }
            queueMicrotask(() =>
              port.receive({ requestId: m.requestId, ok: true, data }),
            );
          },
        };
        return port;
      },
    },
    contextMenus: {
      removeAll: async () => {},
      create() {},
      onClicked: listener("click"),
    },
    alarms: { create() {}, onAlarm: listener("alarm") },
    storage: {
      session: {
        get: async () => {
          const i = gets++;
          if (i === 0) await new Promise((r) => setTimeout(r, 30));
          return {};
        },
        set: async () => {},
      },
    },
    offscreen: { hasDocument: async () => true },
    notifications: { create: async (n) => notifications.push(n) },
    action: {
      setBadgeText: async () => {},
      setBadgeBackgroundColor: async () => {},
    },
    tabs: {
      sendMessage: async (tab, m) =>
        m.type === "get-context"
          ? { target: null }
          : { ok: false, error: "No" },
      update: async () => {},
      captureVisibleTab: async () => {
        throw Error("Not captured");
      },
    },
    scripting: { executeScript: async () => {} },
  };
  const context = {
    chrome,
    crypto: { randomUUID },
    console,
    Uint8Array,
    AbortController,
    Date,
    Math,
    Map,
    Promise,
    Error,
    setTimeout,
    clearTimeout,
    btoa: (s) => Buffer.from(s, "binary").toString("base64"),
    atob: (s) => Buffer.from(s, "base64").toString("binary"),
    fetch: async () =>
      new Response(new Uint8Array([1, 2, 3]), {
        headers: { "content-type": "image/png" },
      }),
    Response,
  };
  vm.createContext(context);
  context.importScripts = (...names) =>
    names.forEach((n) =>
      vm.runInContext(
        fs.readFileSync(path.join(__dirname, "../extension", n), "utf8"),
        context,
      ),
    );
  vm.runInContext(
    fs.readFileSync(path.join(__dirname, "../extension/background.js"), "utf8"),
    context,
  );
  return { context, requests, notifications, listeners, jobs };
}
test("slow target lookup must not let the next browser click reserve first", async () => {
  const w = worker(),
    tab = { id: 1, windowId: 1, title: "Page", url: "https://example.com/" };
  await Promise.all([
    vm.runInContext(
      'sendImage({srcUrl:"https://example.com/first.png",pageUrl:"https://example.com/"},{id:1,windowId:1,title:"first",url:"https://example.com/"})',
      w.context,
    ),
    vm.runInContext(
      'sendImage({srcUrl:"https://example.com/second.png",pageUrl:"https://example.com/"},{id:1,windowId:1,title:"second",url:"https://example.com/"})',
      w.context,
    ),
  ]);
  assert.deepEqual(
    w.requests.filter((r) => r.type === "reserve").map((r) => r.data.sourceUrl),
    ["https://example.com/first.png", "https://example.com/second.png"],
  );
});
test("a foreign page cannot invoke native queue commands", () => {
  const w = worker();
  let replied = false;
  const result = w.listeners.message(
    { type: "rpc", command: "cancel", data: { id: "anything" } },
    { id: "test-extension", tab: { id: 1 }, url: "https://example.com/" },
    () => (replied = true),
  );
  assert.equal(result, undefined);
  assert.equal(w.requests.length, 0);
  assert.equal(replied, false);
});
test("toolbar area capture never inherits an old context image source", async () => {
  const w = worker();
  w.context.chrome.storage.session.get = async () => ({
    "context-1": {
      frameId: 0,
      target: {
        source: "https://example.com/old.png",
        title: "Old picture",
        pageUrl: "https://example.com/",
      },
    },
  });
  try {
    await vm.runInContext(
      'sendImage({},{id:1,windowId:1,title:"Current page",url:"https://example.com/"},true)',
      w.context,
    );
  } catch {}
  const reservation = w.requests.find((r) => r.type === "reserve");
  assert.equal(reservation.data.sourceUrl, "");
  assert.equal(reservation.data.title, "Current page");
});
test("rapid clicks reserve in order while at most two capture pipelines fetch at once", async () => {
  const w = worker();
  let active = 0,
    max = 0;
  w.context.fetch = async () => {
    active++;
    max = Math.max(max, active);
    await new Promise((r) => setTimeout(r, 20));
    active--;
    return new Response(new Uint8Array([1, 2, 3]), {
      headers: { "content-type": "image/png" },
    });
  };
  await Promise.all(
    Array.from({ length: 8 }, (_, i) =>
      vm.runInContext(
        'sendImage({srcUrl:"https://example.com/' +
          i +
          '.png"},{id:1,windowId:1,title:"Image ' +
          i +
          '",url:"https://example.com/"})',
        w.context,
      ),
    ),
  );
  assert.equal(max, 2);
  assert.deepEqual(
    w.requests.filter((r) => r.type === "reserve").map((r) => r.data.sourceUrl),
    Array.from({ length: 8 }, (_, i) => "https://example.com/" + i + ".png"),
  );
  assert.equal(w.requests.filter((r) => r.type === "begin_capture").length, 8);
});
