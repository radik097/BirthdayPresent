import { spawn } from "node:child_process";
import { access, cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import AdmZip from "adm-zip";

import type {
  AnalyzeRequest,
  AnalyzeResult,
  AppRpcError,
  CreateThemeRequest,
  DownloadMetadata,
  DownloadRequest,
  LibraryEntry,
  SidecarEvent,
  StartDownloadResponse,
  SystemStatus,
  ThemeRecord
} from "../shared/contracts";
import type { RuntimePaths } from "./app-paths";
import { collectSystemStatus } from "./system-status";

type DownloadRecord = {
  child: ReturnType<typeof spawn>;
  cancelled: boolean;
  outputPath: string | null;
  lastError: string | null;
};

function createError(code: AppRpcError["code"], message: string, details?: unknown): AppRpcError {
  return {
    code,
    message,
    details,
    recoverable: true
  };
}

async function exists(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

function safeResolve(basePath: string, relativePath: string): string | null {
  const normalized = relativePath.replaceAll("\\", "/");
  const resolved = path.resolve(basePath, ...normalized.split("/"));
  const relative = path.relative(basePath, resolved);

  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    return null;
  }

  return resolved;
}

function requireValidUrl(url: string): URL {
  let parsed: URL;

  try {
    parsed = new URL(url);
  } catch {
    throw createError("VALIDATION_ERROR", "Enter a valid http or https URL before starting.");
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw createError("VALIDATION_ERROR", "Only http and https URLs are supported.");
  }

  return parsed;
}

function themeIdValid(id: string): boolean {
  return /^[a-z0-9_-]+$/.test(id);
}

function buildToolEnv(paths: RuntimePaths): NodeJS.ProcessEnv {
  return {
    ...process.env,
    PATH: `${paths.libsDir}${path.delimiter}${process.env.PATH ?? ""}`
  };
}

function buildNetworkArgs(network: DownloadRequest["network"] | AnalyzeRequest["network"]): string[] {
  const args: string[] = [];
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

function classifyDownloadError(stderr: string): AppRpcError {
  const text = stderr.trim();
  const lower = text.toLowerCase();

  if (lower.includes("video unavailable") || lower.includes("private video") || lower.includes("this video is unavailable")) {
    return createError("DOWNLOAD_ERROR", text || "The video is unavailable, private, or blocked for this session.", {
      category: "SOURCE",
      help: [
        "Check whether the video opens in the browser.",
        "If access is limited, try cookies from browser.",
        "If the provider blocks your route, try another network path."
      ]
    });
  }

  if (lower.includes("not a bot") || lower.includes("sign in to confirm")) {
    return createError("DOWNLOAD_ERROR", text || "The provider requested an anti-bot sign-in challenge.", {
      category: "ANTI_BOT",
      help: [
        "Try cookies from browser.",
        "Try impersonation.",
        "Try a different network path or proxy."
      ]
    });
  }

  if (lower.includes("proxy") || lower.includes("timed out") || lower.includes("connection")) {
    return createError("DOWNLOAD_ERROR", text || "The network transport failed before the download could finish.", {
      category: "NETWORK",
      help: [
        "Check the proxy URL.",
        "Switch back to Direct mode to isolate the issue.",
        "If you use System DPI bypass, verify it is already configured outside the app."
      ]
    });
  }

  return createError("DOWNLOAD_ERROR", text || "The download engine returned an unexpected error.");
}

function createGeneratedThemeCss(): string {
  return `:root {\n  --frame-texture: none;\n}\n\n.panel,\n.sidebar-card,\n.theme-card,\n.queue-item,\n.log-entry,\n.nav-button {\n  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.04), 0 18px 34px -26px rgba(0, 0, 0, 0.62);\n}\n`;
}

function parseCompactDate(value: string | null | undefined): string | null {
  if (!value || !/^\d{8}$/.test(value)) {
    return null;
  }

  const year = value.slice(0, 4);
  const month = value.slice(4, 6);
  const day = value.slice(6, 8);
  return `${year}-${month}-${day}T00:00:00.000Z`;
}

function derivePublishedAt(info: Record<string, unknown>): string | null {
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

export class FallbackService {
  private readonly allowedThemeExtensions = new Set([
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

  private readonly downloads = new Map<string, DownloadRecord>();

  constructor(
    private readonly paths: RuntimePaths,
    private readonly onEvent: (event: SidecarEvent) => void
  ) {}

  async start(): Promise<void> {
    return;
  }

  async stop(): Promise<void> {
    for (const download of this.downloads.values()) {
      download.cancelled = true;
      download.child.kill();
    }
    this.downloads.clear();
  }

  async request<T>(method: string, params?: unknown): Promise<T> {
    switch (method) {
      case "system.ping":
        return { status: "ok", engine: "mock", version: "node-fallback" } as T;
      case "system.status":
        return (await this.getSystemStatus()) as T;
      case "theme.list":
        return (await this.listThemes()) as T;
      case "theme.apply":
        return (await this.applyTheme(String((params as { id?: string } | undefined)?.id ?? "").trim())) as T;
      case "theme.import":
        return (await this.importTheme(String((params as { filePath?: string } | undefined)?.filePath ?? "").trim())) as T;
      case "theme.export":
        return (await this.exportTheme(
          String((params as { id?: string } | undefined)?.id ?? "").trim(),
          String((params as { outPath?: string } | undefined)?.outPath ?? "").trim()
        )) as T;
      case "theme.create":
        return (await this.createTheme((params ?? {}) as CreateThemeRequest)) as T;
      case "download.analyze":
        return (await this.analyze((params ?? {}) as AnalyzeRequest)) as T;
      case "download.start":
        return (await this.startDownload((params ?? {}) as DownloadRequest)) as T;
      case "download.cancel":
        return (await this.cancelDownload(String((params as { id?: string } | undefined)?.id ?? "").trim())) as T;
      case "library.list":
        return (await this.listLibrary()) as T;
      default:
        throw createError("UNKNOWN", `The fallback backend does not know how to handle: ${method}`);
    }
  }

  async getSystemStatus(): Promise<SystemStatus> {
    return collectSystemStatus(this.paths, "node-fallback", "node-fallback");
  }

  private async requireBinary(fileName: string): Promise<string> {
    const binaryPath = path.join(this.paths.libsDir, fileName);
    if (!(await exists(binaryPath))) {
      const denoHelp =
        fileName === "deno.exe"
          ? [
              "Run `irm https://deno.land/install.ps1 | iex` and copy `deno.exe` into libs/.",
              "Place deno.exe into libs/.",
              "Keep the source URL, version, and license notice with the binary."
            ]
          : [
              `Place ${fileName} into libs/.`,
              "Keep the source URL, version, and license notice with the binary."
            ];

      throw createError("BINARY_MISSING", `Missing required binary: ${fileName}`, {
        binary: fileName,
        expectedPath: binaryPath,
        help: denoHelp
      });
    }
    return binaryPath;
  }

  private async loadSettings(): Promise<{ activeThemeId: string }> {
    try {
      const raw = await readFile(this.paths.settingsFile, "utf8");
      const parsed = JSON.parse(raw) as { activeThemeId?: string };
      return {
        activeThemeId: parsed.activeThemeId || "default_darkest"
      };
    } catch {
      return {
        activeThemeId: "default_darkest"
      };
    }
  }

  private async saveSettings(settings: { activeThemeId: string }): Promise<void> {
    await writeFile(this.paths.settingsFile, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
  }

  private async loadLibraryRecords(): Promise<Omit<LibraryEntry, "fileExists">[]> {
    try {
      const raw = await readFile(this.paths.libraryFile, "utf8");
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? (parsed as Omit<LibraryEntry, "fileExists">[]) : [];
    } catch {
      return [];
    }
  }

  private async saveLibraryRecords(records: Omit<LibraryEntry, "fileExists">[]): Promise<void> {
    await writeFile(this.paths.libraryFile, `${JSON.stringify(records, null, 2)}\n`, "utf8");
  }

  private async listLibrary(): Promise<LibraryEntry[]> {
    const records = await this.loadLibraryRecords();
    const hydrated = await Promise.all(
      records.map(async (record) => ({
        ...record,
        fileExists: await exists(record.outputPath)
      }))
    );

    hydrated.sort((left, right) => right.downloadedAt.localeCompare(left.downloadedAt));
    return hydrated;
  }

  private async recordCompletedDownload(
    payload: DownloadRequest,
    outputPath: string,
    metadata?: DownloadMetadata | null
  ): Promise<void> {
    const records = await this.loadLibraryRecords();
    const entry: Omit<LibraryEntry, "fileExists"> = {
      id: payload.id,
      title: metadata?.title?.trim() || path.parse(outputPath).name,
      sourceUrl: payload.url,
      webpageUrl: metadata?.webpageUrl ?? payload.url,
      outputPath,
      preset: payload.preset,
      durationSeconds: metadata?.durationSeconds ?? null,
      publishedAt: metadata?.publishedAt ?? null,
      downloadedAt: new Date().toISOString(),
      thumbnailUrl: metadata?.thumbnailUrl ?? null,
      uploader: metadata?.uploader ?? null
    };

    const next = records.filter((record) => record.id !== payload.id && record.outputPath !== outputPath);
    next.unshift(entry);
    await this.saveLibraryRecords(next.slice(0, 500));
  }

  private async validateThemeDirectory(themeRoot: string): Promise<ThemeRecord["manifest"]> {
    const manifestPath = path.join(themeRoot, "manifest.json");
    if (!(await exists(manifestPath))) {
      throw createError("THEME_ERROR", "Theme archive is missing manifest.json.");
    }

    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as ThemeRecord["manifest"];

    if (!manifest.id || !themeIdValid(manifest.id)) {
      throw createError("THEME_ERROR", "Theme manifest must contain a safe id.");
    }

    if (!manifest.name || !manifest.entryCss) {
      throw createError("THEME_ERROR", "Theme manifest must contain name and entryCss.");
    }

    const cssPath = safeResolve(themeRoot, manifest.entryCss);
    if (!cssPath || !(await exists(cssPath))) {
      throw createError("THEME_ERROR", "Theme entryCss is missing or unsafe.");
    }

    const pathsToCheck = [
      manifest.previewImage,
      ...Object.values(manifest.assets ?? {}),
      ...(manifest.fonts ?? []).map((font) => font.file)
    ].filter(Boolean) as string[];

    for (const relativePath of pathsToCheck) {
      const resolved = safeResolve(themeRoot, relativePath);
      if (!resolved || !(await exists(resolved))) {
        throw createError("THEME_ERROR", `Missing or unsafe theme asset: ${relativePath}`);
      }
    }

    return manifest;
  }

  private async getThemeRecord(themeId: string): Promise<ThemeRecord> {
    const settings = await this.loadSettings();
    const themeRoot = path.join(this.paths.themesDir, themeId);
    const manifest = await this.validateThemeDirectory(themeRoot);

    return {
      manifest,
      active: settings.activeThemeId === themeId
    };
  }

  private async listThemes(): Promise<ThemeRecord[]> {
    const settings = await this.loadSettings();
    const entries = await readdir(this.paths.themesDir, { withFileTypes: true });
    const records: ThemeRecord[] = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }

      try {
        const manifest = await this.validateThemeDirectory(path.join(this.paths.themesDir, entry.name));
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

  private async applyTheme(id: string): Promise<ThemeRecord> {
    const record = await this.getThemeRecord(id);
    await this.saveSettings({ activeThemeId: id });
    const applied = { ...record, active: true };
    this.onEvent({
      event: "theme.applied",
      payload: {
        theme: applied
      }
    });
    return applied;
  }

  private async importTheme(filePath: string): Promise<ThemeRecord> {
    if (!(await exists(filePath))) {
      throw createError("IO_ERROR", `Theme archive not found: ${filePath}`);
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
          throw createError("THEME_ERROR", `Unsafe theme entry path: ${entry.entryName}`);
        }

        const ext = path.posix.extname(normalized).toLowerCase();
        if (ext && !this.allowedThemeExtensions.has(ext)) {
          throw createError("THEME_ERROR", `Theme asset extension is not allowed: ${ext}`);
        }

        const data = entry.getData();
        totalBytes += data.byteLength;

        if (data.byteLength > 8 * 1024 * 1024) {
          throw createError("THEME_ERROR", `Theme asset is too large: ${entry.entryName}`);
        }

        if (totalBytes > 64 * 1024 * 1024) {
          throw createError("THEME_ERROR", "Theme archive exceeds the allowed size budget.");
        }

        const target = safeResolve(tempDir, normalized);
        if (!target) {
          throw createError("THEME_ERROR", `Unsafe extraction path: ${entry.entryName}`);
        }

        await mkdir(path.dirname(target), { recursive: true });
        await writeFile(target, data);
      }

      const manifest = await this.validateThemeDirectory(tempDir);
      const destination = path.join(this.paths.themesDir, manifest.id);

      if (await exists(destination)) {
        throw createError("THEME_ERROR", `Theme id already exists: ${manifest.id}`);
      }

      await cp(tempDir, destination, { recursive: true });
      return this.getThemeRecord(manifest.id);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  }

  private async exportTheme(id: string, outPath: string): Promise<{ exported: true; outPath: string }> {
    const themeRoot = path.join(this.paths.themesDir, id);
    await this.validateThemeDirectory(themeRoot);

    await mkdir(path.dirname(outPath), { recursive: true });
    const zip = new AdmZip();
    zip.addLocalFolder(themeRoot);
    zip.writeZip(outPath);

    return { exported: true, outPath };
  }

  private async createTheme(payload: CreateThemeRequest): Promise<ThemeRecord> {
    if (!payload.id || !themeIdValid(payload.id)) {
      throw createError("VALIDATION_ERROR", "Theme id must use only lowercase letters, digits, _ or -.");
    }

    if (!payload.name) {
      throw createError("VALIDATION_ERROR", "Theme name is required.");
    }

    const themeRoot = path.join(this.paths.themesDir, payload.id);

    if (await exists(themeRoot)) {
      throw createError("THEME_ERROR", `Theme id already exists: ${payload.id}`);
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

    return this.getThemeRecord(payload.id);
  }

  private normalizeFormats(formats: unknown): AnalyzeResult["formats"] {
    if (!Array.isArray(formats)) {
      return [];
    }

    return formats.slice(0, 24).map((format) => {
      const current = format as Record<string, unknown>;
      return {
        id: String(current.format_id ?? "unknown"),
        ext: typeof current.ext === "string" ? current.ext : null,
        resolution: typeof current.resolution === "string" ? current.resolution : null,
        note:
          typeof current.format_note === "string"
            ? current.format_note
            : typeof current.acodec === "string"
              ? current.acodec
              : null,
        audioOnly: current.vcodec === "none",
        videoOnly: current.acodec === "none"
      };
    });
  }

  private async runYtDlp(args: string[]): Promise<string> {
    const ytDlpPath = await this.requireBinary("yt-dlp.exe");
    const child = spawn(ytDlpPath, args, {
      cwd: this.paths.appRoot,
      env: buildToolEnv(this.paths),
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

    const exitCode = await new Promise<number | null>((resolve, reject) => {
      child.on("error", reject);
      child.on("close", resolve);
    });

    if (exitCode !== 0) {
      throw classifyDownloadError(stderr);
    }

    return stdout.trim();
  }

  private async analyze(payload: AnalyzeRequest): Promise<AnalyzeResult> {
    const url = String(payload.url ?? "").trim();
    const parsedUrl = requireValidUrl(url);
    await this.requireBinary("yt-dlp.exe");

    if (["www.youtube.com", "youtube.com", "youtu.be", "m.youtube.com"].includes(parsedUrl.hostname)) {
      await this.requireBinary("deno.exe");
    }

    const stdout = await this.runYtDlp([
      "--dump-single-json",
      "--no-warnings",
      "--skip-download",
      ...buildNetworkArgs(payload.network),
      url
    ]);

    const info = JSON.parse(stdout) as Record<string, unknown>;

    return {
      url,
      webpageUrl: typeof info.webpage_url === "string" ? info.webpage_url : url,
      extractor:
        typeof info.extractor_key === "string"
          ? info.extractor_key
          : typeof info.extractor === "string"
            ? info.extractor
            : null,
      title: typeof info.title === "string" ? info.title : "Untitled",
      durationSeconds: typeof info.duration === "number" ? info.duration : null,
      thumbnailUrl: typeof info.thumbnail === "string" ? info.thumbnail : null,
      uploader:
        typeof info.uploader === "string"
          ? info.uploader
          : typeof info.channel === "string"
            ? info.channel
            : null,
      publishedAt: derivePublishedAt(info),
      formats: this.normalizeFormats(info.formats)
    };
  }

  private parseHumanBytesPerSecond(value: string | null): number | null {
    if (!value) {
      return null;
    }

    const match = value.trim().match(/([\d.]+)\s*([KMGT]?i?B)\/s/i);
    if (!match) {
      return null;
    }

    const amount = Number.parseFloat(match[1]);
    const unit = match[2].toUpperCase();
    const multipliers: Record<string, number> = {
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

  private maybeNumber(value: string | null | undefined): number | null {
    if (!value) {
      return null;
    }

    const numeric = Number(String(value).replace(/[^\d.-]/g, ""));
    return Number.isFinite(numeric) ? numeric : null;
  }

  private async startDownload(payload: DownloadRequest): Promise<StartDownloadResponse> {
    requireValidUrl(payload.url);

    if (!payload.id || !payload.outputDir) {
      throw createError("VALIDATION_ERROR", "Download payload must include id and outputDir.");
    }

    if (this.downloads.has(payload.id)) {
      throw createError("DOWNLOAD_ERROR", `Download id already exists: ${payload.id}`);
    }

    const ytDlpPath = await this.requireBinary("yt-dlp.exe");
    const ffmpegPath = await this.requireBinary("ffmpeg.exe");
    const parsedUrl = new URL(payload.url);

    if (["www.youtube.com", "youtube.com", "youtu.be", "m.youtube.com"].includes(parsedUrl.hostname)) {
      await this.requireBinary("deno.exe");
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

    this.onEvent({
      event: "download.queued",
      payload: {
        id: payload.id,
        preset: payload.preset,
        url: payload.url
      }
    });

    const child = spawn(ytDlpPath, args, {
      cwd: this.paths.appRoot,
      env: buildToolEnv(this.paths),
      windowsHide: true
    });

    const record: DownloadRecord = {
      child,
      cancelled: false,
      outputPath: null,
      lastError: null
    };

    this.downloads.set(payload.id, record);

    this.onEvent({
      event: "download.started",
      payload: { id: payload.id }
    });

    child.stdout.on("data", (chunk) => {
      const lines = chunk
        .toString()
        .split(/\r?\n/)
        .map((line: string) => line.trim())
        .filter(Boolean);

      for (const line of lines) {
        if (line.startsWith("download:")) {
          const [prefixedPercent, downloadedBytes, totalBytes, speed, eta] = line.split("|");
          this.onEvent({
            event: "download.progress",
            payload: {
              id: payload.id,
              percent: this.maybeNumber(prefixedPercent.replace(/^download:/, "")),
              downloadedBytes: this.maybeNumber(downloadedBytes),
              totalBytes: this.maybeNumber(totalBytes),
              speedBytesPerSecond: this.parseHumanBytesPerSecond(speed),
              etaSeconds: this.maybeNumber(eta),
              stage: "download",
              message: line
            }
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

      this.onEvent({
        event: "download.progress",
        payload: {
          id: payload.id,
          percent: null,
          downloadedBytes: null,
          totalBytes: null,
          speedBytesPerSecond: null,
          etaSeconds: null,
          stage: "stderr",
          message
        }
      });
    });

    child.on("error", (error) => {
      this.downloads.delete(payload.id);
      this.onEvent({
        event: "download.failed",
        payload: {
          id: payload.id,
          error: classifyDownloadError(record.lastError ?? error.message)
        }
      });
    });

    child.on("close", (code) => {
      this.downloads.delete(payload.id);

      if (record.cancelled) {
        this.onEvent({
          event: "download.cancelled",
          payload: { id: payload.id }
        });
        return;
      }

      if (code === 0) {
        if (record.outputPath) {
          void this.recordCompletedDownload(payload, record.outputPath, payload.metadata);
        }

        this.onEvent({
          event: "download.completed",
          payload: {
            id: payload.id,
            outputPath: record.outputPath,
            message: "Payload secured"
          }
        });
        return;
      }

      this.onEvent({
        event: "download.failed",
        payload: {
          id: payload.id,
          error: classifyDownloadError(record.lastError ?? `yt-dlp exited with code ${code ?? "null"}.`)
        }
      });
    });

    return { accepted: true, id: payload.id };
  }

  private async cancelDownload(id: string): Promise<{ cancelled: boolean; id: string }> {
    const active = this.downloads.get(id);
    if (!active) {
      return { cancelled: false, id };
    }

    active.cancelled = true;
    active.child.kill();
    return { cancelled: true, id };
  }
}
