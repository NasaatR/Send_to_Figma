# Repository and releases

Canonical repository: https://github.com/NasaatR/Send_to_Figma. Default branch: main. The initial repository contained only README.md; the first product import preserves that initial commit as its parent.

The checked source belongs at the repository root. Generated caches, credentials, queue data, toolchains, .syso files, release folders and ZIPs are ignored. Build the ready-to-use package with npm run build, run relevant tests and npm run check, then npm run package. A GitHub source archive contains source, not a ready installer.

The Check, build and release workflow checks Windows and Linux. Windows install smoke is restricted in code to disposable GitHub Actions Windows runners because it modifies this product's HKCU registration. Linux Chromium checks render real HTML/CSS and decode real images; extension/Figma APIs are explicit fixtures. Only after both jobs succeed does the release job publish the versioned Windows package as a prerelease. It uses the workflow's own token, limits contents:write to the release job, targets the exact workflow commit and never overwrites an issued release.

Repository About fields, if edited manually:
Description: Send browser images to ordered Figma Desktop collections through a local Windows helper.
Topics: figma-plugin, chrome-extension, windows, native-messaging, image-collector.
Website: https://github.com/NasaatR/Send_to_Figma/releases

GitHub checks do not certify Figma Desktop execution, ARM64 hardware behavior or Windows protection reputation. Keep those boundaries explicit in TESTING.md and release notes.
