# Send to Figma

[Инструкция на русском](README.ru.md)

Send a website image to an ordered collection in Figma Desktop from the browser's right-click menu. Windows 10/11 x64 or ARM64, Chrome/Edge, and an editable Figma Design file are required. No Node.js, Python, Figma API token or cloud relay is required to use the ready-made package.

[Download the checked Windows preview](https://github.com/NasaatR/Send_to_Figma/releases/tag/v1.3.0) · [Source repository](https://github.com/NasaatR/Send_to_Figma)

## Install the ready-made package

1. Extract the complete **Send-to-Figma-1.3.0-Windows.zip**, then double-click **Setup.exe**. It installs for your Windows account and opens the instructions. Administrator rights are not requested.
2. Visit `chrome://extensions` or `edge://extensions`, enable **Developer mode**, choose **Load unpacked**, and select `%LOCALAPPDATA%\SendToFigma\app\extension`.
3. The connection page opens automatically. In **Figma Desktop**, open your destination file and choose **Plugins → Development → Import plugin from manifest…**. Use the path copied from the connection page: `%LOCALAPPDATA%\SendToFigma\app\figma-plugin\manifest.json`.
4. Run **Send to Figma · Receiver**. Setup has already paired this installed receiver; it starts receiving automatically. No code or Start click is needed. Click **Отправить тестовое изображение** on the connection page. Success means Figma acknowledged the actual insertion; the test card can then be deleted.

After setup, the extracted download can be deleted. The installed extension and plugin have stable paths. Refresh web pages already open before extension installation. Keep the receiver plugin running while collecting images; completed captures queue locally when it is closed.

This is a manually installed preview release, not a Chrome Web Store or Figma Community publication. **Actual Figma Desktop execution, installation of the browser extension, and native ARM64 hardware behavior remain unverified.** Windows installer and browser-UI evidence is reported separately in the linked Actions run. See [TESTING.md](TESTING.md) for the evidence boundary. The executables are unsigned; a checksum is an integrity check, not publisher authentication. Windows or organization policy may restrict unsigned apps, local-network connections or development extensions.

## Use

Right-click an image → **Отправить в Figma**. The compact popup shows local thumbnails, a pinned destination and confirmed insertions. Search by title, filter active/errors/history, open the source page, pause sending, retry failed insertions together, or cancel waiting items after confirmation. An inflight insertion completes even when sending is paused. A small message on the website distinguishes preparation, waiting, confirmed insertion and errors, even when Windows notifications are disabled. Click the copy icon in the popup header or **Диагностика** in the Figma footer to copy a redacted report in one click. Use **Подключение и проверка** for the guided connection page, a test image or a sanitized connection report.

The receiver creates a References frame, or a managed collection inside an explicitly selected frame/section. Selecting a different layer does not change the destination. New images append without moving older cards; a deliberate reflow restores sequence order and is undoable in Figma. Layout drafts include Grid, Strip and Compact presets; save to apply them to future cards. Existing cards move only after an explicit reflow. Layout settings include columns, width, spacing, padding, maximum height, rounded corners and optional captions. Light/dark/system themes and compact/comfortable density are preserved.

Original PNG/JPEG/GIF bytes are retained when possible. WebP/AVIF/SVG are rasterized to PNG; images larger than 4096 pixels per side are scaled proportionally. Some sources, browser-internal pages, protected content and site-controlled menus are unavailable. An explicit area-selection fallback captures visible screen pixels; it cannot recover original image resolution.

If Figma reports `Invalid value for allowedDomains`, update to 1.2.2 or later using Setup.exe and import `%LOCALAPPDATA%\SendToFigma\app\figma-plugin\manifest.json` again. There is no need to delete pairing data or reinstall the extension.

## Automatic connection

Setup pairs the receiver locally; reopening it restores its collection and reconnects without copying codes. The browser starts the helper when needed. If the helper starts later, the receiver retries automatically (at most 8 seconds between attempts). Captures sent before the first receiver opens are accepted automatically. If the previous default receiver is offline, new captures use the newly opened receiver; already assigned jobs keep their destination. An online default is never silently replaced by another receiver. The manual code controls are under a collapsed fallback section. Import the manifest from the installed app path, not the extracted release folder.

## Updates and removal

Stop the Figma receiver, extract the new package and run Setup.exe. Then reload the extension in the extensions page and reopen the Figma receiver. The installer stages and verifies the new application before replacing the previous one; failed registration restores the prior application. The `data` directory is preserved.

When upgrading from 1.0.0, remove the old extension entry that points into the downloaded folder and load the permanent folder above. Browser appearance preferences may need to be set again. Re-import the Figma development plugin from the new permanent path. The native queue, pairing token and Figma content remain.

Uninstall through **Windows Settings → Apps → Installed apps → Send to Figma**, then remove the browser extension and Figma development-plugin entry. Queued data and the pairing code remain in `%LOCALAPPDATA%\SendToFigma\data` for recovery; remove that folder manually only when no longer needed. Figma images are not removed.

## Local data and recovery

The helper listens only on `127.0.0.1:47821`; HTTP/native and WebSocket pairing use separate random tokens. Nothing is uploaded to our server. The browser requires website access to fetch user-selected images. There is no clipboard monitoring, telemetry or automatic collection.

Jobs reserve sequence numbers before downloading, survive helper restart, and keep their original destination. Retry after a lost acknowledgement uses the same operation ID. The plugin tags a card only after successful insertion to avoid duplicate retries. A destination mismatch is rejected at the document write boundary. Queue limits: 200 unfinished jobs, 20 MiB per image, 256 MiB total; 90-second active-capture expiry. Rapid clicks reserve ordered deferred jobs before entering one of two capture lanes; abandoned deferred jobs expire after 30 minutes. Image decoding is serialized. Previews are at most 128 pixels and 12 KiB, stored separately and fetched on demand. Original payloads are deleted after ACK; small previews expire with bounded history (up to 500 records, latest 20 displayed). Clearing history never deletes Figma nodes.

The helper now recovers from a process crash on the next native request. A connection failure after a request was written is **not blindly replayed**: check the queue before retrying. The Figma receiver reconnects while receiving remains enabled, with a capped delay. A damaged queue is reported and retained, not silently reset.

If connection fails, use **Подключение и проверка → Скопировать отчёт о подключении**. The report excludes pairing tokens, source URLs, file names and document content. Do not share `config.json` or your installed `data` folder. To share the product, send the original release ZIP; every computer generates its own credentials. Setup provisions the pairing token only into that computer’s installed Figma code after verifying the shared payload. Never share your installed app folder: it contains its local pairing key. The release ZIP and source keep an empty provisioning marker. Duplicating a whole collection/file can duplicate its collection ID: create a new collection in the copied file.

## Source and builds

The distribution includes the complete `source` directory. In a repository, that directory's contents belong at the root. Maintainer: **NasaatR**. Product credit: **Made by Nasaat**. Existing MIT and third-party notices are retained.

Developers need Node.js 22+, Go 1.24+ and internet for locked build tools. Build resources use `goversioninfo` 1.7.0, Figma sandbox code is emitted for ES2017 with esbuild. The Go WebSocket dependency is vendored. End users need none of these tools.

```sh
npm ci --ignore-scripts
go -C bridge test -mod=vendor ./...
go -C installer test ./...
npm run build
npm test
npm run check
npm run package
```

Build output: `release/Send-to-Figma-1.3.0`. `package.json` is the version source. The 32-bit setup runs on Windows x64 and through Windows ARM's x86 emulation; it installs the native x64 or ARM64 helper. GitHub checks run on Windows and Linux. The Windows job exercises per-user installation, update, removal, registry values and real native stdio. The Linux job renders the actual UI and decodes images in Chromium with explicitly mocked extension/Figma APIs. After both jobs pass, a versioned preview release is published once; existing issued assets are never overwritten. See the actual [Actions results](https://github.com/NasaatR/Send_to_Figma/actions), [TESTING.md](TESTING.md) and [design research](docs/research.md).
