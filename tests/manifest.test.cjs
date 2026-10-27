const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("shipped Figma receiver uses the permitted localhost WebSocket origin", () => {
  const root = path.join(__dirname, ".."),
    release = path.join(root, "release", "Send-to-Figma-" + require("../package.json").version, "figma-plugin"),
    manifest = JSON.parse(fs.readFileSync(path.join(release, "manifest.json"), "utf8")),
    html = fs.readFileSync(path.join(release, manifest.ui), "utf8"),
    sockets = [...html.matchAll(/new WebSocket\("([^"]+)"\)/g)];
  assert.equal(sockets.length, 1, "Check the actual emitted receiver connection");
  const endpoint = new URL(sockets[0][1]);
  assert.equal(endpoint.protocol, "ws:");
  assert.equal(endpoint.hostname, "localhost", "Figma rejects IP literals during manifest import");
  assert.equal(endpoint.port, "47821");
  assert.equal(endpoint.pathname, "/receiver");
  assert.deepEqual(manifest.networkAccess.allowedDomains, [endpoint.origin]);
  assert.ok(manifest.networkAccess.reasoning.trim());
  assert.equal(manifest.documentAccess, "dynamic-page");
  for (const file of [manifest.main, manifest.ui])
    assert.ok(fs.statSync(path.join(release, file)).isFile());
});
