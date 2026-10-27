# Verification

This file describes the scope of verification. Local 1.3.0 evidence: 55 JavaScript tests (zero skipped), 26 bridge Go tests and 7 installer Go tests passed. The additional runner check results are recorded in the repository's Actions run and docs/progress.md. Separate local test evidence, CI runner evidence and actual Figma/installed-extension checks; a prepared workflow alone is not evidence of execution.

- JavaScript tests exercise layout, queue ordering at browser-click reservation, native-client failures, SVG normalization, connection UI and Figma scene writes through explicit API/DOM fixtures.
- Scene tests use the actual emitted Figma bundle after a build. They cover duplicate replay, frozen destination, delayed deliveries for a previous collection, lock changes during decoding, page reveal and controlled reflow.
- Integration tests execute the real helper process over native stdio, real localhost HTTP, filesystem persistence and WebSocket. They cover ordered delivery, lost ACK, corrupt queue and helper crash recovery without closing the native connection.
- Go tests exercise the queue and HTTP/WebSocket server. Installer tests exercise real temporary files, architecture selection, repeat installation, Unicode/space-containing paths, integrity rejection and rollback after failed registration. Windows registry/process/UI calls are outside those platform-neutral installer tests.
- Build checks verify JavaScript syntax, resources, fixed extension ID, Windows PE architectures, executable metadata/manifests and packaged hashes. Windows x64/ARM64 helper and x86 setup are cross-compiled.

## Target-host checks still required

The current checked Windows runner installation/update/uninstallation/provisioning results must be read from Actions. The remaining target-host boundaries are browser-to-native-host registration; real Chrome/Edge offscreen image decoding and capture; Figma Desktop manifest import, UI and canvas insertion; Windows protection/reputation decisions. A scene fixture or cross-compiled EXE does not prove these boundaries.

The connection page supplies the shortest end-to-end smoke test for the target computer: connect the receiver, send the included test image, and wait for actual insertion acknowledgement. Confirm that its test card is visible in the intended collection.

Before broad distribution, also test: normal PNG/JPEG, WebP/AVIF/SVG, a transparent PNG, 10 fast consecutive images, area capture/Esc, receiver closed then reopened, browser restarted with pending jobs, helper crash, deleted/locked target, changed Figma page, layout reflow/undo, upgrade from 1.0.0 and uninstall while retaining data. Repeat on an ARM64 Windows computer before claiming native ARM64 runtime validation.

## Reproduce locally

```sh
npm ci --ignore-scripts
go -C bridge test -mod=vendor ./...
go -C bridge vet -mod=vendor ./...
go -C installer test ./...
go -C installer vet ./...
npm run build
npm test
npm run check
```

The GitHub Actions workflow runs on Linux and Windows and publishes a versioned preview only after both platform jobs succeed. Verify the run for the exact release commit; configuration alone is not evidence of execution.

The attempted Chrome for Testing 151.0.7922.34 launch in this isolated environment ended with SIGTRAP before a page opened; no actual browser or visual check is claimed.


## Additional 1.2 checks

Go: preview validation/retention/cleanup, additive 1.1 queue migration, persistent pause, inflight ACK while paused, bulk retry/cancel destination/order invariants, rollback on failed disk commit, and HTTP(S)-only source actions. JavaScript: title/filter matching, safe bounded preview URLs, row/focus stability, modal confirmation, skip inflight batch cancellation, local preview loading and draft-only presets.

`npm run browser-check` requires an installed Chrome/Chromium (or STF_CHROME_EXECUTABLE). It renders the shipped popup and receiver HTML, tests search/pause/modal Escape/layout presets/no horizontal overflow, and uses actual Chrome PNG/crop decoding. Browser-extension and Figma APIs are explicit fixtures. Its screenshots under .build/ui are internal QA, not marketing assets or actual Figma execution.

`node scripts/windows-smoke.cjs` is restricted to disposable GitHub Actions Windows runners. It exercises actual Setup.exe installation/update/uninstallation, checks Chrome/Edge native registry paths and communicates over a real Windows native stdio process. It does not launch an installed Chrome extension or Figma Desktop.

## 1.2.2 manifest regression

The built receiver manifest must declare the exact localhost WebSocket origin used by the emitted UI, with no IP literal or wildcard. Native integration delivery uses localhost resolution against the real IPv4-loopback helper. These checks guard the reported configuration error but do not execute Figma Desktop’s manifest validator. Retry manifest import and the test image on the target machine after updating.

## 1.3 connection and diagnostics

Setup unit tests cover generation, reuse, per-computer isolation, placeholder-only shared source, corruption rejection and preserved config. The Windows smoke checks that Setup provisioned exactly the token returned by the installed native helper and preserved it on update/removal. The shared release code must still contain its placeholder.

The combined receiver integration executes emitted code.js and ui.html together with a Figma scene fixture and a real helper process over native stdio/HTTP/WebSocket. Host replies use MessageEvent.source=null and a per-launch channel. It covers automatic pairing/start, duplicate startup messages, first-use queue drain, actual insertion acknowledgement, reopening the same collection and report redaction. It is not Figma Desktop execution. Other tests cover wrong-channel rejection, storage-read failure recovery, WebSocket construction failure, reconnects, clipboard fallback, persistent bounded browser diagnostics, and clearing page feedback before screenshot capture.

Manual smoke after Setup: reload the extension, launch the receiver from the installed manifest and wait for “Приёмник подключён” without entering a token or pressing Start. Send a website image; confirm the page message and Figma card. Reopen the plugin and send another image into the same collection. Copy diagnostics from both surfaces; neither report should contain the pairing token, image URL or collection title. If using the public extracted plugin directly, provision via Setup or use the collapsed manual pairing fallback.

## 1.3.1 Windows directory locks

Platform-neutral tests cover in-place replacement, unchanged directory identity, preserved queue/config and unrelated files, rollback after registration failure and preflight failure before mutation. Windows-specific tests hold directory handles without FILE_SHARE_DELETE, prove the original app rename fails, and exercise successful fallback, registration rollback and an individually locked file. The Windows Setup.exe smoke holds app as a child process’s working directory, proves rename is denied, then installs the update and verifies the changed file and unchanged pairing identity. Read the exact release Actions result before claiming these target checks passed.
