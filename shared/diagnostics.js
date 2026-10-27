(function (root) {
  "use strict";
  function clean(value) {
    return String(value || "")
      .replace(/[a-f0-9]{64}/gi, "[secret]")
      .replace(/(?:https?|wss?|file|chrome-extension):\/\/[^\s<>"']+/gi, "[url]")
      .replace(/[A-Z]:\\[^\n<>"']+/gi, "[path]")
      .replace(/\/(?:home|Users|workspace|tmp)\/[^\n<>"']+/g, "[path]")
      .replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, 280);
  }
  function event(stage, error = "") {
    return { time: new Date().toISOString(), stage: String(stage).replace(/[^a-z0-9._-]/gi, "").slice(0, 60), error: clean(error) };
  }
  function summary(status) {
    if (!status) return null;
    return {
      version: clean(status.version), paused: !!status.paused,
      receivers: Array.isArray(status.receivers) ? status.receivers.length : 0,
      destinationConnected: !!status.receivers?.some(r => r.targetId === status.targetId),
      destinationSelected: !!status.targetId,
      pending: status.pending || 0, unassigned: status.unassigned || 0,
      failed: status.failed || 0, done: status.done || 0,
      jobs: (status.jobs || []).slice(-15).map(j => ({ sequence: j.sequence, status: clean(j.status), error: clean(j.error) })),
    };
  }
  function report(surface, version, state, events = []) {
    return JSON.stringify({ product: "Send to Figma", version, surface,
      time: new Date().toISOString(), ...state,
      events: events.slice(-30).map(e => ({ time: clean(e.time), stage: clean(e.stage), error: clean(e.error) })),
    }, null, 2);
  }
  async function copy(text, fallback) {
    const d = fallback.ownerDocument;
    fallback.value = text;
    // Figma's iframe may not expose navigator.clipboard. Try its supported
    // selection-based path while the original click gesture is still active.
    fallback.hidden = false;
    fallback.focus();
    fallback.select();
    try { if (typeof d.execCommand === "function" && d.execCommand("copy")) { fallback.hidden = true; return true; } } catch {}
    try { await d.defaultView.navigator.clipboard.writeText(text); fallback.hidden = true; return true; } catch {}
    fallback.focus(); fallback.select();
    return false;
  }
  const api = { clean, event, summary, report, copy };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.STFDiagnostics = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
