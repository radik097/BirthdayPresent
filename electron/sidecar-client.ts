import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { access } from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";

import { app } from "electron";

import type { AppRpcError, SidecarEvent, SidecarMode, SystemStatus } from "../shared/contracts";
import type { RuntimePaths } from "./app-paths";
import { FallbackService } from "./fallback-service";
import { collectSystemStatus } from "./system-status";

interface RequestEnvelope {
  id: string;
  method: string;
  params?: unknown;
}

interface ResponseEnvelope {
  id: string;
  result?: unknown;
  error?: AppRpcError;
}

interface SidecarCommand {
  mode: SidecarMode;
  command: string;
  args: string[];
  env?: NodeJS.ProcessEnv;
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason: AppRpcError) => void;
  timeout: NodeJS.Timeout;
}

function createError(code: AppRpcError["code"], message: string, details?: unknown): AppRpcError {
  return {
    code,
    message,
    details,
    recoverable: true
  };
}

async function fileExists(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function resolveSidecarCommand(paths: RuntimePaths): Promise<SidecarCommand | null> {
  const packagedBinary = path.join(paths.libsDir, "downloader-core.exe");
  const devCandidates = [
    packagedBinary,
    path.join(paths.appRoot, "src-native", "target", "debug", "downloader-core.exe"),
    path.join(paths.appRoot, "src-native", "target", "release", "downloader-core.exe")
  ];

  for (const candidate of devCandidates) {
    if (await fileExists(candidate)) {
      return {
        mode: "rust-exe",
        command: candidate,
        args: [],
        env: {
          ...process.env,
          DISMAS_BASE_DIR: paths.appRoot
        }
      };
    }
  }

  if (!app.isPackaged) {
    const mockScript = path.join(paths.appRoot, "scripts", "mock-sidecar.mjs");

    if (await fileExists(mockScript)) {
      return {
        mode: "mock-child",
        command: process.execPath,
        args: [mockScript],
        env: {
          ...process.env,
          ELECTRON_RUN_AS_NODE: "1",
          DISMAS_BASE_DIR: paths.appRoot
        }
      };
    }
  }

  return null;
}

export class SidecarClient {
  private child: ChildProcessWithoutNullStreams | null = null;
  private fallback: FallbackService | null = null;
  private pending = new Map<string, PendingRequest>();
  private startPromise: Promise<void> | null = null;
  private sequence = 0;
  private mode: SidecarMode = "unavailable";
  private version: string | null = null;
  private preferFallback = false;

  constructor(
    private readonly paths: RuntimePaths,
    private readonly onEvent: (event: SidecarEvent) => void
  ) {}

  async start(): Promise<void> {
    if (this.child) {
      return;
    }

    if (this.startPromise) {
      return this.startPromise;
    }

    this.startPromise = this.spawnProcess();

    try {
      await this.startPromise;
    } finally {
      this.startPromise = null;
    }
  }

  async request<T>(method: string, params?: unknown): Promise<T> {
    await this.start();

    if (this.fallback) {
      return this.fallback.request<T>(method, params);
    }

    if (!this.child?.stdin.writable) {
      throw createError(
        "SIDECAR_UNAVAILABLE",
        "The downloader core is unavailable. Build downloader-core.exe or run the dev mock sidecar."
      );
    }

    const id = `rpc-${Date.now()}-${this.sequence++}`;
    const payload: RequestEnvelope = { id, method, params };

    const promise = new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(createError("SIDECAR_UNAVAILABLE", `Timed out waiting for sidecar response: ${method}`));
      }, 30000);

      this.pending.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
        timeout
      });
    });

    this.child.stdin.write(`${JSON.stringify(payload)}\n`);

    return promise;
  }

  async stop(): Promise<void> {
    if (this.fallback) {
      await this.fallback.stop();
      this.fallback = null;
      this.mode = "unavailable";
      this.version = null;
      return;
    }

    if (!this.child) {
      return;
    }

    const child = this.child;
    this.child = null;
    this.version = null;

    for (const [requestId, pending] of this.pending) {
      clearTimeout(pending.timeout);
      pending.reject(createError("SIDECAR_UNAVAILABLE", "The downloader core exited before responding."));
      this.pending.delete(requestId);
    }

    child.kill();
  }

  async getSystemStatus(): Promise<SystemStatus> {
    try {
      await this.start();
    } catch {
      return collectSystemStatus(this.paths, this.mode, this.version);
    }

    if (this.fallback) {
      return this.fallback.getSystemStatus();
    }

    try {
      return await this.request<SystemStatus>("system.status");
    } catch {
      return collectSystemStatus(this.paths, this.mode, this.version);
    }
  }

  private async spawnProcess(): Promise<void> {
    if (this.preferFallback) {
      await this.activateFallback("The app is staying on its embedded fallback backend after an earlier native failure.");
      return;
    }

    const command = await resolveSidecarCommand(this.paths);

    if (!command) {
      await this.activateFallback("The Rust downloader core was not found, so the app switched to its embedded fallback backend.");
      return;
    }

    const child = spawn(command.command, command.args, {
      cwd: this.paths.appRoot,
      env: command.env,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true
    });

    this.child = child;
    this.mode = command.mode;

    const stdout = readline.createInterface({ input: child.stdout });
    stdout.on("line", (line) => this.handleLine(line));

    const stderr = readline.createInterface({ input: child.stderr });
    stderr.on("line", (line) => {
      if (!line.trim()) {
        return;
      }

      this.onEvent({
        event: "system.error",
        payload: {
          error: createError("UNKNOWN", line.trim())
        }
      });
    });

    child.on("exit", (code, signal) => {
      this.child = null;
      this.version = null;
      this.preferFallback = true;

      for (const [requestId, pending] of this.pending) {
        clearTimeout(pending.timeout);
        pending.reject(
          createError(
            "SIDECAR_UNAVAILABLE",
            `The downloader core exited unexpectedly (code: ${code ?? "null"}, signal: ${signal ?? "null"}).`
          )
        );
        this.pending.delete(requestId);
      }

      this.onEvent({
        event: "system.error",
        payload: {
          error: createError(
            "SIDECAR_UNAVAILABLE",
            `Download engine stopped (code: ${code ?? "null"}, signal: ${signal ?? "null"}). Active transfers were interrupted, and the app is switching to its embedded recovery backend.`
          )
        }
      });

      void this.activateFallback("The native downloader core stopped unexpectedly, so the embedded recovery backend was activated.");
    });

    try {
      const ping = await this.request<{ status: string; version?: string }>("system.ping");
      this.version = ping.version ?? null;
    } catch {
      this.version = null;
      this.preferFallback = true;
      this.child.kill();
      this.child = null;
      await this.activateFallback("The native downloader core started but did not answer health checks, so the app switched to its embedded fallback backend.");
    }
  }

  private async activateFallback(reason: string): Promise<void> {
    if (this.fallback) {
      return;
    }

    const fallback = new FallbackService(this.paths, this.onEvent);
    await fallback.start();
    this.fallback = fallback;
    this.mode = "node-fallback";
    this.version = "node-fallback";

    this.onEvent({
      event: "system.error",
      payload: {
        error: createError("SIDECAR_UNAVAILABLE", reason)
      }
    });
  }

  private handleLine(line: string): void {
    const trimmed = line.trim();

    if (!trimmed) {
      return;
    }

    let parsed: ResponseEnvelope | SidecarEvent;

    try {
      parsed = JSON.parse(trimmed) as ResponseEnvelope | SidecarEvent;
    } catch {
      this.onEvent({
        event: "system.error",
        payload: {
          error: createError("UNKNOWN", `Failed to parse sidecar output: ${trimmed}`)
        }
      });
      return;
    }

    if ("event" in parsed) {
      this.onEvent(parsed);
      return;
    }

    const pending = this.pending.get(parsed.id);

    if (!pending) {
      return;
    }

    clearTimeout(pending.timeout);
    this.pending.delete(parsed.id);

    if (parsed.error) {
      pending.reject(parsed.error);
      return;
    }

    pending.resolve(parsed.result);
  }
}
