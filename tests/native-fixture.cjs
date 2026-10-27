const fs=require("node:fs"), path=require("node:path"), cp=require("node:child_process"), net=require("node:net");
const root = path.join(__dirname, ".."),
  binary =
    process.env.STF_TEST_BRIDGE ||
    (process.platform === "win32"
      ? path.join(
          root,
          "release/Send-to-Figma-" +
            require("../package.json").version +
            "/windows",
          process.arch === "arm64" ? "arm64" : "amd64",
          "send-to-figma-bridge.exe",
        )
      : path.join(root, ".build/send-to-figma-bridge"));
async function freePort() {
  const s = net.createServer();
  await new Promise((r) => s.listen(0, "127.0.0.1", r));
  const p = s.address().port;
  await new Promise((r) => s.close(r));
  return p;
}
async function waitFor(fn, ms = 5000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const result = await fn();
    if (result) return result;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw Error("Timed out waiting for integration state");
}
function nativeProcess(dir, port) {
  const p = cp.spawn(binary, ["--data-dir", dir, "--port", String(port)], {
    stdio: ["pipe", "pipe", "pipe"],
  });
  let buffer = Buffer.alloc(0),
    n = 0;
  const waiting = new Map();
  p.stdout.on("data", (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    while (buffer.length >= 4 && buffer.length >= 4 + buffer.readUInt32LE(0)) {
      const len = buffer.readUInt32LE(0),
        m = JSON.parse(buffer.subarray(4, 4 + len).toString());
      buffer = buffer.subarray(4 + len);
      const call = waiting.get(m.requestId);
      if (call) {
        waiting.delete(m.requestId);
        clearTimeout(call.timer);
        m.ok ? call.resolve(m.data) : call.reject(Error(m.error));
      }
    }
  });
  return {
    process: p,
    call(type, data = {}) {
      return new Promise((resolve, reject) => {
        const requestId = "e2e-" + ++n,
          body = Buffer.from(JSON.stringify({ requestId, type, data })),
          header = Buffer.alloc(4);
        header.writeUInt32LE(body.length);
        const timer = setTimeout(() => {
          waiting.delete(requestId);
          reject(Error("Native reply timed out"));
        }, 5000);
        waiting.set(requestId, { resolve, reject, timer });
        p.stdin.write(Buffer.concat([header, body]));
      });
    },
  };
}

module.exports={binary,freePort,waitFor,nativeProcess};
