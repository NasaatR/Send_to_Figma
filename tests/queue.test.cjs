const test = require("node:test"),
  assert = require("node:assert/strict"),
  Q = require("../extension/queue-core.js");
const jobs = [
  {
    id: "one",
    sequence: 1,
    title: "Портрет",
    status: "ready",
    size: 10,
    targetLabel: "File A",
  },
  { id: "two", sequence: 2, title: "Landscape", status: "failed", size: 10 },
  { id: "three", sequence: 3, title: "No source", status: "failed", size: 0 },
  { id: "four", sequence: 4, title: "Done", status: "done" },
  { id: "five", sequence: 5, title: "Busy", status: "inflight" },
];
test("queue filters find Cyrillic titles, frozen destinations and active work", () => {
  assert.deepEqual(
    Q.filter(jobs, "active").map((j) => j.id),
    ["one", "five"],
  );
  assert.equal(Q.filter(jobs, "all", "порт")[0].id, "one");
  assert.equal(Q.filter(jobs, "all", "file a")[0].id, "one");
  assert.equal(Q.filter(jobs, "history")[0].id, "four");
  assert.deepEqual(Q.retryIDs(jobs), ["two"]);
  assert.deepEqual(Q.cancelIDs(jobs), ["one", "two", "three"]);
});
test("preview URLs are bounded and source actions reject executable schemes", () => {
  assert.equal(Q.preview("https://example.com/image.png"), "");
  assert.equal(Q.preview("data:image/svg+xml;base64,PHN2Zz4="), "");
  assert.equal(Q.preview("data:image/jpeg;base64," + "A".repeat(17000)), "");
  assert.equal(
    Q.preview("data:image/png;base64,AQ=="),
    "data:image/png;base64,AQ==",
  );
  assert.equal(Q.source("javascript:alert(1)"), "");
  assert.equal(
    Q.source("https://user:secret@example.com/path?token=a#secret"),
    "https://example.com/path",
  );
});
