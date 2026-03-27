import { spawn } from "node:child_process";
import { access, cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import readline from "node:readline";

import AdmZip from "adm-zip";

const baseDir = process.env.DISMAS_BASE_DIR ?? process.cwd();
const paths = {
  appRoot: baseDir,
  themesDir: path.join(baseDir, "themes"),
  libsDir: path.join(baseDir, "libs"),
  dataDir: path.join(baseDir, "data"),
  settingsFile: path.join(baseDir, "data", "settings.json")
};

const allowedThemeExtensions = new Set([
  ".json",
  ".css",
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".svg",
  ".woff",
  ".woff2",
  ".ttf",
  ".otf"
]);

const defaultSettings = {
  activeThemeId: "default_darkest"
};

const activeDownloads = new Map();

function send(payload) {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

function sendResult(id, result) {
  send({ id, result });
}

function sendError(id, error) {
  send({ id, error });
}

function emit(event, payload) {
  send({ event, payload });
}

function appError(code, message, details) {
  return {
    code,
    message,
    details,
    recoverable: true
  };
}

function parseCompactDate(value) {
  if (!value || !/^\d{8}$/.test(value)) {
    return null;
  }

  return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}T00:00:00.000Z`;
}

function derivePublishedAt(info) {
  if (typeof info.release_timestamp === "number") {
    return new Date(info.release_timestamp * 1000).toISOString();
  }

  if (typeof info.timestamp === "number") {
    return new Date(info.timestamp * 1000).toISOString();
  }

  if (typeof info.upload_date === "string") {
    return parseCompactDate(info.upload_date);
  }

  return null;
}

async function exists(targetPath) {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

function safeResolve(basePath, relativePath) {
  const normalized = relativePath.replaceAll("\\", "/");
  const resolved = path.resolve(basePath, ...normalized.split("/"));
  const relative = path.relative(basePath, resolved);

  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    return null;
  }

  return resolved;
}

function requireValidUrl(url) {
  let parsed;

  try {
    parsed = new URL(url);
  } catch {
    throw appError("VALIDATION_ERROR", "A valid http/https URL is required.");
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw appError("VALIDATION_ERROR", "Only http and https URLs are supported.");
  }

  return parsed;
}

function themeIdValid(id) {
  return /^[a-z0-9_-]+$/.test(id);
}

async function ensureLayout() {
  await mkdir(paths.themesDir, { recursive: true });
  await mkdir(paths.libsDir, { recursive: true });
  await mkdir(paths.dataDir, { recursive: true });

  if (!(await exists(paths.settingsFile))) {
    await writeFile(paths.settingsFile, `${JSON.stringify(defaultSettings, null, 2)}\n`, "utf8");
  }

  if (!(await exists(path.join(paths.dataDir, "library.json")))) {
    await writeFile(path.join(paths.dataDir, "library.json"), "[]\n", "utf8");
  }
}

async function loadSettings() {
  try {
    const raw = await readFile(paths.settingsFile, "utf8");
    const parsed = JSON.parse(raw);
    return {
      activeThemeId: parsed.activeThemeId || defaultSettings.activeThemeId
    };
  } catch {
    return { ...defaultSettings };
  }
}

async function saveSettings(settings) {
  await writeFile(paths.settingsFile, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
}

async function loadLibraryRecords() {
  const libraryFile = path.join(paths.dataDir, "library.json");

  try {
    const raw = await readFile(libraryFile, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function saveLibraryRecords(records) {
  const libraryFile = path.join(paths.dataDir, "library.json");
  await writeFile(libraryFile, `${JSON.stringify(records, null, 2)}\n`, "utf8");
}

async function listLibrary() {
  const records = await loadLibraryRecords();
  const hydrated = await Promise.all(
    records.map(async (record) => ({
      ...record,
      fileExists: await exists(record.outputPath)
    }))
  );

  hydrated.sort((left, right) => right.downloadedAt.localeCompare(left.downloadedAt));
  return hydrated;
}

async function recordCompletedDownload(payload, outputPath) {
  const records = await loadLibraryRecords();
  const metadata = payload.metadata ?? {};
  const entry = {
    id: payload.id,
    title: metadata.title?.trim() || path.parse(outputPath).name,
    sourceUrl: payload.url,
    webpageUrl: metadata.webpageUrl ?? payload.url,
    outputPath,
    preset: payload.preset,
    durationSeconds: metadata.durationSeconds ?? null,
    publishedAt: metadata.publishedAt ?? null,
    downloadedAt: new Date().toISOString(),
    thumbnailUrl: metadata.thumbnailUrl ?? null,
    uploader: metadata.uploader ?? null
  };

  const next = records.filter((record) => record.id !== payload.id && record.outputPath !== outputPath);
  next.unshift(entry);
  await saveLibraryRecords(next.slice(0, 500));
}

async function validateThemeDirectory(themeRoot) {
  const manifestPath = path.join(themeRoot, "manifest.json");
  if (!(await exists(manifestPath))) {
    throw appError("THEME_ERROR", "Theme archive is missing manifest.json.");
  }

  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));

  if (!manifest.id || !themeIdValid(manifest.id)) {
    throw appError("THEME_ERROR", "Theme manifest must contain a safe id.");
  }

  if (!manifest.name || !manifest.entryCss) {
    throw appError("THEME_ERROR", "Theme manifest must contain name and entryCss.");
  }

  const cssPath = safeResolve(themeRoot, manifest.entryCss);
  if (!cssPath || !(await exists(cssPath))) {
    throw appError("THEME_ERROR", "Theme entryCss is missing or unsafe.");
  }

  const pathsToCheck = [
    manifest.previewImage,
    ...Object.values(manifest.assets ?? {}),
    ...(manifest.fonts ?? []).map((font) => font.file)
  ].filter(Boolean);

  for (const relativePath of pathsToCheck) {
    const resolved = safeResolve(themeRoot, relativePath);
    if (!resolved || !(await exists(resolved))) {
      throw appError("THEME_ERROR", `Missing or unsafe theme asset: ${relativePath}`);
    }
  }

  return manifest;
}

async function listThemes() {
  const settings = await loadSettings();
  const directoryEntries = await readdir(paths.themesDir, { withFileTypes: true });
  const records = [];

  for (const entry of directoryEntries) {
    if (!entry.isDirectory()) {
      continue;
    }

    try {
      const themeRoot = path.join(paths.themesDir, entry.name);
      const manifest = await validateThemeDirectory(themeRoot);
      records.push({
        manifest,
        active: manifest.id === settings.activeThemeId
      });
    } catch {
      continue;
    }
  }

  records.sort((left, right) => Number(right.active) - Number(left.active) || left.manifest.name.localeCompare(right.manifest.name));
  return records;
}

async function getThemeRecord(themeId) {
  const settings = await loadSettings();
  const themeRoot = path.join(paths.themesDir, themeId);
  const manifest = await validateThemeDirectory(themeRoot);

  return {
    manifest,
    active: settings.activeThemeId === themeId
  };
}

async function importTheme(filePath) {
  if (!(await exists(filePath))) {
    throw appError("IO_ERROR", `Theme archive not found: ${filePath}`);
  }

  const tempDir = await mkdtemp(path.join(os.tmpdir(), "dismas-theme-"));

  try {
    const zip = new AdmZip(filePath);
    let totalBytes = 0;

    for (const entry of zip.getEntries()) {
      if (entry.isDirectory) {
        continue;
      }

      const normalized = path.posix.normalize(entry.entryName.replaceAll("\\", "/"));
      if (!normalized || normalized.startsWith("../") || normalized.startsWith("/")) {
        throw appError("THEME_ERROR", `Unsafe theme entry path: ${entry.entryName}`);
      }

      const ext = path.posix.extname(normalized).toLowerCase();
      if (ext && !allowedThemeExtensions.has(ext)) {
        throw appError("THEME_ERROR", `Theme asset extension is not allowed: ${ext}`);
      }

      const data = entry.getData();
      totalBytes += data.byteLength;

      if (data.byteLength > 8 * 1024 * 1024) {
        throw appError("THEME_ERROR", `Theme asset is too large: ${entry.entryName}`);
      }

      if (totalBytes > 64 * 1024 * 1024) {
        throw appError("THEME_ERROR", "Theme archive exceeds the allowed size budget.");
      }

      const target = safeResolve(tempDir, normalized);
      if (!target) {
        throw appError("THEME_ERROR", `Unsafe extraction path: ${entry.entryName}`);
      }

      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, data);
    }

    const manifest = await validateThemeDirectory(tempDir);
    const destination = path.join(paths.themesDir, manifest.id);

    if (await exists(destination)) {
      throw appError("THEME_ERROR", `Theme id already exists: ${manifest.id}`);
    }

    await cp(tempDir, destination, { recursive: true });
    return getThemeRecord(manifest.id);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function exportTheme(themeId, outPath) {
  const themeRoot = path.join(paths.themesDir, themeId);
  await validateThemeDirectory(themeRoot);

  await mkdir(path.dirname(outPath), { recursive: true });
  const zip = new AdmZip();
  zip.addLocalFolder(themeRoot);
  zip.writeZip(outPath);

  return { exported: true, outPath };
}

function createGeneratedThemeCss() {
  return `:root {\n  --frame-texture: none;\n}\n\n.panel,\n.sidebar-card,\n.theme-card,\n.queue-item,\n.log-entry,\n.nav-button {\n  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.04), 0 18px 34px -26px rgba(0, 0, 0, 0.62);\n}\n`;
}

async function createTheme(payload) {
  if (!payload.id || !themeIdValid(payload.id)) {
    throw appError("VALIDATION_ERROR", "Theme id must use only lowercase letters, digits, _ or -.");
  }

  if (!payload.name) {
    throw appError("VALIDATION_ERROR", "Theme name is required.");
  }

  const themeRoot = path.join(paths.themesDir, payload.id);

  if (await exists(themeRoot)) {
    throw appError("THEME_ERROR", `Theme id already exists: ${payload.id}`);
  }

  await mkdir(path.join(themeRoot, "img"), { recursive: true });
  await mkdir(path.join(themeRoot, "fonts"), { recursive: true });

  const manifest = {
    schemaVersion: 1,
    id: payload.id,
    name: payload.name,
    version: "1.0.0",
    author: payload.author || "User",
    description: payload.description || "User-forged portable variant.",
    targetAppVersion: ">=0.1.0",
    entryCss: "theme.css",
    previewImage: undefined,
    fonts: [],
    variables: {
      "--bg": "#171110",
      "--panel": "#30251f",
      "--panel-strong": "#3a2c24",
      "--text": "#d8c7b4",
      "--muted": "#a69887",
      "--accent": "#8a0303",
      ...(payload.variables ?? {})
    },
    assets: {},
    modes: ["dark"],
    supportsCustomWallpaper: true
  };

  await writeFile(path.join(themeRoot, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  await writeFile(path.join(themeRoot, "theme.css"), createGeneratedThemeCss(), "utf8");

  return getThemeRecord(payload.id);
}

function buildToolEnv() {
  return {
    ...process.env,
    PATH: `${paths.libsDir}${path.delimiter}${process.env.PATH ?? ""}`
  };
}

async function requireBinary(fileName) {
  const binaryPath = path.join(paths.libsDir, fileName);
  if (!(await exists(binaryPath))) {
    const help =
      fileName === "deno.exe"
        ? [
            "Run `irm https://deno.land/install.ps1 | iex` and copy `deno.exe` into libs/.",
            "Place deno.exe into libs/.",
            "Keep the source URL, version, and license notice with the binary."
          ]
        : [
            `Place ${fileName} into libs/.`,
            "Keep the binary source URL, version, and license notice with the portable build."
          ];

    throw appError("BINARY_MISSING", `Missing required binary: ${fileName}`, {
      binary: fileName,
      expectedPath: binaryPath,
      help
    });
  }
  return binaryPath;
}

function normalizeFormats(formats) {
  if (!Array.isArray(formats)) {
    return [];
  }

  return formats.slice(0, 24).map((format) => ({
    id: String(format.format_id ?? "unknown"),
    ext: format.ext ?? null,
    resolution: format.resolution ?? null,
    note: format.format_note ?? format.acodec ?? null,
    audioOnly: format.vcodec === "none",
    videoOnly: format.acodec === "none"
  }));
}

function buildNetworkArgs(network) {
  const args = [];
  const strategy = network?.strategy ?? "direct";

  if (strategy === "proxy" && network?.proxyUrl) {
    args.push("--proxy", network.proxyUrl);
  }

  if (network?.impersonate) {
    args.push("--impersonate", network.impersonate);
  }

  if (network?.cookiesFromBrowser) {
    args.push("--cookies-from-browser", network.cookiesFromBrowser);
  }

  return args;
}

function classifyYtDlpError(stderr) {
  const text = stderr.trim();
  const lower = text.toLowerCase();

  if (lower.includes("video unavailable") || lower.includes("private video") || lower.includes("this video is unavailable")) {
    return appError("DOWNLOAD_ERROR", text || "The video is unavailable, private, or blocked for this session.", {
      category: "SOURCE",
      help: [
        "Check whether the video opens in the browser.",
        "If access is limited, try cookies from browser.",
        "If the provider blocks your route, try another network path."
      ]
    });
  }

  if (lower.includes("not a bot") || lower.includes("sign in to confirm")) {
    return appError("DOWNLOAD_ERROR", text || "Server-side anti-bot challenge encountered.", {
      category: "ANTI_BOT",
      help: [
        "Try cookies from browser.",
        "Try impersonation.",
        "Try a different network path or proxy."
      ]
    });
  }

  if (lower.includes("timed out") || lower.includes("connection") || lower.includes("proxy")) {
    return appError("DOWNLOAD_ERROR", text || "Network transport failed.", {
      category: "NETWORK",
      help: [
        "Check the proxy URL.",
        "Switch back to Direct mode to isolate the issue.",
        "If you use System DPI bypass, verify it is configured outside the app."
      ]
    });
  }

  return appError("DOWNLOAD_ERROR", text || "yt-dlp returned a non-zero exit code.");
}

async function runYtDlp(args) {
  const ytDlpPath = await requireBinary("yt-dlp.exe");
  const child = spawn(ytDlpPath, args, {
    cwd: paths.appRoot,
    env: buildToolEnv(),
    windowsHide: true
  });

  let stdout = "";
  let stderr = "";

  child.stdout.on("data", (chunk) => {
    stdout += chunk.toString();
  });

  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });

  const exitCode = await new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", resolve);
  });

  if (exitCode !== 0) {
    throw classifyYtDlpError(stderr);
  }

  return stdout.trim();
}

async function analyze(payload) {
  const url = typeof payload === "string" ? payload : String(payload?.url ?? "").trim();
  const network = typeof payload === "string" ? undefined : payload?.network;
  const parsedUrl = requireValidUrl(url);
  await requireBinary("yt-dlp.exe");

  if (["www.youtube.com", "youtube.com", "youtu.be", "m.youtube.com"].includes(parsedUrl.hostname)) {
    await requireBinary("deno.exe");
  }

  const stdout = await runYtDlp([
    "--dump-single-json",
    "--no-warnings",
    "--skip-download",
    ...buildNetworkArgs(network),
    url
  ]);
  const info = JSON.parse(stdout);

  return {
    url,
    webpageUrl: info.webpage_url ?? url,
    extractor: info.extractor_key ?? info.extractor ?? null,
    title: info.title ?? "Untitled",
    durationSeconds: typeof info.duration === "number" ? info.duration : null,
    publishedAt: derivePublishedAt(info),
    thumbnailUrl: info.thumbnail ?? null,
    uploader: info.uploader ?? info.channel ?? null,
    formats: normalizeFormats(info.formats)
  };
}

function parseHumanBytesPerSecond(value) {
  if (!value || typeof value !== "string") {
    return null;
  }

  const match = value.trim().match(/([\d.]+)\s*([KMGT]?i?B)\/s/i);
  if (!match) {
    return null;
  }

  const amount = Number.parseFloat(match[1]);
  const unit = match[2].toUpperCase();
  const multipliers = {
    B: 1,
    KB: 1000,
    MB: 1000 ** 2,
    GB: 1000 ** 3,
    TB: 1000 ** 4,
    KIB: 1024,
    MIB: 1024 ** 2,
    GIB: 1024 ** 3,
    TIB: 1024 ** 4
  };

  return Number.isFinite(amount) ? Math.round(amount * (multipliers[unit] ?? 1)) : null;
}

function maybeNumber(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const numeric = Number(String(value).replace(/[^\d.-]/g, ""));
  return Number.isFinite(numeric) ? numeric : null;
}

async function startDownload(payload) {
  requireValidUrl(payload.url);

  if (!payload.id || !payload.outputDir) {
    throw appError("VALIDATION_ERROR", "Download payload must include id and outputDir.");
  }

  if (activeDownloads.has(payload.id)) {
    throw appError("DOWNLOAD_ERROR", `Download id already exists: ${payload.id}`);
  }

  const ytDlpPath = await requireBinary("yt-dlp.exe");
  const ffmpegPath = await requireBinary("ffmpeg.exe");
  const parsedUrl = new URL(payload.url);

  if (["www.youtube.com", "youtube.com", "youtu.be", "m.youtube.com"].includes(parsedUrl.hostname)) {
    await requireBinary("deno.exe");
  }

  await mkdir(payload.outputDir, { recursive: true });

  const args = [
    "--newline",
    "--no-warnings",
    "--progress-template",
    "download:%(progress._percent_str)s|%(progress.downloaded_bytes)s|%(progress.total_bytes_estimate)s|%(progress.speed)s|%(progress.eta)s",
    "--ffmpeg-location",
    ffmpegPath,
    ...buildNetworkArgs(payload.network),
    "--output",
    path.join(payload.outputDir, "%(title).180B [%(id)s].%(ext)s")
  ];

  if (payload.preset === "mp3") {
    args.push("-x", "--audio-format", "mp3");
  } else {
    args.push("-f", "bv*+ba/b", "--merge-output-format", "mp4");
  }

  args.push(payload.url);

  emit("download.queued", {
    id: payload.id,
    preset: payload.preset,
    url: payload.url
  });

  const child = spawn(ytDlpPath, args, {
    cwd: paths.appRoot,
    env: buildToolEnv(),
    windowsHide: true
  });

  const record = {
    child,
    cancelled: false,
    outputPath: null,
    lastError: null
  };

  activeDownloads.set(payload.id, record);

  emit("download.started", { id: payload.id });

  child.stdout.on("data", (chunk) => {
    const lines = chunk
      .toString()
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    for (const line of lines) {
      if (line.startsWith("download:")) {
        const [prefixedPercent, downloadedBytes, totalBytes, speed, eta] = line.split("|");
        emit("download.progress", {
          id: payload.id,
          percent: maybeNumber(prefixedPercent.replace(/^download:/, "")),
          downloadedBytes: maybeNumber(downloadedBytes),
          totalBytes: maybeNumber(totalBytes),
          speedBytesPerSecond: parseHumanBytesPerSecond(speed),
          etaSeconds: maybeNumber(eta),
          stage: "download",
          message: line
        });
        continue;
      }

      const destinationMatch =
        line.match(/Destination:\s+(.+)$/) ||
        line.match(/Merging formats into\s+"(.+)"$/) ||
        line.match(/Destination:\s+"(.+)"$/);

      if (destinationMatch) {
        record.outputPath = destinationMatch[1].replace(/^"|"$/g, "");
      }
    }
  });

  child.stderr.on("data", (chunk) => {
    const message = chunk.toString().trim();
    if (!message) {
      return;
    }

    record.lastError = message;

    emit("download.progress", {
      id: payload.id,
      percent: null,
      downloadedBytes: null,
      totalBytes: null,
      speedBytesPerSecond: null,
      etaSeconds: null,
      stage: "stderr",
      message
    });
  });

  child.on("error", (error) => {
    activeDownloads.delete(payload.id);
    emit("download.failed", {
      id: payload.id,
      error: classifyYtDlpError(record.lastError ?? error.message)
    });
  });

  child.on("close", (code) => {
    activeDownloads.delete(payload.id);

    if (record.cancelled) {
      emit("download.cancelled", { id: payload.id });
      return;
    }

    if (code === 0) {
      if (record.outputPath) {
        void recordCompletedDownload(payload, record.outputPath);
      }

      emit("download.completed", {
        id: payload.id,
        outputPath: record.outputPath,
        message: "Payload secured"
      });
      return;
    }

    emit("download.failed", {
      id: payload.id,
      error: classifyYtDlpError(record.lastError ?? `yt-dlp exited with code ${code ?? "null"}.`)
    });
  });

  return { accepted: true, id: payload.id };
}

async function cancelDownload(id) {
  const active = activeDownloads.get(id);
  if (!active) {
    return { cancelled: false, id };
  }

  active.cancelled = true;
  active.child.kill();
  return { cancelled: true, id };
}

async function handleRequest(request) {
  switch (request.method) {
    case "system.ping":
      return { status: "ok", engine: "mock", version: "0.1.0-dev" };
    case "theme.list":
      return listThemes();
    case "theme.apply": {
      const id = String(request.params?.id ?? "").trim();
      const record = await getThemeRecord(id);
      await saveSettings({ activeThemeId: id });
      const applied = { ...record, active: true };
      emit("theme.applied", { theme: applied });
      return applied;
    }
    case "theme.import":
      return importTheme(String(request.params?.filePath ?? "").trim());
    case "theme.export":
      return exportTheme(String(request.params?.id ?? "").trim(), String(request.params?.outPath ?? "").trim());
    case "theme.create":
      return createTheme(request.params ?? {});
    case "download.analyze":
      return analyze(request.params ?? {});
    case "download.start":
      return startDownload(request.params ?? {});
    case "download.cancel":
      return cancelDownload(String(request.params?.id ?? "").trim());
    case "library.list":
      return listLibrary();
    default:
      throw appError("UNKNOWN", `Unknown sidecar method: ${request.method}`);
  }
}

await ensureLayout();

const stdin = readline.createInterface({ input: process.stdin });
stdin.on("line", async (line) => {
  if (!line.trim()) {
    return;
  }

  let request;

  try {
    request = JSON.parse(line);
    const result = await handleRequest(request);
    sendResult(request.id, result);
  } catch (error) {
    sendError(
      request?.id ?? "unknown",
      error?.code ? error : appError("UNKNOWN", error instanceof Error ? error.message : "Unknown sidecar failure.")
    );
  }
});
