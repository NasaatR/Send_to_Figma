"use strict";
importScripts("native-client.js", "capture-core.js");
const native = STFNative.create(chrome),
  MENU = "send-image-to-figma",
  LIMIT = 20 * 1024 * 1024;
let offscreenCreating = null,
  reservationTail = Promise.resolve();
let captureCount = 0;
const captureWaiters = [];
function captureLane() {
  return new Promise((resolve) => {
    const enter = () => {
      captureCount++;
      let released = false;
      resolve(() => {
        if (released) return;
        released = true;
        captureCount--;
        captureWaiters.shift()?.();
      });
    };
    if (captureCount < 2) enter();
    else captureWaiters.push(enter);
  });
}
async function notify(title, message) {
  try {
    await chrome.notifications.create({
      type: "basic",
      iconUrl: "icons/128.png",
      title,
      message,
    });
  } catch {}
}
async function badge(status) {
  try {
    await chrome.action.setBadgeText({
      text: status.pending ? String(Math.min(status.pending, 99)) : "",
    });
    await chrome.action.setBadgeBackgroundColor({ color: "#202023" });
  } catch {}
}
async function ensureOffscreen() {
  if (await chrome.offscreen.hasDocument()) return;
  if (!offscreenCreating) {
    offscreenCreating = chrome.offscreen
      .createDocument({
        url: "offscreen.html",
        reasons: ["BLOBS"],
        justification:
          "Подготовка выбранных изображений и областей экрана для Figma",
      })
      .finally(() => (offscreenCreating = null));
  }
  await offscreenCreating;
}
async function normalize(input) {
  await ensureOffscreen();
  const result = await chrome.runtime.sendMessage({
    destination: "offscreen",
    type: "normalize",
    ...input,
  });
  if (!result?.ok)
    throw Error(result?.error || "Не удалось подготовить изображение");
  return result;
}
async function fetchBytes(url) {
  if (typeof url !== "string" || !/^https?:\/\//i.test(url))
    throw Error("Источник требует захвата из страницы");
  const controller = new AbortController(),
    timer = setTimeout(() => controller.abort(), 15000);
  try {
    const r = await fetch(url, {
      credentials: "include",
      signal: controller.signal,
    });
    if (!r.ok) throw Error("Источник недоступен: HTTP " + r.status);
    if (Number(r.headers.get("content-length")) > LIMIT)
      throw Error("Изображение больше 20 МБ");
    const reader = r.body.getReader(),
      parts = [];
    let size = 0;
    for (;;) {
      const p = await reader.read();
      if (p.done) break;
      size += p.value.length;
      if (size > LIMIT) {
        await reader.cancel();
        throw Error("Изображение больше 20 МБ");
      }
      parts.push(p.value);
    }
    const bytes = new Uint8Array(size);
    let at = 0;
    for (const p of parts) {
      bytes.set(p, at);
      at += p.length;
    }
    return {
      data: STFCapture.toBase64(bytes),
      mime: r.headers.get("content-type") || "application/octet-stream",
    };
  } finally {
    clearTimeout(timer);
  }
}
async function pageMessage(tabId, frameId, message) {
  return chrome.tabs.sendMessage(tabId, message, { frameId: frameId || 0 });
}
async function injectTop(tabId) {
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ["content.js"],
  });
}
async function cropScreen(tab, target) {
  await chrome.tabs.update(tab.id, { active: true });
  const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, {
    format: "png",
  });
  return normalize({
    data: dataUrl.split(",")[1],
    mime: "image/png",
    crop: { rect: target.rect, viewport: target.viewport },
  });
}
async function selectArea(tab) {
  try {
    await injectTop(tab.id);
    return await pageMessage(tab.id, 0, { type: "choose-area" });
  } catch {
    throw Error(
      "На этой странице нельзя выделить область. Откройте изображение на обычной веб-странице.",
    );
  }
}
async function uploadReliable(id, normalized) {
  let last;
  for (let i = 0; i < 3; i++) {
    try {
      return await native.call("upload", {
        id,
        data: normalized.data,
        mime: normalized.mime,
        width: normalized.width,
        height: normalized.height,
        captureMode: normalized.captureMode,
        preview: normalized.preview || "",
      });
    } catch (e) {
      last = e;
      if (
        /не установлен|установлен или|диск|сохранить|больше|размер|формат|отменено/i.test(
          e.message,
        )
      )
        throw e;
    }
  }
  throw last;
}
async function sendImage(info, tab, explicitArea = false) {
  const id = crypto.randomUUID();
  let reserved = false;
  try {
    const preparation = reservationTail.then(async () => {
      if (!tab?.id) throw Error("Не удалось определить вкладку");
      let stored = (await chrome.storage.session.get("context-" + tab.id))[
        "context-" + tab.id
      ];
      let target =
        stored && stored.frameId === (info.frameId || 0) ? stored.target : null;
      if (!target)
        try {
          const reply = await pageMessage(tab.id, info.frameId || 0, {
            type: "get-context",
          });
          target = reply?.target;
        } catch {}
      if (info.srcUrl) {
        target = {
          ...(target || {}),
          source: info.srcUrl,
          title: target?.title || tab.title || "Изображение",
          pageUrl: info.pageUrl || tab.url,
        };
      }
      target = target || {
        title: tab.title || "Область экрана",
        pageUrl: tab.url,
      };
      if (explicitArea)
        target = {
          title: tab.title || "Область экрана",
          pageUrl: tab.url,
          source: "",
        };
      const reservation = await native.call("reserve", {
        id,
        title: target.title,
        pageUrl: target.pageUrl || tab.url,
        sourceUrl: target.source || "",
        captureMode: explicitArea ? "screen" : "original",
        deferred: true,
      });
      return { target, reservation };
    });
    reservationTail = preparation.catch(() => {});
    const { target, reservation } = await preparation;
    reserved = true;
    const releaseCapture = await captureLane();
    try {
      await native.call("begin_capture", { id });
      let normalized = null;
      if (!explicitArea && target.source) {
        let input;
        try {
          input = await fetchBytes(target.source);
        } catch {
          try {
            const r = await pageMessage(tab.id, info.frameId || 0, {
              type: "page-fetch",
              url: target.source,
            });
            if (r?.ok) input = r;
          } catch {}
        }
        if (input)
          try {
            normalized = await normalize(input);
          } catch {}
      }
      if (!normalized) {
        // Screen fallback is deliberate: ask for a visible area rather than silently sending a lower-resolution image.
        await notify(
          "Захват области для Figma",
          explicitArea
            ? "Выделите нужную область на странице."
            : "Исходник недоступен. Выделите область изображения; отправится снимок экрана.",
        );
        const area = await selectArea(tab);
        if (!area?.ok) throw Error(area?.error || "Выделение отменено");
        normalized = await cropScreen(tab, area);
      }
      await uploadReliable(id, normalized);
      const status = await native.call("status", {}, 10000);
      await badge(status);
      const details =
        normalized.captureMode === "screen"
          ? " · снимок экрана"
          : normalized.captureMode === "resized"
            ? " · уменьшено до 4096 px"
            : "";
      await notify(
        "Изображение сохранено в очереди",
        `№${reservation.sequence}${details}. ${reservation.targetLabel ? "Получатель: " + reservation.targetLabel : "Выберите получателя в плагине Figma."}`,
      );
    } finally {
      releaseCapture();
    }
  } catch (e) {
    if (reserved)
      try {
        await native.call("fail", { id, error: e.message }, 10000);
      } catch {}
    await notify(
      "Не удалось отправить в Figma",
      e.message || "Повторите действие",
    );
    throw e;
  }
}
async function installMenu() {
  await chrome.contextMenus.removeAll();
  chrome.contextMenus.create({
    id: MENU,
    title: "Отправить в Figma",
    contexts: ["all"],
    documentUrlPatterns: ["http://*/*", "https://*/*"],
  });
}
chrome.runtime.onInstalled.addListener((details) => {
  installMenu().catch(() => {});
  chrome.alarms.create("queue-status", { periodInMinutes: 1 });
  if (details.reason === "install")
    chrome.tabs
      .create({ url: chrome.runtime.getURL("setup.html") })
      .catch(() => {});
});
chrome.runtime.onStartup.addListener(() => {
  native
    .call("status", {}, 10000)
    .then(badge)
    .catch(() => {});
});
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === MENU) sendImage(info, tab).catch(() => {});
});
chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === "queue-status")
    native
      .call("status", {}, 10000)
      .then(badge)
      .catch(() => {});
});
chrome.runtime.onMessage.addListener((m, sender, reply) => {
  if (sender.id !== chrome.runtime.id || !m || m.destination === "offscreen")
    return;
  if (m.type === "context-target" && sender.tab) {
    chrome.storage.session
      .set({
        ["context-" + sender.tab.id]: {
          frameId: sender.frameId || 0,
          target: m.target,
        },
      })
      .then(
        () => reply({ ok: true }),
        () => reply({ ok: false }),
      );
    return true;
  }
  const trusted =
    sender.url === chrome.runtime.getURL("popup.html") ||
    sender.url === chrome.runtime.getURL("setup.html");
  if (!trusted) return;
  if (
    m.type === "rpc" &&
    [
      "status",
      "cancel",
      "retry",
      "destination",
      "installation",
      "thumbnail",
      "source",
      "pause",
      "batch",
    ].includes(m.command)
  ) {
    native
      .call(m.command, m.data || {}, m.command === "status" ? 10000 : 45000)
      .then(
        (data) => {
          if (data?.pending !== undefined) badge(data);
          reply({ ok: true, data });
        },
        (e) => reply({ ok: false, error: e.message }),
      );
    return true;
  }
  if (m.type === "test-image") {
    sendTestImage().then(
      (data) => reply({ ok: true, data }),
      (e) => reply({ ok: false, error: e.message }),
    );
    return true;
  }
  if (m.type === "capture-area") {
    chrome.tabs
      .query({ active: true, currentWindow: true })
      .then((tabs) => sendImage({}, tabs[0], true))
      .then(
        () => reply({ ok: true }),
        (e) => reply({ ok: false, error: e.message }),
      );
    return true;
  }
});

async function sendTestImage() {
  const status = await native.call("status", {}, 10000);
  if (status.paused)
    throw Error(
      "Очередь на паузе. Продолжите её в меню расширения перед тестом.",
    );
  if (!status.receivers.some((r) => r.targetId === status.targetId))
    throw Error("Сначала запустите приёмник в нужном файле Figma");
  const id = crypto.randomUUID();
  const preparation = reservationTail.then(() =>
    native.call("reserve", {
      id,
      title: "Send to Figma · Connection test",
      pageUrl: "",
      sourceUrl: "",
      captureMode: "original",
    }),
  );
  reservationTail = preparation.catch(() => {});
  await preparation;
  try {
    const response = await fetch(chrome.runtime.getURL("test-image.png"));
    if (!response.ok)
      throw Error(
        "Тестовое изображение отсутствует; переустановите расширение",
      );
    const bytes = new Uint8Array(await response.arrayBuffer());
    await uploadReliable(id, {
      data: STFCapture.toBase64(bytes),
      mime: "image/png",
      width: 640,
      height: 400,
      captureMode: "original",
    });
    return { id };
  } catch (e) {
    try {
      await native.call("fail", { id, error: e.message });
    } catch {}
    throw e;
  }
}
