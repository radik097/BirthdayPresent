import { contextBridge, ipcRenderer } from "electron";

import type {
  AppApi,
  CreateThemeRequest,
  DownloadEventEnvelope,
  DownloadRequest,
  NetworkSettings,
  ThemeEventEnvelope,
  ThemeSummary
} from "../shared/contracts";

type DownloadHandler = (event: DownloadEventEnvelope) => void;
type ThemeHandler = (event: ThemeEventEnvelope) => void;

const downloadHandlers = new Map<DownloadHandler, (event: Electron.IpcRendererEvent, payload: DownloadEventEnvelope) => void>();
const themeHandlers = new Map<ThemeHandler, (event: Electron.IpcRendererEvent, payload: ThemeEventEnvelope) => void>();

const api: AppApi = {
  analyzeUrl: (url, network?: NetworkSettings) => ipcRenderer.invoke("download:analyze", { url, network }),
  startDownload: (payload: DownloadRequest) => ipcRenderer.invoke("download:start", payload),
  cancelDownload: (id) => ipcRenderer.invoke("download:cancel", id),
  getSystemStatus: () => ipcRenderer.invoke("system:status"),
  repairRuntimeTools: () => ipcRenderer.invoke("system:repairTools"),
  openExternal: (url) => ipcRenderer.invoke("system:openExternal", url),
  getThemes: () => ipcRenderer.invoke("theme:list") as Promise<ThemeSummary[]>,
  applyTheme: (id) => ipcRenderer.invoke("theme:apply", id) as Promise<ThemeSummary>,
  importTheme: (filePath) => ipcRenderer.invoke("theme:import", filePath) as Promise<ThemeSummary>,
  exportTheme: (id, outPath) => ipcRenderer.invoke("theme:export", { id, outPath }),
  createTheme: (payload: CreateThemeRequest) => ipcRenderer.invoke("theme:create", payload) as Promise<ThemeSummary>,
  subscribeDownloadEvents: (handler) => {
    if (downloadHandlers.has(handler)) {
      return;
    }

    const wrapped = (_event: Electron.IpcRendererEvent, payload: DownloadEventEnvelope) => handler(payload);
    downloadHandlers.set(handler, wrapped);
    ipcRenderer.on("download:event", wrapped);
  },
  unsubscribeDownloadEvents: (handler) => {
    if (!handler) {
      for (const wrapped of downloadHandlers.values()) {
        ipcRenderer.removeListener("download:event", wrapped);
      }
      downloadHandlers.clear();
      return;
    }

    const wrapped = downloadHandlers.get(handler);
    if (!wrapped) {
      return;
    }

    ipcRenderer.removeListener("download:event", wrapped);
    downloadHandlers.delete(handler);
  },
  subscribeThemeEvents: (handler) => {
    if (themeHandlers.has(handler)) {
      return;
    }

    const wrapped = (_event: Electron.IpcRendererEvent, payload: ThemeEventEnvelope) => handler(payload);
    themeHandlers.set(handler, wrapped);
    ipcRenderer.on("theme:changed", wrapped);
  },
  unsubscribeThemeEvents: (handler) => {
    if (!handler) {
      for (const wrapped of themeHandlers.values()) {
        ipcRenderer.removeListener("theme:changed", wrapped);
      }
      themeHandlers.clear();
      return;
    }

    const wrapped = themeHandlers.get(handler);
    if (!wrapped) {
      return;
    }

    ipcRenderer.removeListener("theme:changed", wrapped);
    themeHandlers.delete(handler);
  }
};

contextBridge.exposeInMainWorld("appApi", api);
