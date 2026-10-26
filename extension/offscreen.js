(function () {
  "use strict";
  function mime(bytes) {
    if (
      bytes[0] === 137 &&
      bytes[1] === 80 &&
      bytes[2] === 78 &&
      bytes[3] === 71
    )
      return "image/png";
    if (bytes[0] === 255 && bytes[1] === 216) return "image/jpeg";
    if (bytes[0] === 71 && bytes[1] === 73 && bytes[2] === 70)
      return "image/gif";
    return "";
  }
  async function image(blob) {
    const url = URL.createObjectURL(blob),
      img = new Image();
    img.src = url;
    try {
      await img.decode();
      return img;
    } finally {
      URL.revokeObjectURL(url);
    }
  }
  let normalizationTail = Promise.resolve();
  async function makePreview(decoded, source) {
    try {
      const scale = Math.min(128 / source.width, 128 / source.height, 1),
        canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(source.width * scale));
      canvas.height = Math.max(1, Math.round(source.height * scale));
      const ctx = canvas.getContext("2d");
      if (!ctx) return "";
      ctx.fillStyle = "#f0f0f2";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(
        decoded,
        source.x,
        source.y,
        source.width,
        source.height,
        0,
        0,
        canvas.width,
        canvas.height,
      );
      const blob = await new Promise((resolve) =>
        canvas.toBlob(resolve, "image/jpeg", 0.72),
      );
      if (!blob || blob.size > 12 * 1024) return "";
      return (
        "data:image/jpeg;base64," +
        STFCapture.toBase64(new Uint8Array(await blob.arrayBuffer()))
      );
    } catch {
      return "";
    }
  }
  async function normalize(m) {
    let bytes = STFCapture.fromBase64(m.data);
    if (!bytes.length || bytes.length > 20 * 1024 * 1024)
      throw Error("Изображение пустое или больше 20 МБ");
    const recognized = mime(bytes),
      hint = String(m.mime || "").split(";")[0];
    let decodeMime = recognized || hint || "application/octet-stream";
    // Preserve local paint/style resources; unsupported external rendering falls back to an explicit screenshot.
    if (
      hint === "image/svg+xml" ||
      new TextDecoder()
        .decode(bytes.slice(0, 200))
        .trim()
        .match(/^(?:<\?xml[^>]*>\s*)?<svg\b/i)
    ) {
      const svg = new DOMParser().parseFromString(
        new TextDecoder().decode(bytes),
        "image/svg+xml",
      );
      if (svg.querySelector("parsererror")) throw Error("Некорректный SVG");
      if (svg.querySelector("foreignObject,iframe,object,embed"))
        throw Error("SVG содержит встроенный HTML. Используйте захват области");
      function externalPaint(value) {
        if (/@import\b/i.test(value)) return true;
        const urls = value.matchAll(
          /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\s*\)/gi,
        );
        for (const u of urls) {
          const ref = (u[1] ?? u[2] ?? u[3] ?? "").trim();
          if (
            !ref.startsWith("#") &&
            !/^data:image\/(?:png|jpe?g|gif|webp|avif);base64,/i.test(ref)
          )
            return true;
        }
        return false;
      }
      for (const n of svg.querySelectorAll("script")) n.remove();
      for (const n of svg.querySelectorAll("style"))
        if (externalPaint(n.textContent))
          throw Error(
            "SVG использует внешние ресурсы. Используйте захват области",
          );
      for (const n of svg.querySelectorAll("*"))
        for (const a of [...n.attributes]) {
          if (/^on/i.test(a.name)) {
            n.removeAttribute(a.name);
            continue;
          }
          if (
            /href$/i.test(a.name) &&
            a.value &&
            !a.value.startsWith("#") &&
            !/^data:image\/(?:png|jpe?g|gif|webp|avif);base64,/i.test(a.value)
          ) {
            if (n.localName === "a") n.removeAttribute(a.name);
            else
              throw Error(
                "SVG использует внешние ресурсы. Используйте захват области",
              );
          }
          if (externalPaint(a.value))
            throw Error(
              "SVG использует внешние ресурсы. Используйте захват области",
            );
        }
      bytes = new TextEncoder().encode(
        new XMLSerializer().serializeToString(svg.documentElement),
      );
      decodeMime = "image/svg+xml";
    }
    const decoded = await image(new Blob([bytes], { type: decodeMime }));
    let width = decoded.naturalWidth,
      height = decoded.naturalHeight;
    if (width * height > 80 * 1024 * 1024)
      throw Error("Изображение слишком большое для безопасного декодирования");
    let source = { x: 0, y: 0, width, height };
    if (m.crop) {
      const visible = STFCapture.visibleRect(m.crop.rect, m.crop.viewport);
      if (!visible) throw Error("Область не видна на экране");
      const sx = width / m.crop.viewport.width,
        sy = height / m.crop.viewport.height;
      source = {
        x: visible.x * sx,
        y: visible.y * sy,
        width: visible.width * sx,
        height: visible.height * sy,
      };
    }
    const preview = await makePreview(decoded, source);
    const fitted = STFCapture.fitSize(source.width, source.height);
    width = fitted.width;
    height = fitted.height;
    if (!m.crop && !fitted.resized && recognized)
      return {
        data: STFCapture.toBase64(bytes),
        preview,
        mime: recognized,
        width,
        height,
        captureMode: "original",
      };
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw Error("Не удалось подготовить изображение");
    ctx.drawImage(
      decoded,
      source.x,
      source.y,
      source.width,
      source.height,
      0,
      0,
      width,
      height,
    );
    const blob = await new Promise((resolve) =>
      canvas.toBlob(resolve, "image/png"),
    );
    if (!blob) throw Error("Не удалось преобразовать изображение");
    if (blob.size > 20 * 1024 * 1024)
      throw Error("После преобразования изображение больше 20 МБ");
    const result = new Uint8Array(await blob.arrayBuffer());
    return {
      data: STFCapture.toBase64(result),
      preview,
      mime: "image/png",
      width,
      height,
      captureMode: m.crop ? "screen" : fitted.resized ? "resized" : "converted",
    };
  }
  chrome.runtime.onMessage.addListener((m, sender, reply) => {
    if (
      sender.id !== chrome.runtime.id ||
      m?.destination !== "offscreen" ||
      m.type !== "normalize"
    )
      return;
    const task = normalizationTail.then(() => normalize(m));
    normalizationTail = task.catch(() => {});
    task.then(
      (data) => reply({ ok: true, ...data }),
      (e) =>
        reply({
          ok: false,
          error: e.message || "Не удалось прочитать изображение",
        }),
    );
    return true;
  });
})();
