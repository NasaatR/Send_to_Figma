// This mutates the product's per-user HKCU registration only on disposable CI.
const fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path"),
  cp = require("node:child_process"),
  assert = require("node:assert/strict");
if (process.platform !== "win32" || process.env.GITHUB_ACTIONS !== "true")
  throw Error(
    "Windows install smoke test is restricted to disposable GitHub Actions Windows runners",
  );
const version = require("../package.json").version,
  root = path.resolve(__dirname, ".."),
  release = path.join(root, "release", "Send-to-Figma-" + version),
  temp = fs.mkdtempSync(path.join(os.tmpdir(), "stf-install-")),
  env = { ...process.env, LOCALAPPDATA: temp },
  setup = path.join(release, "Setup.exe"),
  installed = path.join(temp, "SendToFigma");
let native, serverPID;
const run = (args) => {
  const r = cp.spawnSync(setup, args, {
    env,
    encoding: "utf8",
    windowsHide: true,
    timeout: 45000,
  });
  if (r.error) throw r.error;
  assert.equal(r.status, 0, r.stderr || "Setup failed");
};
(async () => {
  try {
    run(["--silent"]);
    const manifest = path.join(installed, "app", "native-host.json"),
      m = JSON.parse(fs.readFileSync(manifest, "utf8"));
    assert.equal(
      m.allowed_origins[0],
      "chrome-extension://bmkagaljfnifdpdchjkbgehfijgecmap/",
    );
    assert.ok(fs.existsSync(m.path));
    const setupConfig=JSON.parse(fs.readFileSync(path.join(installed,"data","config.json"),"utf8")),
      installedCode=fs.readFileSync(path.join(installed,"app","figma-plugin","code.js"),"utf8"),
      sharedCode=fs.readFileSync(path.join(release,"figma-plugin","code.js"),"utf8");
    assert.match(setupConfig.pairingToken,/^[a-f0-9]{64}$/);
    assert.ok(installedCode.includes(setupConfig.pairingToken),"Setup did not provision the receiver");
    assert.ok(!installedCode.includes("__STF_INSTALL_TOKEN__"));
    assert.ok(sharedCode.includes("__STF_INSTALL_TOKEN__"),"Shared package contains credentials");
    assert.ok(!sharedCode.includes(setupConfig.pairingToken));
    assert.ok(
      fs.existsSync(path.join(installed, "app", "extension", "setup.html")),
    );
    for (const browser of ["Google\\Chrome", "Microsoft\\Edge"]) {
      const r = cp.spawnSync(
        "reg.exe",
        [
          "query",
          "HKCU\\Software\\" +
            browser +
            "\\NativeMessagingHosts\\com.sendtofigma.bridge",
          "/ve",
          "/reg:64",
        ],
        { encoding: "utf8" },
      );
      assert.equal(r.status, 0);
      assert.ok(r.stdout.includes(manifest));
    }
    native = cp.spawn(m.path, [], {
      env,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    const body = Buffer.from(
        JSON.stringify({
          requestId: "install-smoke",
          type: "status",
          data: {},
        }),
      ),
      header = Buffer.alloc(4);
    header.writeUInt32LE(body.length);
    native.stdin.write(Buffer.concat([header, body]));
    const reply = await new Promise((resolve, reject) => {
      let buffer = Buffer.alloc(0);
      const timer = setTimeout(
        () => reject(Error("Native registration smoke timed out")),
        20000,
      );
      native.once("error", reject);
      native.stdout.on("data", (chunk) => {
        buffer = Buffer.concat([buffer, chunk]);
        if (buffer.length >= 4 && buffer.length >= 4 + buffer.readUInt32LE(0)) {
          clearTimeout(timer);
          try {
            resolve(
              JSON.parse(
                buffer.subarray(4, 4 + buffer.readUInt32LE(0)).toString(),
              ),
            );
          } catch (e) {
            reject(e);
          }
        }
      });
    });
    assert.equal(reply.ok, true, reply.error);
    assert.equal(reply.data.version, version);
    assert.equal(reply.data.pending, 0);
    assert.equal(reply.data.pairingToken, setupConfig.pairingToken);
    serverPID = Number(
      (await (await fetch("http://127.0.0.1:47821/health")).json()).pid,
    );
    assert.ok(serverPID > 0);
    native.stdin.end();
    await new Promise((r) => native.once("exit", r));
    native = null;
    const config = fs.readFileSync(
      path.join(installed, "data", "config.json"),
      "utf8",
    );
    run(["--silent"]);
    assert.equal(
      fs.readFileSync(path.join(installed, "data", "config.json"), "utf8"),
      config,
      "update changed pairing data",
    );
    run(["--uninstall", "--silent"]);
    assert.ok(!fs.existsSync(path.join(installed, "app")));
    assert.equal(
      fs.readFileSync(path.join(installed, "data", "config.json"), "utf8"),
      config,
      "uninstall removed queue identity",
    );
    serverPID = null;
    console.log(
      "Windows install/update/uninstall, Chrome/Edge registry and native stdio smoke passed. Browser extension and Figma runtime were not exercised.",
    );
  } finally {
    native?.kill();
    if (serverPID)
      try {
        process.kill(serverPID);
      } catch {}
    fs.rmSync(temp, { recursive: true, force: true });
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
