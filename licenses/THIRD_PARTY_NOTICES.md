# Third-Party Notices

This starter kit intentionally treats external download and DPI-bypass components as sidecars with their own licensing and distribution obligations.

## Bundled Or Referenced Components

- `yt-dlp`
  - Upstream project license: Unlicense for repository code.
  - Important packaging note: official standalone release binaries include GPLv3+ components through their build chain.
  - Action for distribution: ship the relevant license texts and source-offer/compliance materials if you redistribute official standalone binaries.

- `ffmpeg`
  - License depends on the exact binary build you ship.
  - Action for distribution: record the source URL, exact version, and the license set for the chosen build before bundling.

- `deno`
  - Required as a JavaScript runtime sidecar for modern YouTube support scenarios in `yt-dlp`.
  - Action for distribution: keep the upstream license text with the packaged binary.

- `Zapret2`
  - Positioning in this project: optional external system strategy, not a silently bundled default path.
  - Important portability note: requires elevated/system-level integration and is not supported on macOS.

- `WinDivert`
  - Relevant when shipping Windows Zapret2 flows.
  - Important packaging note: dual-licensed and driver-based; verify redistribution terms, provenance, hashes, and AV/EDR impact before bundling.

## Project Policy

- Do not add GPL-licensed Rust wrappers for `yt-dlp` to the core binary unless the project is deliberately moving to GPL-compatible distribution.
- Keep a provenance log for every sidecar binary placed in `libs/`.
- Copy `licenses/` into packaged builds so compliance files stay outside `asar` and remain visible to users and auditors.

