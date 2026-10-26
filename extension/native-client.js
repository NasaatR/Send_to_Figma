var STFNative = (function () {
  "use strict";
  function create(api) {
    let port = null,
      counter = 0;
    const pending = new Map();
    function connect() {
      if (port) return port;
      const current = api.runtime.connectNative("com.sendtofigma.bridge");
      port = current;
      current.onMessage.addListener((m) => {
        if (!m || typeof m.requestId !== "string") return;
        const p = pending.get(m.requestId);
        if (!p) return;
        clearTimeout(p.timer);
        pending.delete(m.requestId);
        if (m.ok === true) p.resolve(m.data);
        else p.reject(Error(m.error || "Помощник отклонил запрос"));
      });
      current.onDisconnect.addListener(() => {
        const detail = api.runtime.lastError?.message || "";
        if (port === current) port = null;
        for (const p of pending.values()) {
          clearTimeout(p.timer);
          p.reject(
            Error(
              "Нет связи с локальным помощником. Запустите Setup.exe и перезапустите браузер." +
                (detail ? " " + detail : ""),
            ),
          );
        }
        pending.clear();
      });
      return current;
    }
    function call(type, data = {}, timeout = 45000) {
      return new Promise((resolve, reject) => {
        const requestId =
          Date.now().toString(36) + "-" + (++counter).toString(36);
        let timer;
        try {
          const p = connect();
          timer = setTimeout(() => {
            pending.delete(requestId);
            reject(
              Error(
                "Помощник не ответил вовремя. Проверьте очередь перед повторной отправкой.",
              ),
            );
          }, timeout);
          pending.set(requestId, { resolve, reject, timer });
          p.postMessage({ requestId, type, data });
        } catch (e) {
          clearTimeout(timer);
          pending.delete(requestId);
          reject(
            Error(
              "Локальный помощник не установлен или недоступен. Запустите Setup.exe.",
            ),
          );
        }
      });
    }
    return { call };
  }
  return { create };
})();
if (typeof module === "object" && module.exports) module.exports = STFNative;
