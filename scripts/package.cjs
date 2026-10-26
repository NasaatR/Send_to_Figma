const fs = require("node:fs"),
  path = require("node:path"),
  crypto = require("node:crypto");
const { zipSync, unzipSync } = require("fflate");
const root = path.resolve(__dirname, ".."),
  version = require("../package.json").version,
  name = "Send-to-Figma-" + version,
  base = path.join(root, "release", name),
  entries = {};
if (!fs.existsSync(path.join(base, "Setup.exe")))
  throw Error("Build the Windows release first");
function walk(dir) {
  for (const e of fs
    .readdirSync(dir, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name, "en"))) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else {
      const key = name + "/" + path.relative(base, p).split(path.sep).join("/");
      if (
        /(?:^|\/)(?:node_modules|\.build|data)(?:\/|$)/.test(key) ||
        /\.syso$/.test(key)
      )
        throw Error("Unexpected artifact " + key);
      entries[key] = [
        new Uint8Array(fs.readFileSync(p)),
        { mtime: new Date("2000-01-01T00:00:00Z") },
      ];
    }
  }
}
walk(base);
const bytes = zipSync(entries, { level: 6 }),
  verified = unzipSync(bytes);
if (Object.keys(verified).length !== Object.keys(entries).length)
  throw Error("Archive verification failed");
for (const [name, [original]] of Object.entries(entries)) {
  if (!Buffer.from(verified[name]).equals(Buffer.from(original)))
    throw Error("Archive mismatch " + name);
}
const dir = path.join(root, "dist");
fs.mkdirSync(dir, { recursive: true });
const filename = name + "-Windows.zip",
  file = path.join(dir, filename);
fs.writeFileSync(file, bytes);
const hash = crypto.createHash("sha256").update(bytes).digest("hex");
fs.writeFileSync(file + ".sha256", hash + "  " + filename + "\n");
console.log(
  filename,
  bytes.length,
  "bytes",
  Object.keys(entries).length,
  "files; SHA256",
  hash,
);
