(function () {
  "use strict";
  const $ = (id) => document.getElementById(id),
    Q = STFQueue,
    I = STFIcons;
  let lastStatus = null,
    online = false,
    group = "all",
    query = "",
    busy = false,
    revision = 0,
    refreshing = null,
    appearance = { theme: "system", density: "compact" },
    toastTimer,
    connectionError = false,
    destinationKey = "";
  const rows = new Map(),
    previews = new Map(),
    previewQueue = [];
  let previewActive = 0;
  const labels = {
    queued: "Ждёт подготовки",
    capturing: "Подготовка изображения",
    ready: "Ожидает отправки",
    inflight: "Добавляется в Figma",
    done: "Добавлено в Figma",
    failed: "Не выполнено",
    cancelled: "Отменено",
  };
  const statusIcons = {
    queued: "clock",
    capturing: "clock",
    ready: "arrow",
    inflight: "clock",
    done: "check",
    failed: "warning",
    cancelled: "close",
  };
  function error(text) {
    $("notice").textContent = text;
    $("notice").hidden = !text;
  }
  function toast(text) {
    $("toast").textContent = text;
    $("toast").hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => ($("toast").hidden = true), 2600);
  }
  function normalize(v) {
    return {
      theme: ["system", "light", "dark"].includes(v?.theme)
        ? v.theme
        : "system",
      density: ["compact", "comfortable"].includes(v?.density)
        ? v.density
        : "compact",
    };
  }
  function apply(v) {
    document.documentElement.dataset.theme = v.theme;
    document.documentElement.dataset.density = v.density;
  }
  async function rpc(command, data = {}) {
    const r = await chrome.runtime.sendMessage({ type: "rpc", command, data });
    if (!r?.ok) throw Error(r?.error || "Нет связи с помощником");
    return r.data;
  }
  function iconButton(icon, label, fn) {
    const b = document.createElement("button");
    b.className = "quiet icon-button";
    b.title = label;
    b.setAttribute("aria-label", label);
    b.append(I.create(icon));
    b.onclick = fn;
    return b;
  }
  function showPreview(id, data) {
    const row = rows.get(id)?.node;
    if (!row) return;
    const box = row.querySelector(".job-thumb");
    if (!data || box.querySelector("img")) return;
    const img = document.createElement("img");
    img.alt = "";
    img.src = data;
    box.prepend(img);
    box.querySelector(":scope > svg")?.remove();
  }
  function schedulePreview(j) {
    if (!j.hasPreview || previews.has(j.id)) return;
    previews.set(j.id, "");
    previewQueue.push(j.id);
    pumpPreviews();
  }
  function pumpPreviews() {
    while (previewActive < 3 && previewQueue.length) {
      const id = previewQueue.shift();
      if (!rows.has(id)) {
        previews.delete(id);
        continue;
      }
      previewActive++;
      rpc("thumbnail", { id })
        .then((v) => {
          const data = Q.preview(v.data);
          if (rows.has(id)) {
            previews.set(id, data);
            showPreview(id, data);
          } else previews.delete(id);
        })
        .catch(() => {})
        .finally(() => {
          previewActive--;
          pumpPreviews();
        });
    }
  }
  function jobRow(j) {
    const row = document.createElement("article");
    row.className = "job";
    row.dataset.id = j.id;
    row.dataset.status = j.status;
    const box = document.createElement("div");
    box.className = "job-thumb";
    box.append(I.create("image"));
    const status = document.createElement("span");
    status.className = "job-status-icon";
    status.title = labels[j.status] || j.status;
    status.append(I.create(statusIcons[j.status] || "image"));
    box.append(status);
    const body = document.createElement("div");
    body.className = "job-copy";
    const title = document.createElement("div");
    title.className = "job-title";
    title.textContent =
      String(j.sequence).padStart(3, "0") + " · " + (j.title || "Изображение");
    title.title = title.textContent;
    const detail = document.createElement("div");
    detail.className = "job-detail";
    let text = j.error || labels[j.status] || j.status;
    if (!j.error) {
      if (j.width && j.height) text += " · " + j.width + "×" + j.height;
      if (j.captureMode === "screen") text += " · снимок";
      else if (j.captureMode === "resized") text += " · уменьшено";
    }
    if (!j.targetId && ["queued", "ready", "capturing"].includes(j.status))
      text += " · без получателя";
    else if (
      j.targetId !== lastStatus.targetId &&
      j.targetLabel &&
      !["done", "cancelled"].includes(j.status)
    )
      text += " · " + j.targetLabel;
    detail.textContent = text;
    body.append(title, detail);
    const actions = document.createElement("div");
    actions.className = "job-actions";
    if (j.hasSource)
      actions.append(
        iconButton("link", "Открыть источник", () => openSource(j.id)),
      );
    if (j.status === "failed" && j.size > 0)
      actions.append(
        iconButton("refresh", "Повторить вставку", () =>
          action("retry", { id: j.id }),
        ),
      );
    if (["queued", "capturing", "ready", "failed"].includes(j.status))
      actions.append(
        iconButton("close", "Отменить отправление", () =>
          action("cancel", { id: j.id }),
        ),
      );
    row.append(box, body, actions);
    return row;
  }
  function renderList() {
    if (!lastStatus) return;
    const list = $("jobs"),
      visible = Q.filter(lastStatus.jobs, group, query),
      wanted = new Set(visible.map((j) => j.id));
    for (const [id, entry] of rows)
      if (!wanted.has(id)) {
        entry.node.remove();
        rows.delete(id);
      }
    list.querySelector(".empty")?.remove();
    if (!visible.length) {
      const e = document.createElement("div");
      e.className = "empty";
      e.append(
        I.create(query ? "search" : group === "failed" ? "check" : "image"),
      );
      const title = document.createElement("strong");
      title.textContent = query
        ? "Ничего не найдено"
        : group === "failed"
          ? "Ошибок нет"
          : group === "history"
            ? "История пока пуста"
            : group === "active"
              ? "Очередь пуста"
              : "Собирай изображения в Figma";
      const hint = document.createElement("span");
      hint.textContent = query
        ? "Попробуй другое название."
        : group === "all"
          ? "ПКМ по картинке → Отправить в Figma"
          : group === "active"
            ? "Новые изображения появятся здесь."
            : "Здесь будут соответствующие отправления.";
      e.append(title, hint);
      list.append(e);
    }
    let cursor = list.firstElementChild;
    for (const j of visible) {
      const signature = JSON.stringify([j, lastStatus.targetId]);
      let entry = rows.get(j.id);
      if (!entry || entry.signature !== signature) {
        const node = jobRow(j);
        if (entry) {
          const old = entry.node;
          old.replaceWith(node);
          if (cursor === old) cursor = node;
        }
        entry = { node, signature };
        rows.set(j.id, entry);
      }
      if (entry.node !== cursor) list.insertBefore(entry.node, cursor);
      cursor = entry.node.nextElementSibling;
      showPreview(j.id, previews.get(j.id));
      schedulePreview(j);
    }
    const keep = new Set(lastStatus.jobs.map((j) => j.id));
    for (const id of previews.keys()) if (!keep.has(id)) previews.delete(id);
    document
      .querySelectorAll("[data-filter]")
      .forEach((b) =>
        b.setAttribute("aria-pressed", String(b.dataset.filter === group)),
      );
    $("retry-failed").hidden = !Q.retryIDs(lastStatus.jobs).length;
    $("cancel-waiting").hidden =
      group !== "active" || !Q.cancelIDs(lastStatus.jobs).length;
    $("clear-history").hidden =
      group !== "history" ||
      !(
        lastStatus.history ||
        lastStatus.jobs.some((j) => ["done", "cancelled"].includes(j.status))
      );
    $("queue-caption").textContent =
      group === "history"
        ? "Последние 20 отправлений"
        : query
          ? visible.length + " найдено"
          : "ПКМ по картинке → Отправить в Figma";
    updateDisabled();
  }
  function updateDisabled() {
    for (const el of document.querySelectorAll(
      "#jobs button,#retry-failed,#cancel-waiting,#clear-history",
    ))
      el.disabled = busy || !online;
    $("pause-queue").disabled = busy || !online;
    $("destination").disabled =
      busy || !online || !lastStatus?.receivers.length;
  }
  function render(s) {
    lastStatus = s;
    online = true;
    const connected = s.receivers.some((r) => r.targetId === s.targetId),
      select = $("destination"),
      options = [];
    if (s.targetId && !connected)
      options.push({
        targetId: s.targetId,
        label: (s.targetLabel || "Закреплённая коллекция") + " · не подключена",
      });
    for (const r of s.receivers) options.push(r);
    if (!options.length)
      options.push({ targetId: "", label: "Выбери файл в приёмнике Figma" });
    const key = JSON.stringify([options, s.targetId]);
    if (key !== destinationKey) {
      destinationKey = key;
      select.replaceChildren();
      for (const r of options) {
        const o = document.createElement("option");
        o.value = r.targetId;
        o.textContent = r.label;
        select.append(o);
      }
      select.value = s.targetId || options[0].targetId;
    }
    $("receiver-status").classList.toggle("online", connected && !s.paused);
    $("receiver-status").classList.toggle("paused", !!s.paused);
    $("receiver-text").textContent = s.paused
      ? "Очередь на паузе"
      : connected
        ? "Готово к отправке"
        : s.targetId
          ? "Ожидаем закреплённую коллекцию"
          : "Запусти приёмник в Figma";
    $("connect-action").hidden = connected;
    $("pending-badge").textContent = String(s.pending);
    $("active-count").textContent = String(s.pending);
    $("failed-count").textContent = String(s.failed || 0);
    $("queue-size").textContent = s.queueBytes
      ? (s.queueBytes / 1024 / 1024).toFixed(1) + " МБ"
      : "";
    $("copy-pairing").disabled = !s.pairingToken;
    const pause = $("pause-queue"),
      label = s.paused ? "Продолжить очередь" : "Приостановить очередь";
    if (pause.getAttribute("aria-label") !== label) {
      pause.replaceChildren(I.create(s.paused ? "play" : "pause"));
      pause.setAttribute("aria-label", label);
      pause.title = label;
    }
    pause.setAttribute("aria-pressed", String(!!s.paused));
    $("jobs").classList.remove("job-list-stale");
    renderList();
  }
  async function refresh() {
    if (refreshing) return refreshing;
    const current = revision;
    refreshing = (async () => {
      try {
        const s = await rpc("status");
        if (current !== revision) return;
        render(s);
        if (connectionError) {
          error("");
          connectionError = false;
        }
      } catch (e) {
        if (current !== revision) return;
        connectionError = true;
        online = false;
        error(e.message);
        $("copy-pairing").disabled = true;
        $("receiver-text").textContent = "Помощник недоступен";
        $("receiver-status").classList.remove("online");
        $("connect-action").hidden = false;
        $("jobs").classList.add("job-list-stale");
        updateDisabled();
      } finally {
        refreshing = null;
      }
    })();
    return refreshing;
  }
  async function action(command, data = {}) {
    if (busy) return;
    busy = true;
    revision++;
    updateDisabled();
    error("");
    try {
      const result = await rpc(command, data);
      if (result?.jobs)
        render({ ...result, pairingToken: lastStatus?.pairingToken });
      if (command === "batch")
        toast(
          "Изменено: " +
            result.changed +
            (result.skipped ? " · пропущено: " + result.skipped : ""),
        );
      const s = await rpc("status");
      render(s);
    } catch (e) {
      error(e.message);
    } finally {
      busy = false;
      updateDisabled();
    }
  }
  async function openSource(id) {
    try {
      const r = await rpc("source", { id }),
        link = Q.source(r.url);
      if (!link) throw Error("Ссылка на источник недоступна");
      await chrome.tabs.create({ url: link });
    } catch (e) {
      error(e.message);
    }
  }
  function confirm(title, text) {
    return new Promise((resolve) => {
      const d = $("confirm-dialog");
      $("confirm-title").textContent = title;
      $("confirm-text").textContent = text;
      d.returnValue = "";
      d.addEventListener("close", () => resolve(d.returnValue === "confirm"), {
        once: true,
      });
      d.showModal();
    });
  }
  const openSetup = () =>
    chrome.tabs.create({ url: chrome.runtime.getURL("setup.html") });
  $("open-setup").onclick =
    $("connect-action").onclick =
    $("settings-setup").onclick =
      openSetup;
  $("copy-report").onclick = async () => {
    let diagnostic = { helper: STFDiagnostics.summary(lastStatus), events: [] };
    try {
      const r = await chrome.runtime.sendMessage({type:"diagnostics"});
      if (r?.ok) diagnostic = r.data;
    } catch (e) { diagnostic.helperError = STFDiagnostics.clean(e.message); }
    const report = STFDiagnostics.report("browser-popup", chrome.runtime.getManifest().version, {
      browser: navigator.userAgent, helper: diagnostic.helper, helperError: diagnostic.helperError || "",
    }, diagnostic.events);
    const ok = await STFDiagnostics.copy(report, $("report-fallback"));
    toast(ok ? "Диагностика скопирована" : "Нажмите Ctrl+C, чтобы скопировать диагностику");
  };
  $("refresh").onclick = refresh;
  $("pause-queue").onclick = () =>
    action("pause", { paused: !lastStatus.paused });
  $("destination").onchange = () =>
    action("destination", { targetId: $("destination").value });
  document.querySelectorAll("[data-filter]").forEach(
    (b) =>
      (b.onclick = () => {
        group = b.dataset.filter;
        renderList();
      }),
  );
  $("search").oninput = () => {
    query = $("search").value;
    renderList();
  };
  $("search").onkeydown = (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      $("search").value = query = "";
      renderList();
    }
  };
  $("retry-failed").onclick = () =>
    action("batch", { operation: "retry", ids: Q.retryIDs(lastStatus.jobs) });
  $("cancel-waiting").onclick = async () => {
    const ids = Q.cancelIDs(lastStatus.jobs);
    if (
      await confirm(
        "Отменить ожидающие?",
        ids.length +
          " отправлений будут отменены. Изображения в Figma сохранятся.",
      )
    )
      action("batch", { operation: "cancel", ids });
  };
  $("clear-history").onclick = async () => {
    if (
      await confirm(
        "Очистить историю?",
        "Удалятся записи завершённых и отменённых отправлений и их миниатюры. Изображения в Figma сохранятся.",
      )
    )
      action("batch", { operation: "clear_history" });
  };
  document.querySelectorAll("[data-tab]").forEach((b) => {
    b.onclick = () => {
      document.querySelectorAll("[data-tab]").forEach((t) => {
        const on = t === b;
        t.setAttribute("aria-selected", String(on));
        t.tabIndex = on ? 0 : -1;
        $(t.dataset.tab + "-panel").hidden = !on;
      });
    };
    b.onkeydown = (e) => {
      if (["ArrowLeft", "ArrowRight"].includes(e.key)) {
        e.preventDefault();
        const other = [...document.querySelectorAll("[data-tab]")].find(
          (t) => t !== b,
        );
        other.click();
        other.focus();
      }
    };
  });
  $("copy-pairing").onclick = async () => {
    try {
      if (!online || !lastStatus?.pairingToken)
        throw Error("Помощник не подключён");
      await navigator.clipboard.writeText(lastStatus.pairingToken);
      toast("Код скопирован. Вставь в приёмник Figma.");
    } catch (e) {
      error(e.message);
    }
  };
  $("copy-extension-id").onclick = () =>
    navigator.clipboard
      .writeText(chrome.runtime.id)
      .then(() => toast("ID расширения скопирован"))
      .catch((e) => error(e.message));
  $("capture-area").onclick = () => {
    chrome.runtime.sendMessage({ type: "capture-area" }).catch(() => {});
    window.close();
  };
  const current = () =>
    normalize({ theme: $("theme").value, density: $("density").value });
  const restore = () => {
    $("theme").value = appearance.theme;
    $("density").value = appearance.density;
    apply(appearance);
  };
  $("theme").onchange = $("density").onchange = () => apply(current());
  $("save-appearance").onclick = async () => {
    try {
      const next = current();
      await chrome.storage.local.set({ appearance: next });
      appearance = next;
      toast("Вид панели сохранён");
    } catch (e) {
      error("Настройки не сохранились: " + e.message);
    }
  };
  $("revert-appearance").onclick = restore;
  $("reset-appearance").onclick = () => {
    $("theme").value = "system";
    $("density").value = "compact";
    apply(current());
  };
  chrome.storage.local
    .get("appearance")
    .then((v) => {
      appearance = normalize(v.appearance);
      restore();
    })
    .catch(() => {});
  I.mount();
  refresh();
  setInterval(() => {
    if (!document.hidden && !busy) refresh();
  }, 2500);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) refresh();
  });
})();
