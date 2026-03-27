import { app, BrowserWindow, ipcMain, nativeTheme, shell } from "electron";
import path from "node:path";

import type {
  AnalyzeRequest,
  AnalyzeResult,
  AppRpcError,
  CreateThemeRequest,
  DownloadRequest,
  LibraryEntry,
  SidecarEvent,
  StartDownloadResponse,
  SystemNoticePayload,
  ThemeEventEnvelope,
  ThemeRecord,
  ThemeSummary
} from "../shared/contracts";
import { ensurePortableLayout, getRuntimePaths } from "./app-paths";
import { registerDismasProtocol, toThemeAssetUrl } from "./protocol";
import { SidecarClient } from "./sidecar-client";
import { RuntimeToolInstaller } from "./tool-installer";

const runtimePaths = getRuntimePaths();

let mainWindow: BrowserWindow | null = null;

function decorateTheme(record: ThemeRecord): ThemeSummary {
  return {
    ...record.manifest,
    active: record.active,
    stylesheetUrl: toThemeAssetUrl(record.manifest.id, record.manifest.entryCss),
    previewUrl: record.manifest.previewImage
      ? toThemeAssetUrl(record.manifest.id, record.manifest.previewImage)
      : undefined
  };
}

function normalizeEventTheme(theme: ThemeRecord | ThemeSummary): ThemeSummary {
  return "manifest" in theme ? decorateTheme(theme) : theme;
}

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1360,
    height: 880,
    minWidth: 980,
    minHeight: 700,
    titleBarStyle: "hiddenInset",
    backgroundColor: "#120f0d",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true
    }
  });

  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));

  const devServerUrl = process.env.VITE_DEV_SERVER_URL;

  if (devServerUrl) {
    void window.loadURL(devServerUrl);
  } else {
    void window.loadFile(runtimePaths.rendererIndexHtml);
  }

  return window;
}

function forwardSidecarEvent(event: SidecarEvent): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  if (event.event === "theme.applied") {
    const payload: ThemeEventEnvelope = {
      event: "theme.applied",
      payload: {
        theme: normalizeEventTheme(event.payload.theme as ThemeRecord | ThemeSummary)
      }
    };

    mainWindow.webContents.send("theme:changed", payload);
    return;
  }

  mainWindow.webContents.send("download:event", event);
}

function themeAppliedEnvelope(record: ThemeRecord): ThemeEventEnvelope {
  return {
    event: "theme.applied",
    payload: {
      theme: decorateTheme(record)
    }
  };
}

function systemNoticeEnvelope(payload: SystemNoticePayload): SidecarEvent {
  return {
    event: "system.notice",
    payload
  };
}

function toIpcError(error: unknown): Error {
  const fallback: AppRpcError = {
    code: "UNKNOWN",
    message: error instanceof Error ? error.message : "Unhandled IPC failure.",
    recoverable: true
  };

  const payload =
    typeof error === "object" && error !== null && "code" in error && "message" in error
      ? (error as AppRpcError)
      : fallback;

  return new Error(JSON.stringify(payload));
}

async function bootstrap(): Promise<void> {
  await app.whenReady();
  nativeTheme.themeSource = "dark";

  await ensurePortableLayout(runtimePaths);
  registerDismasProtocol(runtimePaths);

  const sidecar = new SidecarClient(runtimePaths, forwardSidecarEvent);
  const installer = new RuntimeToolInstaller(runtimePaths, (payload) => {
    forwardSidecarEvent(systemNoticeEnvelope(payload));
  });

  const invokeSidecar = async <T>(method: string, params?: unknown): Promise<T> => {
    try {
      return await sidecar.request<T>(method, params);
    } catch (error) {
      throw toIpcError(error);
    }
  };

  ipcMain.handle("download:analyze", async (_event, payload: AnalyzeRequest) =>
    invokeSidecar<AnalyzeResult>("download.analyze", payload)
  );
  ipcMain.handle("download:start", async (_event, payload: DownloadRequest) =>
    invokeSidecar<StartDownloadResponse>("download.start", payload)
  );
  ipcMain.handle("download:cancel", async (_event, id: string) =>
    invokeSidecar<{ cancelled: boolean; id: string }>("download.cancel", { id })
  );
  ipcMain.handle("app:downloadsDir", async () => app.getPath("downloads"));
  ipcMain.handle("app:openPath", async (_event, targetPath: string) => {
    const error = await shell.openPath(targetPath);
    return { opened: error.length === 0, error: error || null };
  });
  ipcMain.handle("library:list", async () => invokeSidecar<LibraryEntry[]>("library.list"));
  ipcMain.handle("system:status", async () => sidecar.getSystemStatus());
  ipcMain.handle("system:repairTools", async () => {
    try {
      await installer.ensureCoreTools();
      return await sidecar.getSystemStatus();
    } catch (error) {
      throw toIpcError({
        code: "IO_ERROR",
        message: error instanceof Error ? error.message : "Failed to repair portable runtime tools.",
        recoverable: true
      } satisfies AppRpcError);
    }
  });
  ipcMain.handle("system:openExternal", async (_event, url: string) => {
    await shell.openExternal(url);
    return { opened: true };
  });

  ipcMain.handle("theme:list", async () => {
    const records = await invokeSidecar<ThemeRecord[]>("theme.list");
    return records.map(decorateTheme);
  });

  ipcMain.handle("theme:apply", async (_event, id: string) => {
    const record = await invokeSidecar<ThemeRecord>("theme.apply", { id });
    const event = themeAppliedEnvelope(record);
    mainWindow?.webContents.send("theme:changed", event);
    return decorateTheme(record);
  });

  ipcMain.handle("theme:import", async (_event, filePath: string) => {
    const record = await invokeSidecar<ThemeRecord>("theme.import", { filePath });
    return decorateTheme(record);
  });

  ipcMain.handle("theme:export", async (_event, payload: { id: string; outPath: string }) =>
    invokeSidecar<{ exported: true; outPath: string }>("theme.export", payload)
  );

  ipcMain.handle("theme:create", async (_event, payload: CreateThemeRequest) => {
    const record = await invokeSidecar<ThemeRecord>("theme.create", payload);
    return decorateTheme(record);
  });

  mainWindow = createWindow();

  try {
    await sidecar.start();
  } catch (error) {
    forwardSidecarEvent({
      event: "system.error",
      payload: {
        error: {
          code: "SIDECAR_UNAVAILABLE",
          message: error instanceof Error ? error.message : "Failed to start downloader core.",
          recoverable: true
        }
      }
    });
  }

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createWindow();
    }
  });

  app.on("before-quit", () => {
    void sidecar.stop();
  });
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

void bootstrap();
