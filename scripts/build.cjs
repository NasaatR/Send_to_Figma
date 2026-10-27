const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const cp = require("node:child_process");
const esbuild = require("esbuild");
const root = path.resolve(__dirname, "..");
const version = require("../package.json").version;
if (!/^\d+\.\d+\.\d+$/.test(version)) throw Error("Invalid release version");
const out = path.join(root, "release", "Send-to-Figma-" + version);
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
const build = path.join(root, ".build");
fs.mkdirSync(build, { recursive: true });
const go = process.env.STF_GO || "go";
function run(command, args, cwd = root, extra = {}) {
  const r = cp.spawnSync(command, args, {
    cwd,
    env: { ...process.env, CGO_ENABLED: "0", ...extra },
    stdio: "inherit",
  });
  if (r.error) throw r.error;
  if (r.status !== 0) throw Error(command + " exited " + r.status);
}
function copy(from, to = from) {
  fs.cpSync(path.join(root, from), path.join(out, to), {
    recursive: true,
    filter: (p) => !p.endsWith(".syso") && !p.endsWith("go-env.sh"),
  });
}
function read(file) {
  return fs.readFileSync(path.join(root, file), "utf8");
}
const css = read("shared/ui.css"),
  core = read("plugin/core.js");
copy("extension");
copy("shared/icons.js", "extension/icons.js");
copy("shared/diagnostics.js", "extension/diagnostics.js");
fs.writeFileSync(path.join(out, "extension/ui.css"), css);
for (const name of ["popup.html", "setup.html"]) {
  const p = path.join(out, "extension", name);
  fs.writeFileSync(
    p,
    fs.readFileSync(p, "utf8").replaceAll("__VERSION__", version),
  );
}
const manifest = JSON.parse(read("extension/manifest.json"));
manifest.version = version;
if (!manifest.key) throw Error("Extension public key missing");
const extensionId = [
  ...crypto
    .createHash("sha256")
    .update(Buffer.from(manifest.key, "base64"))
    .digest("hex")
    .slice(0, 32),
]
  .map((x) => String.fromCharCode(97 + parseInt(x, 16)))
  .join("");
if (extensionId !== read("extension-id.txt").trim())
  throw Error("Extension ID changed; update registration deliberately");
fs.writeFileSync(
  path.join(out, "extension/manifest.json"),
  JSON.stringify(manifest, null, 2) + "\n",
);
copy("extension-id.txt");
const plugin = path.join(out, "figma-plugin");
fs.mkdirSync(plugin, { recursive: true });
fs.writeFileSync(
  path.join(plugin, "ui.html"),
  read("plugin/ui.html")
    .replace("/*__SHARED_CSS__*/", css)
    .replace("/*__DIAGNOSTICS_JS__*/", read("shared/diagnostics.js"))
    .replace("/*__CORE_JS__*/", core)
    .replace("/*__UI_JS__*/", read("plugin/ui.js"))
    .replaceAll("__VERSION__", version),
);
// Main plugin code runs in Figma's sandbox, not the Chromium iframe.
fs.writeFileSync(
  path.join(plugin, "code.js"),
  esbuild.transformSync(core + "\n" + read("plugin/main.js"), {
    target: "es2017",
    format: "iife",
    charset: "utf8",
    legalComments: "inline",
  }).code,
);
fs.writeFileSync(
  path.join(plugin, "manifest.json"),
  JSON.stringify(
    {
      name: "Send to Figma · Receiver",
      id: "send-to-figma-local",
      api: "1.0.0",
      main: "code.js",
      ui: "ui.html",
      editorType: ["figma"],
      documentAccess: "dynamic-page",
      relaunchButtons: [{ command: "open", name: "Открыть приёмник" }],
      networkAccess: {
        allowedDomains: ["ws://localhost:47821"],
        reasoning:
          "Receives user-selected images from the local Send to Figma helper on this computer.",
      },
    },
    null,
    2,
  ) + "\n",
);
function resource(dir, arch, description, filename) {
  const [Major, Minor, Patch] = version.split(".").map(Number),
    v = { Major, Minor, Patch, Build: 0 };
  const info = {
    FixedFileInfo: {
      FileVersion: v,
      ProductVersion: v,
      FileFlagsMask: "3f",
      FileFlags: "00",
      FileOS: "040004",
      FileType: "01",
    },
    StringFileInfo: {
      CompanyName: "NasaatR",
      FileDescription: description,
      FileVersion: version,
      InternalName: filename,
      OriginalFilename: filename,
      ProductName: "Send to Figma",
      ProductVersion: version,
      Comments: "Made by Nasaat",
    },
    VarFileInfo: { Translation: { LangID: "0409", CharsetID: "04B0" } },
  };
  const config = path.join(build, "versioninfo.json");
  fs.writeFileSync(config, JSON.stringify(info));
  run(go, [
    "run",
    "github.com/josephspurrier/goversioninfo/cmd/goversioninfo@v1.7.0",
    "-64=" + String(arch !== "386"),
    ...(arch === "arm64" ? ["-arm"] : []),
    "-manifest",
    path.join(root, "scripts/windows.manifest"),
    "-o",
    path.join(root, dir, "resource_windows_" + arch + ".syso"),
    config,
  ]);
}
for (const arch of ["amd64", "arm64"]) {
  const folder = path.join(out, "windows", arch);
  fs.mkdirSync(folder, { recursive: true });
  resource(
    "bridge",
    arch,
    "Send to Figma local helper",
    "send-to-figma-bridge.exe",
  );
  run(
    go,
    [
      "build",
      "-buildvcs=false",
      "-mod=vendor",
      "-trimpath",
      "-ldflags=-s -w -H=windowsgui -X main.version=" + version,
      "-o",
      path.join(folder, "send-to-figma-bridge.exe"),
      ".",
    ],
    path.join(root, "bridge"),
    { GOOS: "windows", GOARCH: arch },
  );
}
// The small x86 setup runs on Windows x64 and on Windows ARM's x86 emulation.
// The actual long-running helper is selected for the native architecture.
resource("installer", "386", "Send to Figma Setup", "Setup.exe");
run(
  go,
  [
    "build",
    "-buildvcs=false",
    "-trimpath",
    "-ldflags=-s -w -H=windowsgui -X main.version=" + version,
    "-o",
    path.join(out, "Setup.exe"),
    ".",
  ],
  path.join(root, "installer"),
  { GOOS: "windows", GOARCH: "386" },
);
if (process.platform !== "win32")
  run(
    go,
    [
      "build",
      "-buildvcs=false",
      "-mod=vendor",
      "-trimpath",
      "-ldflags=-X main.version=" + version,
      "-o",
      path.join(build, "send-to-figma-bridge"),
      ".",
    ],
    path.join(root, "bridge"),
    {
      GOOS: process.platform === "darwin" ? "darwin" : "linux",
      GOARCH: process.arch === "arm64" ? "arm64" : "amd64",
    },
  );
const files = [
  "README.md",
  "README.ru.md",
  "START-HERE.txt",
  "TESTING.md",
  "CHANGELOG.md",
  "LICENSE",
  "THIRD-PARTY-NOTICES.txt",
];
for (const file of files) copy(file);
const hashes = {};
function walk(dir, fn) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, fn);
    else fn(p);
  }
}
for (const folder of ["extension", "figma-plugin", "windows"])
  walk(
    path.join(out, folder),
    (p) =>
      (hashes[path.relative(out, p).split(path.sep).join("/")] = crypto
        .createHash("sha256")
        .update(fs.readFileSync(p))
        .digest("hex")),
  );
fs.writeFileSync(
  path.join(out, "payload-sha256.json"),
  JSON.stringify(hashes, null, 2) + "\n",
);
for (const dir of [
  "bridge",
  "installer",
  "extension",
  "plugin",
  "shared",
  "scripts",
  "tests",
  "docs",
  ".github",
])
  copy(dir, "source/" + dir);
for (const f of [
  ...files,
  "package.json",
  "package-lock.json",
  "extension-id.txt",
  ".gitignore",
  "AGENTS.md",
])
  copy(f, "source/" + f);
const sums = [];
walk(out, (p) => {
  if (path.basename(p) !== "SHA256SUMS.txt")
    sums.push(
      crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex") +
        "  " +
        path.relative(out, p).split(path.sep).join("/"),
    );
});
fs.writeFileSync(
  path.join(out, "SHA256SUMS.txt"),
  sums.sort().join("\n") + "\n",
);
console.log("Release:", out, "\nExtension ID:", extensionId);
