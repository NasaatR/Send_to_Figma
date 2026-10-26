var STFCapture = (function () {
  "use strict";
  function fitSize(width, height) {
    if (
      !Number.isFinite(width) ||
      !Number.isFinite(height) ||
      width <= 0 ||
      height <= 0
    )
      throw Error("Некорректный размер изображения");
    const scale = Math.min(1, 4096 / width, 4096 / height);
    return {
      width: Math.max(1, Math.round(width * scale)),
      height: Math.max(1, Math.round(height * scale)),
      resized: scale < 1,
    };
  }
  function visibleRect(rect, viewport) {
    if (!rect || !viewport) return null;
    const x = Math.max(0, rect.x),
      y = Math.max(0, rect.y),
      right = Math.min(viewport.width, rect.x + rect.width),
      bottom = Math.min(viewport.height, rect.y + rect.height);
    if (
      ![x, y, right, bottom].every(Number.isFinite) ||
      right - x < 2 ||
      bottom - y < 2
    )
      return null;
    return { x, y, width: right - x, height: bottom - y };
  }
  function toBase64(bytes) {
    let out = "";
    for (let i = 0; i < bytes.length; i += 0x8000)
      out += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(out);
  }
  function fromBase64(s) {
    if (typeof s !== "string" || s.length > 28 * 1024 * 1024)
      throw Error("Изображение слишком большое");
    const raw = atob(s),
      bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
    return bytes;
  }
  return { fitSize, visibleRect, toBase64, fromBase64 };
})();
if (typeof module === "object" && module.exports) module.exports = STFCapture;
