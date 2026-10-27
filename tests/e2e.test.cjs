const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path"),
  os = require("node:os"),
  cp = require("node:child_process"),
  net = require("node:net");
const WebSocket = require("ws");
const {binary,freePort,waitFor,nativeProcess}=require("./native-fixture.cjs");
function receiver(port, token) {
  const socket = new WebSocket("ws://localhost:" + port + "/receiver", {
    origin: "null",
  });
  const messages = [];
  socket.on("message", (b) => messages.push(JSON.parse(b.toString())));
  return {
    socket,
    messages,
    async connect() {
      await new Promise((r, j) => {
        socket.once("open", r);
        socket.once("error", j);
      });
      socket.send(
        JSON.stringify({
          type: "hello",
          token,
          targetId: "collection-e2e",
          label: "Integration / References",
        }),
      );
      await waitFor(() => messages.some((m) => m.type === "connected"));
    },
    nextImage() {
      return waitFor(() => {
        const i = messages.findIndex((m) => m.type === "image");
        return i < 0 ? null : messages.splice(i, 1)[0].job;
      });
    },
  };
}
test(
  "real native stdio -> durable bridge -> WebSocket delivers in order and survives lost ACK",
  { skip: !fs.existsSync(binary) ? "Build the native helper first" : false },
  async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "stf-e2e-")),
      port = await freePort();
    let server = cp.spawn(
        binary,
        ["--serve", "--data-dir", dir, "--port", String(port)],
        { stdio: ["ignore", "pipe", "pipe"] },
      ),
      native = null,
      r = null;
    try {
      await waitFor(async () => {
        try {
          return (await fetch("http://127.0.0.1:" + port + "/health")).ok;
        } catch {
          return false;
        }
      });
      native = nativeProcess(dir, port);
      const initial = await native.call("status");
      assert.equal(initial.pending, 0);
      assert.match(initial.pairingToken, /^[a-f0-9]{64}$/);
      const one = await native.call("reserve", {
          id: "request-e2e-first",
          title: "First",
          pageUrl: "https://example.com/1",
        }),
        two = await native.call("reserve", {
          id: "request-e2e-second",
          title: "Second",
        });
      assert.equal(one.sequence, 1);
      assert.equal(two.sequence, 2);
      const png = fs
        .readFileSync(path.join(__dirname, "fixtures/transparent.png"))
        .toString("base64");
      await native.call("upload", {
        id: two.id,
        data: png,
        mime: "image/png",
        width: 12,
        height: 8,
        captureMode: "original",
      });
      r = receiver(port, initial.pairingToken);
      await r.connect();
      r.socket.send(JSON.stringify({ type: "claim" }));
      await new Promise((x) => setTimeout(x, 300));
      assert.equal(
        r.messages.some((m) => m.type === "image"),
        false,
        "second image overtook unfinished first capture",
      );
      await native.call("upload", {
        id: one.id,
        data: png,
        mime: "image/png",
        width: 12,
        height: 8,
        captureMode: "original",
      });
      const delivery = await r.nextImage();
      assert.equal(delivery.id, one.id);
      assert.equal(delivery.data, png);
      // Simulate insertion succeeding but ACK vanishing. The same operation is replayed.
      r.socket.close();
      await waitFor(async () => {
        const s = await native.call("status");
        return s.jobs.find((j) => j.id === one.id)?.status === "ready";
      });
      r = receiver(port, initial.pairingToken);
      await r.connect();
      const replay = await r.nextImage();
      assert.equal(replay.id, one.id);
      r.socket.send(
        JSON.stringify({ type: "ack", id: replay.id, ok: true, nodeId: "1:1" }),
      );
      const second = await r.nextImage();
      assert.equal(second.id, two.id);
      r.socket.send(
        JSON.stringify({ type: "ack", id: second.id, ok: true, nodeId: "1:2" }),
      );
      await waitFor(async () => {
        const s = await native.call("status");
        return s.done === 2 && s.pending === 0;
      });
      assert.equal(
        fs
          .readdirSync(path.join(dir, "images"))
          .filter((n) => n.endsWith(".bin")).length,
        0,
      );
      const third = await native.call("reserve", {
        id: "request-e2e-third",
        title: "After restart",
      });
      await native.call("upload", {
        id: third.id,
        data: png,
        mime: "image/png",
        width: 12,
        height: 8,
      });
      r.socket.close();
      native.process.stdin.end();
      native.process.kill();
      native = null;
      server.kill();
      await new Promise((resolve) => server.once("exit", resolve));
      server = cp.spawn(
        binary,
        ["--serve", "--data-dir", dir, "--port", String(port)],
        { stdio: ["ignore", "pipe", "pipe"] },
      );
      await waitFor(async () => {
        try {
          return (await fetch("http://127.0.0.1:" + port + "/health")).ok;
        } catch {
          return false;
        }
      });
      native = nativeProcess(dir, port);
      const recovered = await native.call("status");
      assert.equal(recovered.pending, 1);
      assert.equal(recovered.targetId, "collection-e2e");
      assert.equal(
        recovered.jobs.find((j) => j.id === third.id).status,
        "ready",
      );
    } finally {
      if (r) r.socket.terminate();
      if (native) {
        native.process.stdin.end();
        native.process.kill();
      }
      if (server) {
        server.kill();
        await new Promise((resolve) => server.once("exit", resolve));
      }
      fs.rmSync(dir, { recursive: true, force: true });
    }
  },
);
test(
  "corrupt queue returns an actionable native reply without discarding data",
  { skip: !fs.existsSync(binary) },
  async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "stf-bad-")),
      port = await freePort();
    fs.writeFileSync(path.join(dir, "queue.json"), "broken");
    const native = nativeProcess(dir, port);
    try {
      await assert.rejects(
        native.call("status"),
        /очеред.*повреж|queue\.json/i,
      );
      assert.equal(
        fs.readFileSync(path.join(dir, "queue.json"), "utf8"),
        "broken",
      );
    } finally {
      native.process.stdin.end();
      native.process.kill();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  },
);

test(
  "native connection restarts a crashed helper without restarting the browser",
  { skip: !fs.existsSync(binary) },
  async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "stf-restart-")),
      port = await freePort();
    let server = cp.spawn(
        binary,
        ["--serve", "--data-dir", dir, "--port", String(port)],
        { stdio: "ignore" },
      ),
      native = null,
      recoveredPID = 0;
    try {
      await waitFor(async () => {
        try {
          return (await fetch("http://127.0.0.1:" + port + "/health")).ok;
        } catch {
          return false;
        }
      });
      native = nativeProcess(dir, port);
      await native.call("reserve", {
        id: "restart-request",
        title: "Keep this job",
      });
      const before = await native.call("status");
      const ended = new Promise((r) => server.once("exit", r));
      server.kill();
      await ended;
      server = null;
      const after = await native.call("status");
      assert.equal(after.pairingToken, before.pairingToken);
      assert.equal(after.jobs[0].id, "restart-request");
      recoveredPID = Number(
        (await (await fetch("http://127.0.0.1:" + port + "/health")).json())
          .pid,
      );
      assert.ok(recoveredPID > 0);
    } finally {
      native?.process.stdin.end();
      native?.process.kill();
      if (server) server.kill();
      if (recoveredPID)
        try {
          process.kill(recoveredPID);
        } catch {}
      await waitFor(async () => {
        try {
          await fetch("http://127.0.0.1:" + port + "/health");
          return false;
        } catch {
          return true;
        }
      });
      fs.rmSync(dir, { recursive: true, force: true });
    }
  },
);
test(
  "real native RPC supports bounded preview, source recovery, pause and safe bulk cleanup",
  { skip: !fs.existsSync(binary) },
  async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "stf-rpc-")),
      port = await freePort(),
      server = cp.spawn(
        binary,
        ["--serve", "--data-dir", dir, "--port", String(port)],
        { stdio: "ignore" },
      );
    let native;
    try {
      await waitFor(async () => {
        try {
          return (await fetch("http://127.0.0.1:" + port + "/health")).ok;
        } catch {
          return false;
        }
      });
      native = nativeProcess(dir, port);
      const id = "request-new-rpc",
        data = fs
          .readFileSync(path.join(__dirname, "fixtures/transparent.png"))
          .toString("base64"),
        preview = "data:image/png;base64," + data;
      await native.call("reserve", {
        id,
        title: "Preview",
        pageUrl:
          "https://user:secret@example.com/reference?token=secret#private",
      });
      await native.call("upload", {
        id,
        data,
        mime: "image/png",
        width: 12,
        height: 8,
        preview,
      });
      assert.equal((await native.call("thumbnail", { id })).data, preview);
      assert.equal(
        (await native.call("source", { id })).url,
        "https://example.com/reference",
      );
      assert.equal((await native.call("pause", { paused: true })).paused, true);
      assert.equal((await native.call("status")).paused, true);
      assert.equal(
        (await native.call("batch", { operation: "cancel", ids: [id] }))
          .changed,
        1,
      );
      assert.equal(
        (await native.call("batch", { operation: "clear_history" })).changed,
        1,
      );
      await assert.rejects(native.call("thumbnail", { id }), /не найдено/);
      assert.equal(fs.readdirSync(path.join(dir, "previews")).length, 0);
    } finally {
      native?.process.stdin.end();
      native?.process.kill();
      const ended = new Promise((r) => server.once("exit", r));
      server.kill();
      await ended;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  },
);
