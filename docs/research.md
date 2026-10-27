# Implementation checks, 2026-10-23

- Chrome Native Messaging uses OS registration and a fixed allowed extension origin. It limits host replies to 1 MiB. The helper remains a real native executable; a browser extension alone cannot write Figma Desktop nodes. The installer registers only this user's Chrome/Edge host and keeps the public extension key stable. Source: https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging
- On ordinary Windows Chrome installations, an installer cannot silently install an arbitrary local CRX. Developer-mode loading remains a visible one-time step until a store release. Source: https://developer.chrome.com/docs/extensions/how-to/distribute/install-extensions
- The Figma manifest explicitly permits ws/http local domains when accompanied by reasoning, and new plugins require dynamic-page document access. Only loopback WebSocket access is declared. Source: https://developers.figma.com/docs/plugins/manifest/
- Figma's plugin sandbox and UI iframe are different environments. The main code is emitted for ES2017; browser UI code stays in its own iframe. Official plugin-typings 1.142.0 confirms setCurrentPageAsync for revealing a collection on another page and the current text layout fields. Sources: https://developers.figma.com/docs/plugins/how-plugins-run/ and https://github.com/figma/plugin-typings
- Executable manifests and file version resources improve identification but do not sign a binary or establish SmartScreen reputation. The installer requests asInvoker; this is not a protection bypass. New signed binaries can also show reputation warnings. Source: https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/smartscreen-reputation
- esbuild 0.28.2 is pinned for sandbox syntax transformation; goversioninfo 1.7.0 is pinned for PE resources. Build checks inspect the resources in actual output executables. Sources: https://esbuild.github.io/api/#target and https://github.com/josephspurrier/goversioninfo

These checks informed the implementation; they are not evidence of a successful installation or Figma Desktop run. See TESTING.md.


## UI research for 1.2.0 — 2026-10-27

Reviewed primary product pages: https://en.eagle.cool/extensions, https://moodlyextension.com/, and https://figscreen.com/. Eagle's fast collection and batch organization suggest keeping capture easy while providing deliberate batch recovery. Moodly's visual boards suggest identifiable thumbnails and stable collection selection. Figscreen's compact capture history suggests separating current work, failures and recent completed captures. These are product-direction inferences from public descriptions, not a hands-on certification or copied source/assets.

Applied: compact destination-first popup, local thumbnail rows, search/status filters, source links, bounded history, safe batch actions, persistent pause and draft layout presets. Account systems, remote relays, annotations and full-page import remain outside this image-collector's scope. Thumbnails are optional enhancements: a preview failure never turns a valid original capture into a failed import. The original selected image is unchanged when supported.

Build/distribution reference: https://cli.github.com/manual/gh_release_create. Workflow release creation targets the exact commit and uses versioned assets after checks, with no release overwrite.

## Figma manifest import fix — 2026-10-27

The user reproduced a Desktop manifest rejection for `ws://127.0.0.1:47821`. The official manifest documentation permits WebSocket schemes and documents localhost with explicit ports: https://developers.figma.com/docs/plugins/manifest/. Another tool author documents the same IP-literal rejection: https://github.com/mxsyx/codex-figma. Version 1.2.2 uses `ws://localhost:47821` consistently in the manifest and receiver UI. The helper still binds IPv4 loopback and validates Host, Origin and the pairing token. No wildcard or remote network permission was added. Built-manifest and real localhost transport checks cannot replace a Desktop import test.

## Receiver messaging and automatic pairing — 2026-10-27

Figma's documented host-to-UI contract is event.data.pluginMessage; it does not promise parent-window equality for MessageEvent.source. Source: https://developers.figma.com/docs/plugins/creating-ui/ and https://developers.figma.com/docs/plugins/api/properties/figma-ui-postmessage/. The reported inert button is consistent with the old source-window check discarding replies; the screenshot alone cannot establish the actual event source. Version 1.3 authenticates a per-launch channel injected by main into the UI and tests a null-source relay. Setup provisions the existing per-user pairing token directly into installed code, leaving public release placeholders unchanged. This avoids adding an unauthenticated discovery/token endpoint. The installed copy must not be shared; distribute the original ZIP.
