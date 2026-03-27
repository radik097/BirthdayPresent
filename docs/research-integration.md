# Research Integration Notes

This repository integrates the March 27, 2026 research findings from `deep-research-report.md` into the current starter kit.

## What Changed In The Implementation

- `yt-dlp` remains a subprocess-driven engine instead of a linked Rust wrapper.
- The renderer and sidecar contracts now expose an explicit network layer:
  - `direct`
  - `proxy`
  - `system-bypass`
- The UI exposes `proxy`, `impersonate`, and `cookies-from-browser` inputs because the report identified them as practical levers for real-world `yt-dlp` usage.
- Error handling now surfaces anti-bot and transport-style hints in the UI rather than treating every failure as a generic download error.
- `Zapret2` is treated as an optional external system mode, not as a silently embedded always-on dependency.

## Architectural Position

- Electron stays the shell for the current starter kit.
- Rust remains the intended long-term core backend.
- A dev mock sidecar exists only to keep the Electron/UI loop testable before Rust toolchain availability.
- `system-bypass` currently means: "assume an external system-level path is already configured". The app does not auto-install or auto-toggle Zapret2, WinDivert, or driver rules.

## Product Guardrails From Research

- Do not promise full cross-platform DPI bypass.
- Do not position Zapret2 as a one-click transparent feature.
- Do not bundle third-party binaries without recording provenance and license obligations.
- Do not treat YouTube anti-bot responses as DPI failures; surface them as a separate class of problem.
