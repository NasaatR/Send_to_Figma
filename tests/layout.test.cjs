const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const modulePath = path.join(__dirname, "../plugin/core.js");
function core() {
  return require(modulePath);
}
test("append preserves proportions and uses hand-derived positions", () => {
  const c = core();
  const layout = c.normalizeLayout({
    columns: 2,
    width: 200,
    gap: 20,
    padding: 10,
    maxHeight: 300,
    captions: false,
  });
  const first = c.appendSlot([], { width: 400, height: 200 }, layout);
  assert.deepEqual(first, {
    x: 10,
    y: 10,
    width: 200,
    height: 100,
    imageX: 0,
    imageWidth: 200,
    imageHeight: 100,
  });
  const second = c.appendSlot(
    [{ x: 10, y: 10, width: 200, height: 100 }],
    { width: 100, height: 200 },
    layout,
  );
  assert.deepEqual(second, {
    x: 230,
    y: 10,
    width: 200,
    height: 300,
    imageX: 25,
    imageWidth: 150,
    imageHeight: 300,
  });
  const third = c.appendSlot(
    [
      { x: 10, y: 10, width: 200, height: 100 },
      { x: 230, y: 10, width: 200, height: 300 },
    ],
    { width: 400, height: 200 },
    layout,
  );
  assert.equal(third.x, 10);
  assert.equal(third.y, 330);
});
test("a changed grid begins below existing cards without relocating them", () => {
  const c = core(),
    cards = [
      { x: 24, y: 24, width: 320, height: 160 },
      { x: 368, y: 24, width: 320, height: 160 },
    ];
  const slot = c.appendSlot(
    cards,
    { width: 200, height: 100 },
    c.normalizeLayout({ columns: 3, width: 200, gap: 20, padding: 10 }),
  );
  assert.equal(slot.x, 10);
  assert.equal(slot.y, 204);
  assert.deepEqual(cards[0], { x: 24, y: 24, width: 320, height: 160 });
});
test("the next card continues the new row after a layout change", () => {
  const c = core(),
    layout = c.normalizeLayout({
      columns: 3,
      width: 200,
      gap: 20,
      padding: 10,
    }),
    cards = [
      { x: 24, y: 24, width: 320, height: 160 },
      { x: 368, y: 24, width: 320, height: 160 },
    ];
  const first = c.appendSlot(cards, { width: 200, height: 100 }, layout);
  cards.push({ ...first, layoutKey: "3:200:20:10:480:0" });
  const second = c.appendSlot(cards, { width: 200, height: 100 }, layout);
  assert.deepEqual([second.x, second.y], [230, 204]);
});
test("append avoids manually moved cards while preserving their coordinates", () => {
  const c = core(),
    cards = [
      {
        x: 712,
        y: 24,
        width: 320,
        height: 160,
        layoutKey: "4:320:24:24:480:0",
      },
      {
        x: 368,
        y: 24,
        width: 320,
        height: 160,
        layoutKey: "4:320:24:24:480:0",
      },
    ];
  const next = c.appendSlot(
    cards,
    { width: 400, height: 200 },
    c.normalizeLayout({}),
  );
  assert.deepEqual([next.x, next.y], [24, 208]);
  assert.equal(cards[0].x, 712);
});
test("invalid settings recover to safe defaults while supported values remain", () => {
  const c = core(),
    v = c.normalizeLayout({
      columns: 0,
      width: -1,
      gap: Infinity,
      padding: "oops",
      maxHeight: 200000,
      radius: -10,
      captions: "false",
      injected: "x",
    });
  assert.equal(v.columns, 4);
  assert.equal(v.width, 320);
  assert.equal(v.gap, 24);
  assert.equal(v.padding, 24);
  assert.equal(v.maxHeight, 480);
  assert.equal(v.radius, 8);
  assert.equal(v.captions, false);
  assert.equal("injected" in v, false);
  assert.equal(
    c.normalizeLayout({
      columns: 1,
      width: 120,
      gap: 0,
      padding: 0,
      radius: 0,
      captions: true,
    }).captions,
    true,
  );
});
test("reflow produces ordered rows and never modifies input cards", () => {
  const c = core(),
    cards = [
      { width: 400, height: 200 },
      { width: 100, height: 100 },
      { width: 100, height: 300 },
    ];
  const slots = c.reflow(
    cards,
    c.normalizeLayout({
      columns: 2,
      width: 200,
      maxHeight: 300,
      gap: 20,
      padding: 10,
    }),
  );
  assert.deepEqual(
    slots.map((s) => [s.x, s.y, s.width, s.height]),
    [
      [10, 10, 200, 100],
      [230, 10, 200, 200],
      [10, 230, 200, 300],
    ],
  );
  assert.deepEqual(cards, [
    { width: 400, height: 200 },
    { width: 100, height: 100 },
    { width: 100, height: 300 },
  ]);
});
