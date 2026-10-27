(function () {
  "use strict";
  if (globalThis.__stfContentInstalled) return;
  globalThis.__stfContentInstalled = true;
  let last = null,
    selectionCleanup = null,
    feedbackHost = null,
    feedbackTimer = null;
  function feedback(message, kind) {
    clearTimeout(feedbackTimer);
    if (feedbackHost) feedbackHost.remove();
    if (!message) return;
    const host = document.createElement("div");
    host.style.cssText = "position:fixed;bottom:20px;right:20px;z-index:2147483647;max-width:min(380px,calc(100vw - 40px));pointer-events:none";
    host.setAttribute("data-stf-feedback", "");
    const shadow = host.attachShadow({mode:"closed"});
    const box = document.createElement("div");
    box.setAttribute("role", "status");
    box.style.cssText = "font:13px/1.45 Segoe UI,Arial,sans-serif;padding:12px 16px;border-radius:10px;border:1px solid #ffffff30;background:#242427;color:#fff;box-shadow:0 8px 28px #0003;overflow-wrap:anywhere";
    if (kind === "error") box.style.borderColor = "#e87f76";
    if (kind === "done") box.style.borderColor = "#72bd94";
    box.textContent = "Send to Figma · " + String(message).slice(0,350);
    shadow.append(box);
    document.documentElement.append(host);
    feedbackHost = host;
    feedbackTimer = setTimeout(() => { host.remove(); if (feedbackHost === host) feedbackHost = null; }, kind === "error" ? 9000 : 5000);
  }
  function context(event) {
    const path = event.composedPath();
    let el =
      path.find((n) => n instanceof HTMLImageElement) ||
      path.find((n) => n instanceof Element);
    if (!el) return;
    let source = "",
      title = "",
      kind = "area";
    if (el instanceof HTMLImageElement) {
      source = el.currentSrc || el.src;
      title = el.alt;
      kind = "image";
    } else {
      for (
        let candidate = el, depth = 0;
        candidate && depth < 5;
        candidate = candidate.parentElement, depth++
      ) {
        const bg = getComputedStyle(candidate).backgroundImage;
        const m = bg.match(/^url\(["']?(.*?)["']?\)$/);
        if (m) {
          el = candidate;
          source = m[1];
          kind = "background";
          break;
        }
      }
    }
    const r = el.getBoundingClientRect();
    last = {
      source,
      title: title || document.title || "Изображение",
      kind,
      rect: { x: r.x, y: r.y, width: r.width, height: r.height },
      viewport: { width: innerWidth, height: innerHeight },
      pageUrl: location.href,
    };
    chrome.runtime
      .sendMessage({ type: "context-target", target: last })
      .catch(() => {});
  }
  document.addEventListener("contextmenu", context, true);
  function base64(bytes) {
    let out = "";
    for (let i = 0; i < bytes.length; i += 32768)
      out += String.fromCharCode(...bytes.subarray(i, i + 32768));
    return btoa(out);
  }
  async function pageFetch(url) {
    if (
      typeof url !== "string" ||
      !["http:", "https:", "blob:", "data:"].some((p) => url.startsWith(p))
    )
      throw Error("Источник не поддерживается");
    const controller = new AbortController(),
      timer = setTimeout(() => controller.abort(), 15000);
    try {
      const r = await fetch(url, {
        credentials: "include",
        signal: controller.signal,
      });
      if (!r.ok) throw Error("Источник недоступен");
      const length = Number(r.headers.get("content-length"));
      if (length > 20 * 1024 * 1024) throw Error("Изображение больше 20 МБ");
      const reader = r.body.getReader(),
        parts = [];
      let size = 0;
      for (;;) {
        const p = await reader.read();
        if (p.done) break;
        size += p.value.length;
        if (size > 20 * 1024 * 1024) {
          await reader.cancel();
          throw Error("Изображение больше 20 МБ");
        }
        parts.push(p.value);
      }
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const p of parts) {
        bytes.set(p, offset);
        offset += p.length;
      }
      return {
        data: base64(bytes),
        mime: r.headers.get("content-type") || "application/octet-stream",
      };
    } finally {
      clearTimeout(timer);
    }
  }
  function chooseArea() {
    if (selectionCleanup) selectionCleanup();
    return new Promise((resolve, reject) => {
      const host = document.createElement("div");
      host.setAttribute("data-stf-area", "");
      host.style.cssText = "position:fixed;inset:0;z-index:2147483647;";
      const shadow = host.attachShadow({ mode: "closed" });
      shadow.innerHTML =
        '<style>:host{all:initial}.veil{position:absolute;inset:0;cursor:crosshair;background:rgba(0,0,0,.13);touch-action:none}.hint{position:absolute;top:18px;left:50%;transform:translateX(-50%);font:13px/1.4 Segoe UI,Arial,sans-serif;color:white;background:#202023;border:1px solid #ffffff35;border-radius:12px;padding:10px 15px;pointer-events:none}.box{position:absolute;display:none;border:2px solid white;box-shadow:0 0 0 1px #202023;background:transparent;pointer-events:none}</style><div class="veil"><div class="hint">Выделите область для Figma · Esc — отмена</div><div class="box"></div></div>';
      document.documentElement.append(host);
      const veil = shadow.querySelector(".veil"),
        box = shadow.querySelector(".box");
      let start = null,
        rect = null,
        settled = false;
      const timeout = setTimeout(
        () => finish(null, Error("Выделение отменено по тайм-ауту")),
        60000,
      );
      function cleanup() {
        clearTimeout(timeout);
        host.remove();
        document.removeEventListener("keydown", key, true);
        selectionCleanup = null;
      }
      function finish(value, err) {
        if (settled) return;
        settled = true;
        cleanup();
        if (err) reject(err);
        else
          requestAnimationFrame(() =>
            requestAnimationFrame(() =>
              resolve({
                rect: value,
                viewport: { width: innerWidth, height: innerHeight },
                pageUrl: location.href,
                title: document.title || "Область экрана",
              }),
            ),
          );
      }
      function key(e) {
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopImmediatePropagation();
          finish(null, Error("Выделение отменено"));
        }
      }
      document.addEventListener("keydown", key, true);
      selectionCleanup = () => finish(null, Error("Выделение отменено"));
      veil.onpointerdown = (e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        start = { x: e.clientX, y: e.clientY };
        veil.setPointerCapture(e.pointerId);
      };
      veil.onpointermove = (e) => {
        if (!start) return;
        rect = {
          x: Math.min(start.x, e.clientX),
          y: Math.min(start.y, e.clientY),
          width: Math.abs(start.x - e.clientX),
          height: Math.abs(start.y - e.clientY),
        };
        box.style.cssText = `display:block;left:${rect.x}px;top:${rect.y}px;width:${rect.width}px;height:${rect.height}px`;
      };
      veil.onpointerup = (e) => {
        if (!start) return;
        e.preventDefault();
        if (!rect || rect.width < 3 || rect.height < 3) {
          start = null;
          box.style.display = "none";
          return;
        }
        finish(rect);
      };
    });
  }
  chrome.runtime.onMessage.addListener((m, sender, reply) => {
    if (sender.id !== chrome.runtime.id) return;
    switch (m?.type) {
      case "capture-feedback":
        feedback(m.message, m.kind);
        reply({ok:true});
        return;
      case "get-context":
        reply({ ok: true, target: last });
        return;
      case "page-fetch":
        pageFetch(m.url).then(
          (v) => reply({ ok: true, ...v }),
          (e) => reply({ ok: false, error: e.message }),
        );
        return true;
      case "choose-area":
        chooseArea().then(
          (v) => reply({ ok: true, ...v }),
          (e) => reply({ ok: false, error: e.message }),
        );
        return true;
    }
  });
})();
