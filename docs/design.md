# Send to Figma · 1.0

## Goal
From an image's browser context menu, send the image into a deliberately connected Figma Desktop collection. Keep click order, image proportions, stable positions, and a durable recoverable queue. Windows 10/11 x64, Chrome/Edge Chromium, Figma Design with editing permission.

## Architecture and boundaries
An MV3 extension captures bytes and normalizes unsupported formats in an offscreen document. One native messaging executable forwards validated JSON to a detached localhost bridge. The bridge stores jobs and images on disk and delivers one at a time to an authenticated Figma plugin through WebSocket. Only the plugin writes the Figma scene. No cloud relay, account, Figma token, or global clipboard monitoring.

Go standard library plus vendored gorilla/websocket. Plain JavaScript and CSS; no frontend runtime dependencies. Windows binaries cross-compiled from the verified Go toolchain. Packaged EXEs are unsigned; running them and installing the Windows host will be performed by the user, not by this agent.

## Transport contract
Native messages are length-prefixed little-endian JSON. Requests: `{requestId,type,data}`; replies `{requestId,ok,data?,error?}`. Types: status, reserve, upload, fail, cancel, retry, destination. Reserve occurs before fetching so later downloads cannot overtake earlier clicks. The bridge pins targetId at reserve time. Requests have random operation IDs. Repeating reserve/upload is idempotent.

Loopback address: 127.0.0.1:47821. Native RPC uses a separate bearer secret. WebSocket /receiver permits only null/Figma origins and authenticates the first hello message with a 256-bit pairing token. Tokens are generated on the user's machine, never shipped in the archive. No arbitrary remote fetching or command execution by the bridge.

Receiver hello: `{type:'hello',token,targetId,label}`. Delivery: `{type:'image',job:{id,sequence,title,pageUrl,sourceUrl,captureMode,mime,width,height,data}}`. Reply after actual scene insertion: `{type:'ack',id,ok,nodeId?,error?}`. A timeout closes the receiver and requeues the item. A job ID stored on the card prevents a second insertion if the acknowledgement was lost. Messages are bounded and validated.

## Queue and safety
Maximum 200 unfinished jobs, 256 MiB of image payloads, 20 MiB per image, 4096 px per side. Binary validation accepts PNG/JPEG/GIF; normalization preserves transparency and reports resizing. A capturing reservation expires after 90 seconds. Failed/cancelled jobs do not indefinitely block later jobs. Ready jobs survive bridge/browser restart. Acknowledged payloads are removed; bounded metadata history remains. Broken/corrupt queue storage produces an actionable error instead of silently starting empty.

Queued jobs keep their original target. Connecting a different file does not redirect them. Jobs sent before a target existed require the plugin's explicit “Принять ожидающие” action. Cancelling in-flight jobs is prohibited because insertion may already have happened.

## Figma collection
Create a managed References frame on the current page, or inside a selected editable frame/section. Store a collection ID on it; ignore current selection after connection. Append proportionally fitted image cards in 4 columns, width 320, maximum image height 480, gap 24 and padding 24. Titles are optional. Grid settings only affect new additions until explicit reflow. Reflow touches managed cards only. Persist configuration and collection selection; appearance reset never deletes image nodes or queued data.

## Capture and UX
One context-menu command on ordinary web pages. Prefer bytes at the clicked image URL; use a page-context fetch for blob URLs/same-origin authenticated resources. For an inaccessible source, show an area-selection fallback and label it as a screen capture. Full-resolution originals are not promised for protected/canvas content. Cross-origin frame fallback uses explicit area selection to avoid incorrect coordinates. Include a toolbar area-capture button for sites hiding the native context menu.

Compact Russian UI, neutral colors, system font, visible focus, keyboard Escape cancellation, clear busy/error/empty/disconnected states. Popup shows destination, queue/history, pairing-copy button, layout link and appearance controls. Plugin provides Receive/Layout/Appearance tabs, start/pause, collection choice, queue adoption, explicit reflow, reset/revert and persistent safe settings.

## Verification and delivery
Tests cover durable order, replay, acknowledgement loss, frozen destination, invalid payload/auth, storage restart and interrupted captures; real loopback/WebSocket/native stdio integration; hand-derived layout fixtures; plugin scene behavior through a documented API fixture; real Chromium capture/normalization/UI interactions if the browser is available. Build Windows amd64/arm64 executables and validate archive contents. Figma Desktop and Windows install/run are target checks still requiring the user's computer.

Deliver one ZIP with extension, plugin, EXEs, per-user installer/uninstaller, complete source, vendored dependency/license, test suite, source build command, and concise Russian setup/troubleshooting instructions. Installation has no machine-wide registry changes and requires no administrator privileges.
