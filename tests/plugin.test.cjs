const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const root = path.join(__dirname, "..");

const {fixture,pluginSource}=require("./figma-fixture.cjs");

async function setup() {
  const f = fixture();
  const ctx = {
    figma: f.figma,
    __html__: "__STF_CHANNEL__",
    Uint8Array,
    console,
    Math,
    Date,
    JSON,
    Promise,
  };
  vm.createContext(ctx);
  vm.runInContext(pluginSource(), ctx);
  await turn();
  return f;
}
const turn = () => new Promise((r) => setImmediate(r));
async function send(f, m) {
  if (m.type === "import" && m.job.targetId === undefined)
    m = {
      ...m,
      job: {
        ...m.job,
        targetId: f.messages.filter((v) => v.type === "target").at(-1)?.target
          .targetId,
      },
    };
  await f.figma.ui.onmessage({ ...m, channel: f.figma.shownHTML });
  await turn();
  return f.messages.at(-1);
}
test("acknowledgement replay finds the same card instead of inserting twice", async () => {
  const f = await setup();
  await send(f, { type: "start", mode: "new" });
  const target = f.messages.find((m) => m.type === "target");
  assert.ok(target?.target.targetId);
  const job = {
    id: "request-first",
    sequence: 1,
    title: "Reference",
    width: 400,
    height: 200,
    mime: "image/png",
    captureMode: "original",
    pageUrl: "https://example.com/",
    sourceUrl: "https://example.com/a.png",
    bytes: [1, 2, 3],
  };
  const a = await send(f, { type: "import", job });
  assert.equal(a.type, "import-result");
  assert.equal(a.ok, true);
  const b = await send(f, { type: "import", job });
  assert.equal(b.ok, true);
  assert.equal(b.nodeId, a.nodeId);
  const cards = [...f.nodes.values()].filter(
    (n) => n.getPluginData("stf-job") === "request-first",
  );
  assert.equal(cards.length, 1);
  assert.equal(cards[0].width, 320);
  assert.equal(cards[0].height, 160);
  assert.equal(
    JSON.parse(cards[0].getPluginData("stf-meta")).pageUrl,
    "https://example.com/",
  );
});
test("selection changes do not divert subsequent imports from pinned collection", async () => {
  const f = await setup();
  await send(f, { type: "start", mode: "new" });
  const target = f.messages.find((m) => m.type === "target").target;
  const other = f.node("FRAME");
  f.page.appendChild(other);
  f.page.selection = [other];
  const result = await send(f, {
    type: "import",
    job: {
      id: "request-first",
      sequence: 1,
      title: "A",
      width: 400,
      height: 200,
      mime: "image/png",
      bytes: [1],
    },
  });
  assert.equal(result.ok, true);
  const card = f.nodes.get(result.nodeId);
  assert.equal(card.parent.id, target.nodeId);
  assert.equal(other.children.length, 0);
});
test("failed insertion removes partial nodes and can be retried cleanly", async () => {
  const f = await setup();
  await send(f, { type: "start", mode: "new" });
  f.figma.createImage = () => {
    throw new Error("Invalid image");
  };
  const job = {
    id: "request-first",
    sequence: 1,
    width: 400,
    height: 200,
    mime: "image/png",
    bytes: [1],
  };
  const result = await send(f, { type: "import", job });
  assert.equal(result.ok, false);
  assert.equal(
    [...f.nodes.values()].filter((n) => n.getPluginData("stf-job")).length,
    0,
  );
  f.figma.createImage = () => ({
    hash: "ok",
    getSizeAsync: async () => ({ width: 400, height: 200 }),
  });
  assert.equal((await send(f, { type: "import", job })).ok, true);
});
test("reflow moves managed cards and preserves unrelated nodes", async () => {
  const f = await setup();
  await send(f, { type: "start", mode: "new" });
  const target = f.messages.find((m) => m.type === "target").target,
    frame = f.nodes.get(target.nodeId);
  for (let i = 0; i < 3; i++)
    await send(f, {
      type: "import",
      job: {
        id: `request-${i}`,
        sequence: i + 1,
        width: 400,
        height: 200,
        mime: "image/png",
        bytes: [1],
      },
    });
  const unmanaged = f.node("RECTANGLE");
  unmanaged.x = 1000;
  unmanaged.y = 700;
  frame.appendChild(unmanaged);
  await send(f, {
    type: "settings",
    layout: { columns: 1, width: 200, gap: 20, padding: 10 },
    appearance: { theme: "light", density: "compact" },
  });
  await send(f, { type: "reflow" });
  const cards = frame.children.filter((n) => n.getPluginData("stf-job"));
  assert.deepEqual(
    cards.map((n) => [n.x, n.y]),
    [
      [10, 10],
      [10, 130],
      [10, 250],
    ],
  );
  assert.deepEqual([unmanaged.x, unmanaged.y], [1000, 700]);
});
test("retrying an older failed image never overlaps the next successful insertion", async () => {
  const f = await setup();
  await send(f, { type: "start", mode: "new" });
  const job = (n) => ({
    id: "request-" + n,
    sequence: n,
    title: "Image " + n,
    width: 400,
    height: 200,
    mime: "image/png",
    bytes: [1],
  });
  for (const n of [2, 1, 3])
    assert.equal((await send(f, { type: "import", job: job(n) })).ok, true);
  const target = f.messages.find((m) => m.type === "target").target,
    frame = f.nodes.get(target.nodeId),
    byID = new Map(
      frame.children
        .filter((n) => n.getPluginData("stf-job"))
        .map((n) => [n.getPluginData("stf-job"), n]),
    );
  assert.deepEqual(
    [byID.get("request-2").x, byID.get("request-1").x, byID.get("request-3").x],
    [24, 368, 712],
  );
  await send(f, { type: "reflow" });
  assert.deepEqual(
    [byID.get("request-1").x, byID.get("request-2").x, byID.get("request-3").x],
    [24, 368, 712],
  );
});
test("starting while settings load waits for persisted configuration", async () => {
  const f = fixture();
  let finish;
  f.figma.clientStorage.getAsync = () => new Promise((r) => (finish = r));
  const context = {
    figma: f.figma,
    __html__: "__STF_CHANNEL__",
    Uint8Array,
    console,
    Math,
    Date,
    JSON,
    Promise,
  };
  vm.createContext(context);
  vm.runInContext(pluginSource(), context);
  const start = f.figma.ui.onmessage({ type: "start", mode: "new", channel: f.figma.shownHTML });
  await turn();
  assert.equal(
    [...f.nodes.values()].filter((n) => n.type === "FRAME").length,
    0,
    "start overtook stored settings",
  );
  finish({
    version: 1,
    layout: { width: 200 },
    appearance: { theme: "light", density: "compact" },
  });
  await start;
  assert.equal(
    [...f.nodes.values()].find((n) => n.type === "FRAME").width,
    248,
  );
});
test("delayed delivery for a previous destination is rejected without creating a card", async () => {
  const f = await setup();
  await send(f, { type: "start", mode: "new" });
  const old = f.messages.filter((m) => m.type === "target").at(-1).target;
  await send(f, { type: "start", mode: "new" });
  const result = await send(f, {
    type: "import",
    job: {
      id: "request-stale",
      targetId: old.targetId,
      sequence: 1,
      width: 400,
      height: 200,
      bytes: [1],
    },
  });
  assert.equal(result.ok, false);
  assert.match(result.error, /Получатель изменился/);
  assert.equal(
    [...f.nodes.values()].filter((n) => n.getPluginData("stf-job")).length,
    0,
  );
});
test("locking the collection during image decoding prevents any new node mutation", async () => {
  const f = await setup();
  await send(f, { type: "start", mode: "new" });
  const target = f.messages.filter((m) => m.type === "target").at(-1).target,
    frame = f.nodes.get(target.nodeId);
  f.figma.createImage = () => ({
    hash: "x",
    getSizeAsync: async () => {
      frame.locked = true;
      return { width: 400, height: 200 };
    },
  });
  const result = await send(f, {
    type: "import",
    job: {
      id: "request-lock",
      sequence: 1,
      width: 400,
      height: 200,
      bytes: [1],
    },
  });
  assert.equal(result.ok, false);
  assert.match(result.error, /заблокированы/);
  assert.equal(frame.children.length, 0);
});
test("reveal switches to the page containing the pinned collection before selection", async () => {
  const f = await setup();
  await send(f, { type: "start", mode: "new" });
  const target = f.messages.filter((m) => m.type === "target").at(-1).target;
  const other = f.node("PAGE");
  other.selection = [];
  f.figma.root.appendChild(other);
  f.figma.currentPage = other;
  let switched = false;
  f.figma.setCurrentPageAsync = async (p) => {
    switched = true;
    f.figma.currentPage = p;
  };
  await send(f, { type: "reveal" });
  assert.equal(switched, true);
  assert.equal(f.figma.currentPage.id, f.page.id);
  assert.equal(f.page.selection[0].id, target.nodeId);
});
test("failed settings or pairing persistence leaves the last confirmed settings active", async () => {
  const f = await setup();
  f.figma.clientStorage.setAsync = async () => {
    throw Error("Storage unavailable");
  };
  assert.equal(
    (
      await send(f, {
        type: "settings",
        layout: { width: 700 },
        appearance: { theme: "dark" },
      })
    ).type,
    "error",
  );
  assert.equal(
    (await send(f, { type: "pair", token: "a".repeat(64) })).type,
    "error",
  );
  const snapshot = await send(f, { type: "init" });
  assert.equal(snapshot.settings.layout.width, 320);
  assert.equal(snapshot.settings.appearance.theme, "system");
  assert.equal(snapshot.settings.pairingToken, "");
  await send(f, { type: "start", mode: "new" });
  assert.equal(
    [...f.nodes.values()].find((n) => n.type === "FRAME").width,
    368,
  );
});

test("host ignores a command from another plugin launch channel",async()=>{
 const f=await setup();
 await f.figma.ui.onmessage({type:"start",mode:"new",channel:"foreign"});await turn();
 assert.equal([...f.nodes.values()].filter(n=>n.type==="FRAME").length,0);
 await send(f,{type:"start",mode:"new"});
 assert.equal([...f.nodes.values()].filter(n=>n.getPluginData("stf-collection")).length,1);
});

test("installed pairing remains available when Figma client storage cannot be read",async()=>{
 const f=fixture(),token="b".repeat(64);
 f.figma.clientStorage.getAsync=async()=>{throw Error("Storage unavailable")};
 const context=vm.createContext({figma:f.figma,__html__:"__STF_CHANNEL__",Uint8Array,console,Math,Date,JSON,Promise});
 vm.runInContext(pluginSource().replace("__STF_INSTALL_TOKEN__",token),context);await turn();
 assert.equal(f.messages.findLast(m=>m.type==="init").settings.pairingToken,token);
 await send(f,{type:"start",mode:"restore"});
 assert.ok(f.messages.some(m=>m.type==="target"));
});
