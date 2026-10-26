const test = require("node:test");
const assert = require("node:assert/strict");
test("oversized source is resized proportionally to Figma bounds", () => {
  const c = require("../extension/capture-core.js");
  assert.deepEqual(c.fitSize(6000, 3000), {
    width: 4096,
    height: 2048,
    resized: true,
  });
  assert.deepEqual(c.fitSize(800, 1200), {
    width: 800,
    height: 1200,
    resized: false,
  });
  assert.throws(() => c.fitSize(0, 100));
});
test("capture crop clips to visible viewport and rejects invisible elements", () => {
  const c = require("../extension/capture-core.js");
  assert.deepEqual(
    c.visibleRect(
      { x: -20, y: 30, width: 100, height: 80 },
      { width: 500, height: 100 },
    ),
    { x: 0, y: 30, width: 80, height: 70 },
  );
  assert.equal(
    c.visibleRect(
      { x: 700, y: 0, width: 100, height: 100 },
      { width: 500, height: 100 },
    ),
    null,
  );
});
test("native disconnect rejects outstanding calls and later call reconnects", async () => {
  const { create } = require("../extension/native-client.js");
  const ports = [];
  const chrome = {
    runtime: {
      lastError: null,
      connectNative() {
        const p = {
          onMessage: { addListener: (f) => (p.message = f) },
          onDisconnect: { addListener: (f) => (p.disconnect = f) },
          postMessage: (m) => (p.sent = m),
          disconnect() {},
        };
        ports.push(p);
        return p;
      },
    },
  };
  const client = create(chrome),
    first = client.call("status", {});
  ports[0].disconnect();
  await assert.rejects(first, /помощник|связь/i);
  const second = client.call("status", {});
  assert.equal(ports.length, 2);
  ports[1].message({
    requestId: ports[1].sent.requestId,
    ok: true,
    data: { pending: 0 },
  });
  assert.deepEqual(await second, { pending: 0 });
});
test("a native error never becomes a successful queue acknowledgement", async () => {
  const { create } = require("../extension/native-client.js");
  let p;
  const client = create({
    runtime: {
      connectNative() {
        p = {
          onMessage: { addListener: (f) => (p.message = f) },
          onDisconnect: { addListener() {} },
          postMessage: (m) => (p.sent = m),
        };
        return p;
      },
    },
  });
  const result = client.call("upload", { id: "request-1" });
  p.message({ requestId: p.sent.requestId, ok: false, error: "Диск заполнен" });
  await assert.rejects(result, /Диск заполнен/);
});
