# Current release: 1.2.0

2026-10-27. Authorized improvement and initial source import into NasaatR/Send_to_Figma/main. Input: user-provided 1.1.0 Windows archive. The remote initially contained only README.md at commit 39d4b0c95d457386425b9f26541bf8033177dfab. Existing product licenses, extension identity, local credentials and Russian UI are preserved.

Implemented: compact destination-first popup; consistent vector controls; bounded local previews separate from original images/status; search and active/error/history filters; stable row identity/focus on unchanged polls; source navigation with query/credentials removed; persistent pause; atomic retry/cancel batches with inflight protection; confirmed history cleanup; draft-only layout presets; two capture lanes and one decoder with ordered deferred reservations; lightweight receiver status; GitHub CI, Windows installation/native smoke, Chromium UI/image smoke and versioned package/release workflow.

Local evidence for 1.2.0: **44 JavaScript tests passed, zero skipped; 24 bridge Go tests and 5 installer Go tests passed.** JavaScript syntax, fixed extension identity, PE architectures/version/asInvoker resources, payload hashes and complete package checks pass. New native RPCs execute over actual native stdio, HTTP, disk and WebSocket in integration tests. Image/UI/scene boundaries in unit tests are explicit fixtures.

The local Chromium launch is unavailable in this isolated execution environment. Real Chrome rendering/decoding and actual Windows installation/update/removal are delegated to the repository's disposable CI runners and must be read from the actual Actions result, not inferred from the workflow YAML. No Figma Desktop, installed-extension or ARM64 runtime execution is claimed. Executables remain unsigned.

Canonical source and current check results: https://github.com/NasaatR/Send_to_Figma and https://github.com/NasaatR/Send_to_Figma/actions. The workflow publishes the exact checked Windows package only after both platform jobs pass; release assets are not overwritten.

---

## Earlier release records

# Current release: 1.1.0

2026-10-23. Recovered the supplied 1.0.0 archive and revised that exact source. Windows 11 + Chrome/Edge + Figma Desktop remain the intended user platform. No remote repository was created: the current GitHub connection exposes no repository-creation operation. GitHub-ready source and a non-publishing CI workflow are included.

Implemented: per-user native Setup.exe with stable application paths, staged integrity checks and registration rollback; Windows Apps removal retaining data; guided pairing and end-to-end test image; sanitized connection report; native helper restart after a dial failure; capped receiver reconnection and stale-socket rejection; frozen-target enforcement at insertion; locked-target recheck after decode; page-aware reveal; prevention of duplicate active collection takeover; damaged-payload isolation so later jobs can continue; ES2017 Figma sandbox output; actual PE version/asInvoker resources; current English/Russian instructions. Existing Russian UI preserved; Made by Nasaat credit added.

Verification executed against the 1.1.0 build: **35 JavaScript tests passed, zero skipped; 15 bridge Go tests and 5 installer Go tests passed; Go vet passed; JavaScript syntax, all release resource paths, fixed extension identity, installer payload hashes, PE architectures/version resources/asInvoker manifests and complete package checksums passed.** The actual native-process tests execute Linux binaries and real HTTP/WebSocket/filesystem transport. The Figma scene and browser UI tests use explicit fixtures; they do not execute the host apps.

Build toolchain: verified official Go 1.27.3 archive; esbuild 0.28.2 and goversioninfo 1.7.0. Shipped binaries: native Windows amd64/arm64 helpers and x86 Setup.exe. Setup relies on Windows ARM x86 emulation only during installation; the helper is selected for the native architecture.

A fresh Chrome for Testing 151.0.7922.34 download passed archive extraction and --version, but browser launch exited with SIGTRAP before any page. Therefore no visual browser, actual extension, Windows installation or Figma Desktop test is claimed. Windows/ARM64 and Figma runtime checks remain listed in TESTING.md. Executables are unsigned; no Windows protection clearance is claimed.

The original 1.0.0 input is retained. The new release is a separate versioned ZIP.

---

## Historical 1.0.0 record


2026-10-14: User authorized implementation of the researched local architecture and selected Windows + Chrome/Edge. Native inline implementation selected to keep shared protocol work in one place. Empty conversation workspace; no existing repository or user code to modify.

Plan/spec created before product code. Verified Go toolchain download checksum. Browser download uses workspace-owned temp/cache directories because system /tmp is unavailable.

Core queue, native/HTTP/WebSocket transport and Windows binaries implemented. Node layout/scene/worker/DOM UI tests implemented. Real native-process integration on Linux passes: reservation order, upload, pairing, lost acknowledgement replay, payload cleanup, durable restart. Windows amd64/arm64 EXEs cross-compiled; PE architecture/resources/checksums verified. Real Chromium launch in this environment terminates with SIGTRAP before a page opens; no visual or real browser verification claimed.

Final independent read-only review found four Important issues. Reproduced with tests before fixes: sequence-sorted append overlapping on retry, oversized native status, SVG stylesheet/fragment loss, discarded corrupt-queue startup diagnostics. Fixed with compact status metadata, separate append/reflow ordering, preserved safe SVG paint, and correlated startup errors. Minor wrong toolbar capture source metadata also reproduced and fixed. Remaining minor: crashed helper needs a browser restart; recovery and this limit are explicit in README. No Windows/Figma Desktop target access.

Additional regressions caught and fixed: settings boot could race collection start; manually moved cards could occupy an append slot. Existing nodes retain positions; collision forces a fresh row. Late retries append without moving existing content; explicit reflow restores sequence order.
