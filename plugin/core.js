/* Shared deterministic layout, used by the plugin and its tests. */
var STFCore = (function () {
  "use strict";
  const defaults = Object.freeze({
    columns: 4,
    width: 320,
    gap: 24,
    padding: 24,
    maxHeight: 480,
    radius: 8,
    captions: false,
  });
  const appearanceDefaults = Object.freeze({
    theme: "system",
    density: "compact",
  });
  function bounded(value, min, max, fallback) {
    return typeof value === "number" &&
      Number.isFinite(value) &&
      value >= min &&
      value <= max
      ? Math.round(value)
      : fallback;
  }
  function normalizeLayout(input) {
    const v = input && typeof input === "object" ? input : {};
    return {
      columns: bounded(v.columns, 1, 8, 4),
      width: bounded(v.width, 120, 800, 320),
      gap: bounded(v.gap, 0, 128, 24),
      padding: bounded(v.padding, 0, 128, 24),
      maxHeight: bounded(v.maxHeight, 120, 1600, 480),
      radius: bounded(v.radius, 0, 32, 8),
      captions: typeof v.captions === "boolean" ? v.captions : false,
    };
  }
  function normalizeAppearance(input) {
    const v = input && typeof input === "object" ? input : {};
    return {
      theme: ["system", "light", "dark"].includes(v.theme) ? v.theme : "system",
      density: ["compact", "comfortable"].includes(v.density)
        ? v.density
        : "compact",
    };
  }
  function signature(l) {
    return [
      l.columns,
      l.width,
      l.gap,
      l.padding,
      l.maxHeight,
      l.captions ? 1 : 0,
    ].join(":");
  }
  function fit(dim, l) {
    if (
      !Number.isFinite(dim.width) ||
      !Number.isFinite(dim.height) ||
      dim.width <= 0 ||
      dim.height <= 0
    )
      throw Error("Некорректные размеры изображения");
    const scale = Math.min(l.width / dim.width, l.maxHeight / dim.height);
    const w = Math.max(1, Math.round(dim.width * scale)),
      h = Math.max(1, Math.round(dim.height * scale));
    return {
      width: l.width,
      height: h + (l.captions ? 30 : 0),
      imageX: (l.width - w) / 2,
      imageWidth: w,
      imageHeight: h,
    };
  }
  function appendSlot(cards, dim, layout) {
    const l = normalizeLayout(layout),
      s = fit(dim, l);
    let x = l.padding,
      y = l.padding;
    if (cards.length) {
      const key = signature(l),
        last = cards[cards.length - 1];
      const same = last.layoutKey
        ? last.layoutKey === key
        : cards.every(
            (c, i) =>
              Math.abs(c.width - l.width) < 0.1 &&
              Math.abs(
                c.x - (l.padding + (i % l.columns) * (l.width + l.gap)),
              ) < 0.1,
          );
      const previousColumn = Math.round(
        (last.x - l.padding) / (l.width + l.gap),
      );
      const column = previousColumn + 1;
      if (same && column > 0 && column < l.columns) {
        x = l.padding + column * (l.width + l.gap);
        y = last.y;
      } else {
        y = Math.max(l.padding, ...cards.map((c) => c.y + c.height)) + l.gap;
      }
    }
    if (
      cards.some(
        (c) =>
          x < c.x + c.width &&
          x + s.width > c.x &&
          y < c.y + c.height &&
          y + s.height > c.y,
      )
    ) {
      x = l.padding;
      y = Math.max(l.padding, ...cards.map((c) => c.y + c.height)) + l.gap;
    }
    return { x, y, ...s };
  }
  function reflow(dimensions, layout) {
    const l = normalizeLayout(layout),
      result = [];
    for (const d of dimensions) {
      const s = appendSlot(result, d, l);
      result.push(s);
    }
    return result;
  }
  // The Figma sandbox does not expose the browser URL constructor.
  function safeURL(input) {
    const m = String(input || "").match(/^(https?):\/\/([^/?#\s]+)([^?#\s]*)/i);
    if (!m) return "";
    const authority = m[2].replace(/^.*@/, "");
    if (!authority) return "";
    return m[1].toLowerCase() + "://" + authority + (m[3] || "/");
  }
  return {
    defaults,
    appearanceDefaults,
    normalizeLayout,
    normalizeAppearance,
    signature,
    fit,
    appendSlot,
    reflow,
    safeURL,
  };
})();
if (typeof module === "object" && module.exports) module.exports = STFCore;
