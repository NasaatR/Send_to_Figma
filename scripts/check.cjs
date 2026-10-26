const fs = require("node:fs"),
  path = require("node:path"),
  cp = require("node:child_process"),
  crypto = require("node:crypto");
const root = path.resolve(__dirname, "..");
let count = 0;
for (const dir of ["extension", "plugin", "scripts"])
  for (const f of fs.readdirSync(path.join(root, dir))) {
    if (!/\.(js|cjs)$/.test(f)) continue;
    const r = cp.spawnSync(
      process.execPath,
      ["--check", path.join(root, dir, f)],
      { encoding: "utf8" },
    );
    if (r.status !== 0) throw Error(r.stderr);
    count++;
  }
const release = path.join(
  root,
  "release/Send-to-Figma-" + require("../package.json").version,
);
if (fs.existsSync(release)) {
  const m = JSON.parse(
      fs.readFileSync(path.join(release, "extension/manifest.json")),
    ),
    base = path.join(release, "extension");
  for (const file of [
    m.background.service_worker,
    m.action.default_popup,
    ...m.content_scripts.flatMap((s) => s.js),
    ...Object.values(m.icons),
  ])
    if (!fs.existsSync(path.join(base, file)))
      throw Error("Missing extension resource " + file);
  const p = JSON.parse(
    fs.readFileSync(path.join(release, "figma-plugin/manifest.json")),
  );
  for (const file of [p.main, p.ui])
    if (!fs.existsSync(path.join(release, "figma-plugin", file)))
      throw Error("Missing plugin resource " + file);
  const id = [
    ...crypto
      .createHash("sha256")
      .update(Buffer.from(m.key, "base64"))
      .digest("hex")
      .slice(0, 32),
  ]
    .map((x) => String.fromCharCode(97 + parseInt(x, 16)))
    .join("");
  if (
    fs.readFileSync(path.join(release, "extension-id.txt"), "utf8").trim() !==
    id
  )
    throw Error("Extension ID mismatch");
  const { inspect } = require("./pe.cjs");
  for (const [relative, expected] of [
    ["Setup.exe", 0x14c],
    ["windows/amd64/send-to-figma-bridge.exe", 0x8664],
    ["windows/arm64/send-to-figma-bridge.exe", 0xaa64],
  ]) {
    const pe = inspect(path.join(release, relative));
    if (pe.machine !== expected || pe.subsystem !== 2)
      throw Error("Wrong architecture/subsystem: " + relative);
    if (
      !pe.resources
        .get(24)
        ?.some((b) => b.toString("utf8").includes('level="asInvoker"'))
    )
      throw Error("Missing non-elevating manifest: " + relative);
    if (
      !pe.resources
        .get(16)
        ?.some((b) =>
          b.includes(
            Buffer.from(require("../package.json").version, "utf16le"),
          ),
        )
    )
      throw Error("Wrong executable version: " + relative);
  }
  for (const name of [
    "setup.html",
    "setup.js",
    "test-image.png",
    "popup.html",
  ]) {
    const p = path.join(base, name);
    if (!fs.existsSync(p)) throw Error("Missing onboarding asset " + name);
    if (
      name.endsWith(".html") &&
      fs.readFileSync(p, "utf8").includes("__VERSION__")
    )
      throw Error("Unexpanded version");
  }
  const payload = JSON.parse(
    fs.readFileSync(path.join(release, "payload-sha256.json"), "utf8"),
  );
  for (const [rel, want] of Object.entries(payload))
    if (
      crypto
        .createHash("sha256")
        .update(fs.readFileSync(path.join(release, rel)))
        .digest("hex") !== want
    )
      throw Error("Installer payload checksum mismatch " + rel);
  for (const line of fs
    .readFileSync(path.join(release, "SHA256SUMS.txt"), "utf8")
    .trim()
    .split("\n")) {
    const i = line.indexOf("  "),
      want = line.slice(0, i),
      file = line.slice(i + 2);
    if (
      crypto
        .createHash("sha256")
        .update(fs.readFileSync(path.join(release, file)))
        .digest("hex") !== want
    )
      throw Error("Checksum mismatch " + file);
  }
  for (const f of ["figma-plugin/ui.html", "figma-plugin/code.js"])
    if (fs.readFileSync(path.join(release, f), "utf8").includes("/*__"))
      throw Error("Unexpanded build placeholder");
  console.log(
    "Release resources, extension ID, PE architectures and checksums verified.",
  );
}
console.log("JavaScript syntax:", count, "files.");
