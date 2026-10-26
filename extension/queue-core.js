var STFQueue = (function () {
  "use strict";
  const active = new Set(["queued", "capturing", "ready", "inflight"]),
    terminal = new Set(["done", "cancelled"]);
  function filter(jobs, group = "all", query = "") {
    const text = String(query).trim().toLocaleLowerCase();
    return jobs.filter(
      (j) =>
        (group === "all" ||
          (group === "active" && active.has(j.status)) ||
          (group === "failed" && j.status === "failed") ||
          (group === "history" && terminal.has(j.status))) &&
        (!text ||
          [j.title, j.sequence, j.targetLabel]
            .join(" ")
            .toLocaleLowerCase()
            .includes(text)),
    );
  }
  function preview(data) {
    return typeof data === "string" &&
      data.length <= 16500 &&
      /^data:image\/(?:png|jpeg);base64,[A-Za-z0-9+/]+={0,2}$/.test(data)
      ? data
      : "";
  }
  function retryIDs(jobs) {
    return jobs
      .filter((j) => j.status === "failed" && j.size > 0)
      .map((j) => j.id);
  }
  function cancelIDs(jobs) {
    return jobs
      .filter((j) =>
        ["queued", "capturing", "ready", "failed"].includes(j.status),
      )
      .map((j) => j.id);
  }
  function source(link) {
    try {
      const u = new URL(link);
      if (!["http:", "https:"].includes(u.protocol)) return "";
      u.username = u.password = u.search = u.hash = "";
      return u.href;
    } catch {
      return "";
    }
  }
  return { filter, preview, retryIDs, cancelIDs, source };
})();
if (typeof module === "object" && module.exports) module.exports = STFQueue;
