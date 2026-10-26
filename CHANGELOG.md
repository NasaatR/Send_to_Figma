# Changelog

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
