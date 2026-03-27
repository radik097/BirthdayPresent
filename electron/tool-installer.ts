import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { access, copyFile, mkdir, mkdtemp, readdir, rename, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as WebReadableStream } from "node:stream/web";

import type { SystemNoticePayload } from "../shared/contracts";
import type { RuntimePaths } from "./app-paths";
import { FFMPEG_SOURCE, SEVEN_ZR_SOURCE, YT_DLP_SOURCE, type RuntimeToolSource } from "./tool-sources";

async function exists(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

export class RuntimeToolInstaller {
  private installPromise: Promise<boolean> | null = null;

  constructor(
    private readonly paths: RuntimePaths,
    private readonly emitNotice: (payload: SystemNoticePayload) => void
  ) {}

  async ensureCoreTools(): Promise<boolean> {
    if (this.installPromise) {
      return this.installPromise;
    }

    this.installPromise = this.installCoreTools();

    try {
      return await this.installPromise;
    } finally {
      this.installPromise = null;
    }
  }

  private async installCoreTools(): Promise<boolean> {
    await mkdir(this.paths.libsDir, { recursive: true });

    let changed = false;

    const ytDlpTarget = path.join(this.paths.libsDir, YT_DLP_SOURCE.fileName);
    if (!(await exists(ytDlpTarget))) {
      await this.downloadBinary(YT_DLP_SOURCE, ytDlpTarget);
      changed = true;
    }

    const ffmpegTarget = path.join(this.paths.libsDir, FFMPEG_SOURCE.fileName);
    if (!(await exists(ffmpegTarget))) {
      const sevenZrTarget = path.join(this.paths.libsDir, SEVEN_ZR_SOURCE.fileName);

      if (!(await exists(sevenZrTarget))) {
        await this.downloadBinary(SEVEN_ZR_SOURCE, sevenZrTarget);
        changed = true;
      }

      await this.installFfmpegFromArchive(sevenZrTarget, ffmpegTarget);
      changed = true;
    }

    if (changed) {
      this.emitNotice({
        title: "Runtime Tools Ready",
        message: "Missing portable tools were downloaded and installed. Refreshing system status now.",
        tone: "success",
        refreshStatus: true
      });
    }

    return changed;
  }

  private async downloadBinary(source: RuntimeToolSource, targetPath: string): Promise<void> {
    this.emitNotice({
      title: `Installing ${source.label}`,
      message: `Downloading ${source.fileName} from the configured direct source.`,
      tone: "info",
      steps: [source.url]
    });

    try {
      await this.downloadToFile(source.url, targetPath);
      this.emitNotice({
        title: `${source.label} installed`,
        message: `${source.fileName} is now available in libs/.`,
        tone: "success",
        refreshStatus: true
      });
    } catch (error) {
      this.emitNotice({
        title: `${source.label} download failed`,
        message: error instanceof Error ? error.message : `Failed to download ${source.fileName}.`,
        tone: "danger",
        steps: [
          `Direct source: ${source.url}`,
          `Manual fallback: place ${source.fileName} into ${this.paths.libsDir}`
        ]
      });
      throw error;
    }
  }

  private async installFfmpegFromArchive(sevenZrPath: string, targetPath: string): Promise<void> {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "dismas-ffmpeg-"));
    const archiveName = path.basename(new URL(FFMPEG_SOURCE.url).pathname) || "ffmpeg.7z";
    const archivePath = path.join(tempDir, archiveName);
    const extractDir = path.join(tempDir, "extract");

    this.emitNotice({
      title: "Installing ffmpeg",
      message: "Downloading the configured ffmpeg package and extracting ffmpeg.exe.",
      tone: "info",
      steps: [FFMPEG_SOURCE.url]
    });

    try {
      await mkdir(extractDir, { recursive: true });
      await this.downloadToFile(FFMPEG_SOURCE.url, archivePath);
      await this.runExtractor(sevenZrPath, archivePath, extractDir);

      const ffmpegSource = await this.findFileRecursive(extractDir, FFMPEG_SOURCE.fileName);
      if (!ffmpegSource) {
        throw new Error("The ffmpeg archive was downloaded, but ffmpeg.exe was not found inside it.");
      }

      await copyFile(ffmpegSource, targetPath);

      this.emitNotice({
        title: "ffmpeg installed",
        message: "ffmpeg.exe was extracted into libs/ and is ready for download presets.",
        tone: "success",
        refreshStatus: true
      });
    } catch (error) {
      this.emitNotice({
        title: "ffmpeg installation failed",
        message: error instanceof Error ? error.message : "Failed to install ffmpeg.exe from the downloaded archive.",
        tone: "danger",
        steps: [
          `Direct source: ${FFMPEG_SOURCE.url}`,
          `Manual fallback: extract ffmpeg.exe from the downloaded package and place it into ${this.paths.libsDir}`
        ]
      });
      throw error;
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  }

  private async downloadToFile(url: string, targetPath: string): Promise<void> {
    const response = await fetch(url);

    if (!response.ok || !response.body) {
      throw new Error(`Download request failed for ${url} with status ${response.status}.`);
    }

    const tempPath = `${targetPath}.partial`;
    const body = Readable.fromWeb(response.body as unknown as WebReadableStream);

    await pipeline(body, createWriteStream(tempPath));
    await rename(tempPath, targetPath);
  }

  private async runExtractor(sevenZrPath: string, archivePath: string, outDir: string): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const child = spawn(sevenZrPath, ["x", archivePath, `-o${outDir}`, "-y"], {
        cwd: this.paths.libsDir,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"]
      });

      let stderr = "";

      child.stderr.on("data", (chunk) => {
        stderr += chunk.toString();
      });

      child.on("error", reject);
      child.on("close", (code) => {
        if (code === 0) {
          resolve();
          return;
        }

        reject(new Error(stderr.trim() || `7zr exited with code ${code ?? "null"}.`));
      });
    });
  }

  private async findFileRecursive(rootDir: string, fileName: string): Promise<string | null> {
    const entries = await readdir(rootDir, { withFileTypes: true });

    for (const entry of entries) {
      const absolutePath = path.join(rootDir, entry.name);

      if (entry.isDirectory()) {
        const nested = await this.findFileRecursive(absolutePath, fileName);
        if (nested) {
          return nested;
        }
        continue;
      }

      if (entry.isFile() && entry.name.toLowerCase() === fileName.toLowerCase()) {
        return absolutePath;
      }
    }

    return null;
  }
}
