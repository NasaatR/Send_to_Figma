(function () {
  "use strict";
  const $ = (id) => document.getElementById(id),
    send = (m) => parent.postMessage({ pluginMessage: m }, "*");
  let settings = {
      version: 1,
      layout: STFCore.normalizeLayout({}),
      appearance: STFCore.normalizeAppearance({}),
      pairingToken: "",
    },
    target = null,
    socket = null,
    enabled = false,
    attempts = 0,
    retryTimer = null,
    toastTimer = null,
    starting = false;
  const imports = new Map();
  const presets = {
    grid: { columns: 4, width: 320, gap: 24, padding: 24, maxHeight: 480 },
    strip: { columns: 1, width: 640, gap: 24, padding: 24, maxHeight: 1200 },
    compact: { columns: 6, width: 180, gap: 12, padding: 16, maxHeight: 280 },
  };
  const instanceId =
    "receiver-" +
    Date.now().toString(36) +
    "-" +
    Math.random().toString(36).slice(2);
  function error(message) {
    $("notice").textContent = message;
    $("notice").hidden = !message;
  }
  function toast(message) {
    $("toast").textContent = message;
    $("toast").hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => ($("toast").hidden = true), 3000);
  }
  function state(text, online = false) {
    $("connection-text").textContent = text;
    $("connection").classList.toggle("online", online);
    $("start").textContent = enabled ? "Остановить приём" : "Начать приём";
    $("new-collection").disabled = enabled || imports.size > 0;
    $("selected-collection").disabled = enabled || imports.size > 0;
    $("reflow").disabled = imports.size > 0;
  }
  function applyAppearance(a) {
    const v = STFCore.normalizeAppearance(a);
    document.documentElement.dataset.theme = v.theme;
    document.documentElement.dataset.density = v.density;
  }
  function loadForms() {
    for (const k of [
      "columns",
      "width",
      "gap",
      "padding",
      "maxHeight",
      "radius",
    ])
      $(k).value = settings.layout[k];
    $("captions").checked = settings.layout.captions;
    $("theme").value = settings.appearance.theme;
    $("density").value = settings.appearance.density;
    applyAppearance(settings.appearance);
    preview();
    $("layout-save-state").textContent = "Настройки сохранены";
  }
  function readLayout() {
    const v = {};
    for (const k of [
      "columns",
      "width",
      "gap",
      "padding",
      "maxHeight",
      "radius",
    ])
      v[k] = Number($(k).value);
    v.captions = $("captions").checked;
    return STFCore.normalizeLayout(v);
  }
  function preview() {
    const l = readLayout(),
      p = $("grid-preview");
    $("layout-save-state").textContent =
      JSON.stringify(l) === JSON.stringify(settings.layout)
        ? "Настройки сохранены"
        : "Изменения применятся после сохранения";
    $("layout-preset").value =
      Object.keys(presets).find((k) =>
        Object.entries(presets[k]).every(([key, value]) => l[key] === value),
      ) || "custom";
    p.style.gridTemplateColumns = `repeat(${Math.min(l.columns, 8)},minmax(0,1fr))`;
    p.replaceChildren();
    for (let i = 0; i < Math.min(12, l.columns * 2); i++) {
      const n = document.createElement("div");
      n.className = "tile";
      n.style.borderRadius = Math.min(l.radius, 16) + "px";
      n.textContent = String(i + 1).padStart(2, "0");
      p.append(n);
    }
  }
  function showTarget() {
    const known = !!target;
    $("target-name").textContent = known
      ? target.label
      : "Новая коллекция References";
    $("target-count").textContent = known
      ? `В коллекции: ${target.count} · порядок отправления`
      : "Изображения появятся на текущей странице.";
    $("reveal").hidden = !known;
  }
  function status(s) {
    if (!s) return;
    if (enabled && socket?.readyState === WebSocket.OPEN && imports.size === 0)
      state(s.paused ? "Очередь на паузе" : "Приёмник подключён", !s.paused);
    $("pending-count").textContent = "В очереди: " + s.pending;
    $("received-count").textContent = "В коллекции: " + (target?.count || 0);
    $("unassigned").hidden = !s.unassigned;
    $("unassigned-text").textContent =
      `Без получателя: ${s.unassigned}. Добавить их в эту коллекцию?`;
    $("other-target").hidden =
      !target || !s.targetId || s.targetId === target.targetId;
  }
  function stop() {
    enabled = false;
    clearTimeout(retryTimer);
    retryTimer = null;
    if (socket) {
      socket.onopen = socket.onmessage = socket.onerror = socket.onclose = null;
      socket.close();
      socket = null;
    }
    state("Приём остановлен");
  }
  function connect() {
    if (!enabled || !target) return;
    clearTimeout(retryTimer);
    if (socket) {
      socket.onopen = socket.onmessage = socket.onerror = socket.onclose = null;
      socket.close();
      socket = null;
    }
    state("Подключение…");
    const ws = new WebSocket("ws://localhost:47821/receiver");
    socket = ws;
    ws.onopen = () => {
      if (socket !== ws || !enabled) return;
      ws.send(
        JSON.stringify({
          type: "hello",
          instanceId,
          token: settings.pairingToken,
          targetId: target.targetId,
          label: target.label,
        }),
      );
    };
    ws.onmessage = (e) => {
      if (socket !== ws || !enabled) return;
      let m;
      try {
        m = JSON.parse(e.data);
      } catch {
        error("Помощник прислал некорректные данные");
        stop();
        return;
      }
      if (m.type === "connected") {
        attempts = 0;
        error("");
        state("Приёмник подключён", true);
        status(m.status);
      }
      if (m.type === "status") status(m.status);
      if (m.type === "error") {
        error(m.error || "Передача не выполнена");
        if (m.code === "target-in-use") stop();
        if (/код подключения/i.test(m.error || "")) {
          stop();
          $("pair-box").hidden = false;
        }
      }
      if (m.type === "image") {
        try {
          const job = m.job;
          if (
            !job ||
            typeof job.data !== "string" ||
            job.data.length > 28 * 1024 * 1024 ||
            !/^[-a-zA-Z0-9_]{8,100}$/.test(job.id)
          )
            throw Error("Некорректное изображение");
          const binary = atob(job.data),
            bytes = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i++)
            bytes[i] = binary.charCodeAt(i);
          imports.set(job.id, ws);
          state("Добавляется №" + job.sequence, true);
          const copy = { ...job, bytes };
          delete copy.data;
          send({ type: "import", job: copy });
        } catch (ex) {
          ws.send(
            JSON.stringify({
              type: "ack",
              id: m.job && m.job.id,
              ok: false,
              error: ex.message,
            }),
          );
          error(ex.message);
        }
      }
    };
    ws.onerror = () =>
      error(
        "Помощник недоступен. Откройте расширение в браузере; если нужно — запустите Setup.exe.",
      );
    ws.onclose = () => {
      if (socket === ws) socket = null;
      if (!enabled) return;
      state("Связь прервалась");
      if (attempts >= 5) state("Ожидаем помощник — откройте расширение");
      const delay = Math.min(30000, 1000 * 2 ** Math.min(attempts++, 5));
      retryTimer = setTimeout(connect, delay);
    };
  }
  function begin(mode) {
    error("");
    const typed = $("pair-token").value.trim();
    if (typed && typed !== settings.pairingToken) {
      if (!/^[a-f0-9]{64}$/.test(typed)) {
        error("Вставьте полный код подключения из расширения");
        return;
      }
      starting = mode;
      send({ type: "pair", token: typed });
      return;
    }
    if (!settings.pairingToken) {
      error("Сначала вставьте код подключения из расширения");
      $("pair-token").focus();
      return;
    }
    starting = false;
    send({ type: "start", mode });
  }
  function persist(layout, appearance) {
    error("");
    send({ type: "settings", layout, appearance });
  }
  window.onmessage = (e) => {
    if (e.source !== parent || !e.data || !e.data.pluginMessage) return;
    const m = e.data.pluginMessage;
    if (m.type === "init") {
      settings = m.settings;
      target = m.target;
      loadForms();
      showTarget();
      $("pair-box").hidden = !!settings.pairingToken;
    }
    if (m.type === "paired") {
      settings = m.settings;
      $("pair-token").value = "";
      $("pair-box").hidden = true;
      if (starting) {
        const mode = starting;
        starting = false;
        begin(mode);
      }
    }
    if (m.type === "target") {
      target = m.target;
      showTarget();
      enabled = true;
      attempts = 0;
      connect();
    }
    if (m.type === "collection") {
      target = m.target;
      showTarget();
    }
    if (m.type === "import-result") {
      const ws = imports.get(m.id);
      imports.delete(m.id);
      if (ws && ws.readyState === WebSocket.OPEN)
        ws.send(
          JSON.stringify({
            type: "ack",
            id: m.id,
            ok: m.ok,
            nodeId: m.nodeId,
            error: m.error,
          }),
        );
      if (m.ok) {
        toast("Изображение добавлено");
        if (enabled)
          state(
            socket?.readyState === WebSocket.OPEN
              ? "Приёмник подключён"
              : "Ожидаем подключения",
            socket?.readyState === WebSocket.OPEN,
          );
      } else {
        error(m.error);
        if (enabled) state("Вставка не выполнена", true);
      }
    }
    if (m.type === "settings-saved") {
      settings = m.settings;
      loadForms();
      toast("Настройки сохранены");
    }
    if (m.type === "reflowed") toast("Перестроено карточек: " + m.count);
    if (m.type === "error") {
      starting = false;
      error(m.error);
    }
  };
  document.querySelectorAll("[data-tab]").forEach((b) => {
    b.onclick = () => {
      document.querySelectorAll("[data-tab]").forEach((t) => {
        const active = t === b;
        t.setAttribute("aria-selected", String(active));
        t.tabIndex = active ? 0 : -1;
        $(t.dataset.tab + "-panel").hidden = !active;
      });
    };
    b.onkeydown = (e) => {
      if (["ArrowLeft", "ArrowRight"].includes(e.key)) {
        e.preventDefault();
        const tabs = [...document.querySelectorAll("[data-tab]")],
          i = tabs.indexOf(b),
          next =
            tabs[
              (i + (e.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length
            ];
        next.click();
        next.focus();
      }
    };
  });
  $("start").onclick = () => (enabled ? stop() : begin("restore"));
  $("new-collection").onclick = () => begin("new");
  $("selected-collection").onclick = () => begin("selected");
  $("reveal").onclick = () => send({ type: "reveal" });
  $("change-pair").onclick = () => {
    stop();
    $("pair-box").hidden = false;
    $("pair-token").focus();
  };
  $("claim").onclick = () => {
    if (socket?.readyState === WebSocket.OPEN)
      socket.send(JSON.stringify({ type: "claim" }));
  };
  $("activate").onclick = () => {
    if (socket?.readyState === WebSocket.OPEN)
      socket.send(JSON.stringify({ type: "activate" }));
  };
  for (const k of [
    "columns",
    "width",
    "gap",
    "padding",
    "maxHeight",
    "radius",
    "captions",
  ])
    $(k).oninput = preview;
  $("save-layout").onclick = () => {
    const invalid = [
      ...$("layout-panel").querySelectorAll("input[type=number]"),
    ].some((n) => !n.checkValidity());
    if (invalid) {
      error("Проверьте диапазоны значений раскладки");
      return;
    }
    persist(readLayout(), settings.appearance);
  };
  $("revert-layout").onclick = loadForms;
  $("reset-layout").onclick = () => {
    for (const k of [
      "columns",
      "width",
      "gap",
      "padding",
      "maxHeight",
      "radius",
    ])
      $(k).value = STFCore.defaults[k];
    $("captions").checked = false;
    preview();
  };
  const appearance = () => ({
    theme: $("theme").value,
    density: $("density").value,
  });
  $("theme").onchange = $("density").onchange = () =>
    applyAppearance(appearance());
  $("save-appearance").onclick = () => persist(settings.layout, appearance());
  $("revert-appearance").onclick = loadForms;
  $("reset-appearance").onclick = () => {
    $("theme").value = "system";
    $("density").value = "compact";
    applyAppearance(appearance());
  };
  $("appearance-preview").onclick = () => toast("Предпросмотр панели");
  $("layout-preset").onchange = () => {
    const preset = presets[$("layout-preset").value];
    if (!preset) return;
    for (const [k, v] of Object.entries(preset)) $(k).value = v;
    preview();
  };
  $("reflow").onclick = () => {
    error("");
    send({ type: "reflow" });
  };
  $("export-settings").onclick = () => {
    const blob = new Blob(
        [
          JSON.stringify(
            {
              version: 1,
              layout: settings.layout,
              appearance: settings.appearance,
            },
            null,
            2,
          ),
        ],
        { type: "application/json" },
      ),
      a = document.createElement("a"),
      url = URL.createObjectURL(blob);
    a.href = url;
    a.download = "send-to-figma-settings.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  $("import-settings").onclick = () => $("settings-file").click();
  $("settings-file").onchange = async () => {
    try {
      const f = $("settings-file").files[0];
      if (!f) return;
      if (f.size > 10000) throw Error("Файл настроек слишком большой");
      const v = JSON.parse(await f.text());
      if (v.version !== 1 || !v.layout || !v.appearance)
        throw Error("Формат настроек не поддерживается");
      persist(
        STFCore.normalizeLayout(v.layout),
        STFCore.normalizeAppearance(v.appearance),
      );
    } catch (e) {
      error(e.message);
    } finally {
      $("settings-file").value = "";
    }
  };
  setInterval(() => {
    if (socket?.readyState === WebSocket.OPEN)
      socket.send(JSON.stringify({ type: "status" }));
  }, 3000);
  loadForms();
  send({ type: "init" });
})();
