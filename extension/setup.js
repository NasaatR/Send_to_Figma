(function () {
  "use strict";
  const $ = (id) => document.getElementById(id);
  let current = null,
    installation = null,
    loading = false,
    connectionError = false,
    testId = "",
    sending = false,
    toastTimer;
  const rpc = async (command, data = {}) => {
    const r = await chrome.runtime.sendMessage({ type: "rpc", command, data });
    if (!r?.ok) throw Error(r?.error || "Нет связи с помощником");
    return r.data;
  };
  function notice(message) {
    $("notice").textContent = message;
    $("notice").hidden = !message;
  }
  function toast(message) {
    $("toast").textContent = message;
    $("toast").hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => ($("toast").hidden = true), 2500);
  }
  async function copy(text, message) {
    await navigator.clipboard.writeText(text);
    toast(message);
  }
  function render(s) {
    current = s;
    const receiver = s.receivers.find((r) => r.targetId === s.targetId);
    $("helper-state").textContent = "Помощник подключён · " + s.version;
    $("helper-check").textContent = "Подключён";
    $("install-help").hidden = true;
    $("receiver-check").textContent = receiver
      ? s.paused
        ? "Подключена · очередь на паузе"
        : "Подключена"
      : "Ожидаем приёмник";
    $("target").textContent = receiver
      ? "Коллекция: " + receiver.label
      : s.targetId
        ? "Запусти приёмник в закреплённой коллекции или выбери другую в меню расширения."
        : "";
    $("copy-pairing").disabled = !s.pairingToken;
    $("test-send").disabled = !receiver || sending || !!s.paused;
    if (testId) {
      const job = s.jobs.find((j) => j.id === testId);
      $("test-result").hidden = false;
      if (job?.status === "done") {
        $("test-result").textContent =
          "Готово! Figma подтвердила вставку тестового изображения.";
        sending = false;
      } else if (["failed", "cancelled"].includes(job?.status)) {
        $("test-result").textContent = job.error || "Тест отменён";
        sending = false;
      } else
        $("test-result").textContent = receiver
          ? "Ожидаем подтверждение вставки из Figma…"
          : "Тест в очереди. Запусти приёмник Figma.";
      $("test-send").disabled = !receiver || sending || !!s.paused;
    }
  }
  async function refresh() {
    if (loading) return;
    loading = true;
    try {
      const s = await rpc("status");
      render(s);
      if (connectionError) {
        notice("");
        connectionError = false;
      }
      if (!installation) {
        installation = await rpc("installation");
        $("plugin-path").value = installation.pluginPath;
        $("copy-plugin").disabled = false;
      }
    } catch (e) {
      current = null;
      connectionError = true;
      $("helper-state").textContent = "Помощник пока не подключён";
      $("helper-check").textContent = "Нет связи";
      $("receiver-check").textContent = "Не проверена";
      $("install-help").hidden = false;
      $("test-send").disabled = $("copy-pairing").disabled = true;
      notice(e.message);
    } finally {
      loading = false;
    }
  }
  $("refresh").onclick = refresh;
  $("copy-plugin").onclick = () =>
    copy($("plugin-path").value, "Путь скопирован").catch((e) =>
      notice("Выдели путь и нажми Ctrl+C: " + e.message),
    );
  $("copy-pairing").onclick = () => {
    if (current?.pairingToken)
      copy(
        current.pairingToken,
        "Код скопирован. Вставь в приёмник Figma.",
      ).catch((e) => notice(e.message));
  };
  $("plugin-path").onclick = () => $("plugin-path").select();
  $("test-send").onclick = async () => {
    if (sending) return;
    sending = true;
    testId = "";
    $("test-result").hidden = false;
    $("test-result").textContent = "Готовим тестовое изображение…";
    $("test-send").disabled = true;
    notice("");
    try {
      const r = await chrome.runtime.sendMessage({ type: "test-image" });
      if (!r?.ok) throw Error(r?.error || "Тест не отправлен");
      testId = r.data.id;
      await refresh();
    } catch (e) {
      sending = false;
      notice(e.message);
      await refresh();
    }
  };
  $("copy-report").onclick = async () => {
    const report = JSON.stringify(
      {
        product: "Send to Figma",
        extension: chrome.runtime.getManifest().version,
        helper: current?.version || "unavailable",
        browser: navigator.userAgent,
        receiverConnected: !!current?.receivers.some(
          (r) => r.targetId === current.targetId,
        ),
        pending: current?.pending ?? null,
        failed: current?.failed ?? null,
        testState: testId
          ? current?.jobs.find((j) => j.id === testId)?.status || "unknown"
          : "not-run",
      },
      null,
      2,
    );
    try {
      await copy(report, "Отчёт скопирован");
    } catch {
      $("report-fallback").hidden = false;
      $("report-fallback").value = report;
      $("report-fallback").select();
    }
  };
  chrome.storage.local
    .get("appearance")
    .then((v) => {
      document.documentElement.dataset.theme = ["light", "dark"].includes(
        v.appearance?.theme,
      )
        ? v.appearance.theme
        : "system";
    })
    .catch(() => {});
  refresh();
  setInterval(() => {
    if (!document.hidden) refresh();
  }, 2000);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) refresh();
  });
})();
