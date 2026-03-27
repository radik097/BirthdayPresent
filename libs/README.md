# Sidecar Binaries

Place portable sidecar executables here for packaged builds:

- `downloader-core.exe`
- `yt-dlp.exe`
- `ffmpeg.exe`
- `deno.exe`

`downloader-core.exe` is produced automatically by `npm run build:rust` and `run.bat rust`.

The starter kit tolerates missing binaries in development and surfaces typed errors instead of crashing.

## Provenance Rule

Do not drop third-party binaries here without recording:

- upstream source URL
- version/date
- checksum or signature source
- license obligations

If you later experiment with Zapret2 on Windows, treat `WinDivert` and related files as explicit, separately reviewed additions rather than invisible defaults.
