# Send to Figma

- `package.json` is the release version source. Keep the fixed public extension key unless intentionally migrating Native Messaging registration.
- Version bumps: use `npm version --no-git-tag-version --ignore-scripts`; never replace version strings globally in package-lock.json, because dependency versions/URLs can match the product version.
- The installed Figma code is provisioned with a local token; only the placeholder-bearing shared source/release may be committed or distributed. Host UI messages use the injected per-launch channel, not MessageEvent.source equality.
- Build: `npm ci --ignore-scripts && npm run build`. Build dependencies: Node 22+, Go 1.24+, internet for pinned goversioninfo 1.7.0. User releases contain ready binaries.
- Check: `go -C bridge test -mod=vendor ./...`, `go -C installer test ./...`, corresponding `go vet`, `npm test`, `npm run check`, `npm run package`. Build first so native integration tests do not skip.
- Reserve jobs before fetching. Freeze destination. Never mark a card complete before its insertion finishes, or replay uncertain non-idempotent operations blindly.
- Preserve user data, existing license notices and the understated `Made by Nasaat` credit. Maintainer brand: NasaatR. Canonical repository: https://github.com/NasaatR/Send_to_Figma.
- Keep Windows/Figma/real-browser execution claims separate from DOM/scene fixtures and cross-compilation.
- Do not package caches, installed data, credentials, toolchains or local build-environment scripts.
