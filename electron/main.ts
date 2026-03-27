import { app, BrowserWindow, ipcMain, nativeTheme } from "electron";
import path from "node:path";

import type {
  AnalyzeRequest,
  AnalyzeResult,
  AppRpcError,
  CreateThemeRequest,
  DownloadRequest,
  SidecarEvent,
  StartDownloadResponse,
  ThemeEventEnvelope,
  ThemeRecord,
  ThemeSummary
} from "../shared/contracts";
import { ensurePortableLayout, getRuntimePaths } from "./app-paths";
import { registerDismasProtocol, toThemeAssetUrl } from "./protocol";
import { SidecarClient } from "./sidecar-client";

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
    width: 1440,
    height: 960,
    minWidth: 1180,
    minHeight: 760,
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
    window.webContents.openDevTools({ mode: "detach" });
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
  ipcMain.handle("system:status", async () => sidecar.getSystemStatus());

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
