# Verification

This file describes the scope of verification. Local 1.2.0 evidence: 44 JavaScript tests (zero skipped), 24 bridge Go tests and 5 installer Go tests passed. The additional runner check results are recorded in the repository's Actions run and docs/progress.md. Separate local test evidence, CI runner evidence and actual Figma/installed-extension checks; a prepared workflow alone is not evidence of execution.

- JavaScript tests exercise layout, queue ordering at browser-click reservation, native-client failures, SVG normalization, connection UI and Figma scene writes through explicit API/DOM fixtures.
- Scene tests use the actual emitted Figma bundle after a build. They cover duplicate replay, frozen destination, delayed deliveries for a previous collection, lock changes during decoding, page reveal and controlled reflow.
- Integration tests execute the real helper process over native stdio, real localhost HTTP, filesystem persistence and WebSocket. They cover ordered delivery, lost ACK, corrupt queue and helper crash recovery without closing the native connection.
- Go tests exercise the queue and HTTP/WebSocket server. Installer tests exercise real temporary files, architecture selection, repeat installation, Unicode/space-containing paths, integrity rejection and rollback after failed registration. Windows registry/process/UI calls are outside those platform-neutral installer tests.
- Build checks verify JavaScript syntax, resources, fixed extension ID, Windows PE architectures, executable metadata/manifests and packaged hashes. Windows x64/ARM64 helper and x86 setup are cross-compiled.

## Target-host checks still required

Actual installation/update/uninstallation on Windows; browser-to-native-host registration; real Chrome/Edge offscreen image decoding and capture; Figma Desktop manifest import, UI and canvas insertion; Windows protection/reputation decisions. A scene fixture or cross-compiled EXE does not prove these boundaries.

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

The included GitHub Actions workflow is prepared configuration, not a completed remote run. It runs these checks on Linux and Windows and supplies a build artifact when a repository is connected.

The attempted Chrome for Testing 151.0.7922.34 launch in this isolated environment ended with SIGTRAP before a page opened; no actual browser or visual check is claimed.


## Additional 1.2 checks

Go: preview validation/retention/cleanup, additive 1.1 queue migration, persistent pause, inflight ACK while paused, bulk retry/cancel destination/order invariants, rollback on failed disk commit, and HTTP(S)-only source actions. JavaScript: title/filter matching, safe bounded preview URLs, row/focus stability, modal confirmation, skip inflight batch cancellation, local preview loading and draft-only presets.

`npm run browser-check` requires an installed Chrome/Chromium (or STF_CHROME_EXECUTABLE). It renders the shipped popup and receiver HTML, tests search/pause/modal Escape/layout presets/no horizontal overflow, and uses actual Chrome PNG/crop decoding. Browser-extension and Figma APIs are explicit fixtures. Its screenshots under .build/ui are internal QA, not marketing assets or actual Figma execution.

`node scripts/windows-smoke.cjs` is restricted to disposable GitHub Actions Windows runners. It exercises actual Setup.exe installation/update/uninstallation, checks Chrome/Edge native registry paths and communicates over a real Windows native stdio process. It does not launch an installed Chrome extension or Figma Desktop.
