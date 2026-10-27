# Changelog

## 1.3.1

- Fix Windows updates when a browser, Figma or another process holds the installed app directory open. If the directory swap is denied, update individual files at stable paths after backing up all affected originals.
- Roll back modified files and registration on failure; retain the backup if restoration is itself blocked. Queue, pairing and unrelated app files are preserved. Locked-file failures now explain how to retry without deleting data or requesting elevation.
- Reproduce real Windows directory/file locks in installer tests and update the actual Setup.exe with a process holding the app directory as its working directory.

## 1.3.0

- Replace the browser parent-window identity assumption with a per-launch channel in Figma UI/main messages; show startup/host timeouts instead of leaving an inert Start button.
- Setup provisions the installed receiver with its local pairing token. Existing queue/config are preserved; public packages keep the placeholder and contain no machine credentials.
- Auto-start and restore the collection on plugin launch, recover helper connections with a capped 8-second delay, and keep manual pairing as a collapsed fallback.
- Automatically accept first-use captures without a destination. If a default receiver is offline, new captures use the newly opened receiver; already assigned jobs and online destinations remain protected.
- Add one-click redacted diagnostics in Figma, popup and setup, a bounded persistent browser event log and a selectable clipboard fallback.
- Show preparation/waiting/confirmed insertion/errors on the website and clearer toolbar badges, independent of desktop notification settings.
- Exercise emitted UI/main together through a null-source host relay and real native transport, including reopen, queue drain, credential provisioning and privacy regressions.

## 1.2.2

- Fix Figma manifest import: declare `ws://localhost:47821` instead of the rejected IP literal. The receiver now uses the same hostname; helper binding and authentication remain unchanged.
- Add a built-manifest/receiver URL regression check and exercise real WebSocket delivery through localhost in native integration tests.
- Document updating after a failed manifest import; existing queue and pairing data are preserved.

## 1.2.1

- Fix intrinsic grid sizing that clipped long queue titles and right-hand controls inside the popup scroll area.
- Keep layout save/revert/reset controls visible in the Figma layout panel while scrolling.
- Avoid theme-change button background crossfades and capture stable light/dark QA screenshots.
- Browser checks now assert the popup scroll container itself has no hidden horizontal overflow.

## 1.2.0

- Compact image-first popup: consistent SVG controls, local thumbnails, search and active/error/history filters. Destination stays visible; unchanged polls preserve row identity and keyboard focus.
- At most two capture pipelines and one image decode at a time. Deferred reservations preserve click order; the receiver receives a compact status summary instead of full image history.
- Persistent queue pause; a leased insertion completes before pausing subsequent work.
- Atomic retry/cancel batches, explicit confirmation before cancellation/history cleanup, and protection for inflight insertions. Original destination and sequence remain frozen.
- Bounded preview files survive ACK/browser restart without embedding image bytes into status. History pruning removes stale previews. Source actions accept only HTTP(S) and remove credentials/query/fragment.
- Grid, Strip and Compact layout presets edit drafts; saving and explicit reflow remain separate.
- GitHub source, Windows/Linux checks, Windows installer/native smoke, actual Chromium UI/image smoke with explicit API fixtures, and versioned preview-release packaging.
- No Figma Desktop or ARM64 runtime certification; executables remain unsigned.

## 1.1.0

- Native Windows Setup.exe replaces the PowerShell installation path. Installs the helper, extension and Figma receiver at stable per-user paths and provides Windows Apps uninstallation.
- Staged installation verifies payload hashes; registration failure restores the previous application. Existing queue and pairing data remain intact.
- Guided connection page with copyable Figma manifest path, pairing, separate component status, real test image and a sanitized connection report.
- Automatically restart a crashed helper after a failed connection attempt. Never blindly replay an uncertain HTTP operation.
- Receiver retries connection with bounded delay, ignores stale sockets and rejects deliveries for another collection. Duplicate active collection IDs cannot take over the receiver; damaged payloads become actionable errors without blocking later images.
- Recheck locked/deleted destinations after asynchronous image decoding; reveal the pinned collection on its actual page.
- Compile the Figma sandbox bundle for ES2017, embed executable versions and asInvoker manifests, and use one product version source.
- Preserve the last confirmed settings if Figma settings storage fails.
- Preserve existing Russian UI, add the requested product credit and simplify English/Russian installation instructions.
- Add focused regression tests, installer rollback tests and a portable CI configuration. See TESTING.md for actual execution evidence.

## 1.0.0

Initial local browser extension, native queue and Figma receiver with ordered image collection, area capture and configurable layout.
