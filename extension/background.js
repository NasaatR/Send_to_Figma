"use strict";
importScripts("native-client.js", "capture-core.js", "diagnostics.js");
const native = STFNative.create(chrome),
  MENU = "send-image-to-figma",
  LIMIT = 20 * 1024 * 1024;
let offscreenCreating = null,
  reservationTail = Promise.resolve();
let captureCount = 0;
const captureWaiters = [];
let diagnosticTail = Promise.resolve();
function record(stage, message = "") {
  diagnosticTail = diagnosticTail.then(async () => {
    const stored = await chrome.storage.local.get("diagnostics");
    const events = Array.isArray(stored.diagnostics) ? stored.diagnostics : [];
    events.push(STFDiagnostics.event(stage, message));
    await chrome.storage.local.set({ diagnostics: events.slice(-30) });
  }).catch(() => {});
  return diagnosticTail;
}
async function diagnostics() {
  let status = null, helperError = "";
  try { status = await native.call("status", {}, 10000); }
  catch (e) { helperError = STFDiagnostics.clean(e.message); await record("helper.error", e.message); }
  await diagnosticTail;
  let events = [];
  try { events = (await chrome.storage.local.get("diagnostics")).diagnostics || []; } catch {}
  return { helper: STFDiagnostics.summary(status), helperError, events };
}
async function feedback(tab, message, kind = "waiting") {
  if (!tab?.id) return;
  const data = { type: "capture-feedback", message, kind };
  try { await pageMessage(tab.id, 0, data); }
  catch {
    try { await injectTop(tab.id); await pageMessage(tab.id, 0, data); } catch {}
  }
}
const deliveryWatchers = new Map();
let deliveryPolling = null;
function settleDeliveries(status) {
  const jobs = new Map((status.jobs || []).map(j => [j.id, j]));
  for (const [id, watcher] of deliveryWatchers) {
    const job = jobs.get(id);
    if (job?.status === "done") {
      record("delivery.done");
      feedback(watcher.tab, "Добавлено в Figma · №" + job.sequence, "done");
      deliveryWatchers.delete(id);
    } else if (["failed", "cancelled"].includes(job?.status)) {
      record("delivery." + job.status, job.error);
      feedback(watcher.tab, job.status === "cancelled" ? "Отправка отменена" : "Не удалось вставить: " + job.error, job.status === "failed" ? "error" : "waiting");
      deliveryWatchers.delete(id);
    } else if (Date.now() >= watcher.deadline) deliveryWatchers.delete(id);
  }
}
function observeDelivery(id, tab, status) {
  if (status.paused || !status.receivers?.some(r => r.targetId === status.targetId)) return;
  deliveryWatchers.set(id, {tab, deadline:Date.now()+8000});
  settleDeliveries(status);
  if (!deliveryWatchers.size || deliveryPolling) return;
  // One shared bounded observer for a burst of captures; never poll once per image.
  deliveryPolling = (async () => {
    while (deliveryWatchers.size) {
      await new Promise(resolve => setTimeout(resolve, 500));
      try {
        const current = await native.call("status", {}, 10000);
        settleDeliveries(current);
        await badge(current);
      } catch { deliveryWatchers.clear(); }
    }
  })().catch(() => deliveryWatchers.clear()).finally(() => { deliveryPolling = null; });
}
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
    const waiting = status.pending && !status.receivers?.some(r => r.targetId === status.targetId);
    await chrome.action.setBadgeText({
      text: status.failed ? "!" : status.pending ? String(Math.min(status.pending, 99)) : "",
    });
    await chrome.action.setBadgeBackgroundColor({ color: status.failed ? "#b83b36" : waiting ? "#986b24" : "#202023" });
    await chrome.action.setTitle?.({ title: status.failed ? "Send to Figma · есть ошибки, откройте очередь" : waiting ? "Send to Figma · изображения ждут приёмник" : "Send to Figma" });
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
  let deliveryStatus = null;
  record("capture.request");
  feedback(tab, "Готовим изображение для Figma…");
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
    record("capture.reserved");
    const releaseCapture = await captureLane();
    try {
      await native.call("begin_capture", { id });
      let normalized = null;
      if (!explicitArea && target.source) {
        let input;
        try {
          input = await fetchBytes(target.source);
        } catch (e) {
          record("capture.source-fallback", e.message);
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
        await feedback(tab, "");
        const area = await selectArea(tab);
        if (!area?.ok) throw Error(area?.error || "Выделение отменено");
        normalized = await cropScreen(tab, area);
      }
      await uploadReliable(id, normalized);
      const status = await native.call("status", {}, 10000);
      deliveryStatus = status;
      record("capture.saved");
      await badge(status);
      const connected = status.receivers?.some(r => r.targetId === reservation.targetId);
      await feedback(tab, status.paused ? "Сохранено · очередь на паузе" : connected ? "Отправляем в Figma · №" + reservation.sequence : "Сохранено в очереди · откройте приёмник в Figma");
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
    if (deliveryStatus) observeDelivery(id, tab, deliveryStatus);
  } catch (e) {
    record("capture.failed", e.message);
    await feedback(tab, "Не удалось отправить: " + e.message, "error");
    try { await chrome.action.setBadgeText({ text: "!" }); await chrome.action.setBadgeBackgroundColor({ color: "#b83b36" }); } catch {}
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
  if (m.type === "diagnostics") {
    diagnostics().then(data => reply({ ok: true, data }), e => reply({ ok: false, error: STFDiagnostics.clean(e.message) }));
    return true;
  }
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
