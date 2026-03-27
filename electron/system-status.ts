import { access } from "node:fs/promises";

import type { SidecarMode, SystemComponentStatus, SystemStatus } from "../shared/contracts";
import type { RuntimePaths } from "./app-paths";
import { FFMPEG_SOURCE, SEVEN_ZR_SOURCE, YT_DLP_SOURCE } from "./tool-sources";

async function exists(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

function component(
  id: string,
  label: string,
  availability: SystemComponentStatus["availability"],
  summary: string,
  path: string | null,
  sourceUrl: string | null,
  autoInstall: boolean,
  requiredFor: string[],
  help: string[]
): SystemComponentStatus {
  return {
    id,
    label,
    availability,
    summary,
    path,
    sourceUrl,
    autoInstall,
    requiredFor,
    help
  };
}

export async function collectSystemStatus(
  paths: RuntimePaths,
  sidecarMode: SidecarMode,
  sidecarVersion?: string | null
): Promise<SystemStatus> {
  const rustSidecarPath = `${paths.libsDir}\\downloader-core.exe`;
  const ytDlpPath = `${paths.libsDir}\\yt-dlp.exe`;
  const ffmpegPath = `${paths.libsDir}\\ffmpeg.exe`;
  const sevenZrPath = `${paths.libsDir}\\7zr.exe`;
  const denoPath = `${paths.libsDir}\\deno.exe`;

  const hasRustSidecar = await exists(rustSidecarPath);
  const hasYtDlp = await exists(ytDlpPath);
  const hasFfmpeg = await exists(ffmpegPath);
  const hasSevenZr = await exists(sevenZrPath);
  const hasDeno = await exists(denoPath);
  const hasThemes = await exists(paths.themesDir);
  const hasSettings = await exists(paths.settingsFile);
  const hasLicenses = await exists(`${paths.appRoot}\\licenses`);

  const components: SystemComponentStatus[] = [
    component(
      "downloader-core",
      "Rust downloader core",
      hasRustSidecar ? "ready" : sidecarMode === "node-fallback" ? "fallback" : "missing",
      hasRustSidecar
        ? "The native sidecar executable is available."
        : sidecarMode === "node-fallback"
          ? "The app is running on the built-in JS fallback backend."
          : "The native sidecar executable is missing.",
      rustSidecarPath,
      null,
      false,
      ["native backend", "production sidecar"],
      [
        "Build `src-native` and copy `downloader-core.exe` into `libs/` for the preferred production path.",
        "The app can still run on the JS fallback backend when Electron is available."
      ]
    ),
    component(
      "yt-dlp",
      "yt-dlp",
      hasYtDlp ? "ready" : "missing",
      hasYtDlp ? "Metadata analysis and downloads can use yt-dlp." : "Metadata analysis and downloads are blocked until yt-dlp is present.",
      ytDlpPath,
      YT_DLP_SOURCE.url,
      true,
      ["analyze", "download"],
      [
        "The app can auto-download `yt-dlp.exe` from the configured direct source.",
        "Keep the provenance URL, version, and license notice for the shipped binary."
      ]
    ),
    component(
      "ffmpeg",
      "ffmpeg",
      hasFfmpeg ? "ready" : "warning",
      hasFfmpeg ? "Post-processing and muxing are available." : "Video+audio merge and audio conversion presets will fail without ffmpeg.",
      ffmpegPath,
      FFMPEG_SOURCE.url,
      true,
      ["best", "mp3", "post-processing"],
      [
        "The app can auto-download the configured ffmpeg package and extract `ffmpeg.exe` into `libs/`.",
        "If only theme management is needed, the app can still run without ffmpeg."
      ]
    ),
    component(
      "7zr",
      "7zr helper",
      hasSevenZr ? "ready" : hasFfmpeg ? "warning" : "missing",
      hasSevenZr
        ? "The portable extraction helper is available for archive-based installs."
        : hasFfmpeg
          ? "7zr is optional once ffmpeg.exe is already present."
          : "Archive extraction is blocked until the 7zr helper is available.",
      sevenZrPath,
      SEVEN_ZR_SOURCE.url,
      true,
      ["auto-install", "ffmpeg extraction"],
      [
        "The app can auto-download `7zr.exe` from the configured direct source.",
        "Manual fallback: place `7zr.exe` into `libs/`."
      ]
    ),
    component(
      "deno",
      "Deno runtime",
      hasDeno ? "ready" : "warning",
      hasDeno ? "YouTube-oriented JS runtime support is available." : "Modern YouTube flows may fail until a JS runtime sidecar is present.",
      denoPath,
      null,
      false,
      ["YouTube support"],
      [
        "Place `deno.exe` in `libs/` for current YouTube compatibility expectations.",
        "Other providers may still work without it."
      ]
    ),
    component(
      "themes",
      "Themes directory",
      hasThemes ? "ready" : "missing",
      hasThemes ? "Theme discovery can read the portable themes directory." : "Theme directory is missing.",
      paths.themesDir,
      null,
      false,
      ["theme list", "theme apply"],
      [
        "Keep at least one built-in theme in `themes/`.",
        "The renderer can still fall back to its base CSS if theme loading fails."
      ]
    ),
    component(
      "settings",
      "Portable settings",
      hasSettings ? "ready" : "warning",
      hasSettings ? "The settings file is available." : "Settings will be re-created on first write.",
      paths.settingsFile,
      null,
      false,
      ["theme activation", "portable state"],
      [
        "The app will recreate `data/settings.json` if it is missing."
      ]
    ),
    component(
      "licenses",
      "Third-party notices",
      hasLicenses ? "ready" : "warning",
      hasLicenses ? "License notices are present for portable packaging." : "Portable build is missing the external notices directory.",
      `${paths.appRoot}\\licenses`,
      null,
      false,
      ["distribution", "compliance"],
      [
        "Keep `licenses/THIRD_PARTY_NOTICES.md` with the packaged app.",
        "Record provenance and license obligations for every shipped sidecar binary."
      ]
    )
  ];

  const notices: string[] = [];

  if (!hasYtDlp) {
    notices.push("`yt-dlp.exe` is missing. The app can download it automatically from the configured direct GitHub release.");
  }

  if (hasYtDlp && !hasFfmpeg) {
    notices.push("`ffmpeg.exe` is missing. The app can download the configured ffmpeg package and extract the binary automatically.");
  }

  if (!hasFfmpeg && !hasSevenZr) {
    notices.push("`7zr.exe` is also missing, so archive extraction for ffmpeg is not ready until the helper is downloaded.");
  }

  if (hasYtDlp && !hasDeno) {
    notices.push("YouTube-specific flows may fail until `deno.exe` is added.");
  }

  if (!hasRustSidecar && sidecarMode === "node-fallback") {
    notices.push("The app is using its built-in JS fallback backend because the Rust sidecar was not found.");
  }

  return {
    appMode: process.env.VITE_DEV_SERVER_URL ? "development" : "packaged",
    os: process.platform,
    sidecarMode,
    sidecarVersion: sidecarVersion ?? null,
    components,
    capabilities: {
      canAnalyze: hasYtDlp,
      canDownload: hasYtDlp && hasFfmpeg,
      canUseYoutube: hasYtDlp && hasFfmpeg && hasDeno,
      canManageThemes: hasThemes
    },
    notices
  };
}
