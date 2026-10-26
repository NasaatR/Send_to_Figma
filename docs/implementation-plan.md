# Send to Figma Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement inline. Steps use checkbox syntax for tracking.

**Goal:** A usable Windows/Chrome/Edge image collector for Figma Desktop.

**Architecture:** MV3 capture -> native messaging -> persistent loopback bridge -> authenticated Figma receiver -> ordered managed image cards.

**Tech Stack:** Go, gorilla/websocket, plain JavaScript, Node's built-in test runner, Chromium/Playwright for local verification.

**Spec:** docs/design.md

## Global Constraints
- Windows 10/11 amd64; an additional arm64 binary; no Node/Python prerequisite for end users.
- 127.0.0.1:47821; per-user install; no cloud or packaged secrets.
- 200 unfinished jobs; 256 MiB queue; 20 MiB/image; 4096 px per side; 90 s capture expiry.
- Preserve target and click order, acknowledge only actual insertion, deduplicate by operation ID.
- Russian compact UI; ordinary native menu; capture-area fallback.

## Review Focus
- Two downloads complete out of order: delivery still follows reservations.
- Figma acknowledgement disappears after insertion: replay doesn't add another card.
- A different file connects: pending items keep the intended target.
- Browser/bridge restarts or disk writes fail: recover data or report the error.
- Very tall, transparent, unsupported-format and iframe images: preserve content and explain capture limitations.

## Task 1: Persistent bridge
Files: bridge/model.go, bridge/server.go, bridge/main.go, bridge/model_test.go, bridge/server_test.go.
Interfaces: native RPC status/reserve/upload/fail/cancel/retry/destination; authenticated WebSocket hello/image/ack/claim.
- [x] Write queue and transport tests; run them failing before implementation.
- [x] Implement atomic persistence, validated payloads, frozen targets and replay-safe queue.
- [x] Implement authenticated HTTP/native/WebSocket transports and detached server lifecycle.
- [x] Run Go tests/vet and real loopback transport; compile Windows binaries. Race detector unavailable with the static CGO-disabled toolchain used here.

## Task 2: Figma receiver and layout
Files: plugin/core.js, plugin/main.js, plugin/ui.html, plugin/ui.js, shared/ui.css, tests/layout.test.cjs, tests/plugin.test.cjs.
Interfaces: import jobs -> managed cards tagged with job ID; UI init/target/import/settings/reflow/status messages.
- [x] Write independent layout and duplicate insertion fixtures; watch them fail.
- [x] Implement append/reflow without moving unmanaged content, proportional fitting and persistent settings.
- [x] Implement paired connection, pause/reconnect, explicit queue adoption and compact UI.
- [x] Test scene and DOM UI behavior with external boundaries identified; test actual WebSocket/native transport separately.

## Task 3: Browser extension
Files: extension/manifest.json, extension/background.js, extension/content.js, extension/offscreen.js, extension/popup.html, extension/popup.js, tests/browser.cjs.
Interfaces: reserve before capture -> normalization -> upload; status/actions UI -> native RPC; area selection -> visible tab crop.
- [x] Add capture/normalization and UI behavior tests with explicit Chrome boundary fixtures where needed.
- [x] Implement one context-menu item, image/page fetch, bounded normalization, iframe/area fallback and durable delivery.
- [x] Implement queue feedback, destination selection, pairing, recovery and appearance settings.
- [x] Execute JS syntax/DOM/integration checks. Real browser execution could not proceed because Chromium terminates with SIGTRAP before opening a page; target checks are documented.

## Task 4: Release
Files: scripts/build.cjs, install.cmd, install.ps1, uninstall.cmd, uninstall.ps1, README.md, TESTING.md, LICENSE, dist/.
- [x] Generate fixed extension public key/ID, complete plugin HTML and manifests.
- [x] Package Windows binaries and per-user installer that validates the extension ID.
- [x] Review source/permissions/error paths; fix material defects and rerun affected tests.
- [ ] Run all checks, inspect ZIP, save the deliverable and report target-verification limits.
