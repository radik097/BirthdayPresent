export type AppErrorCode =
  | "SIDECAR_UNAVAILABLE"
  | "BINARY_MISSING"
  | "VALIDATION_ERROR"
  | "DOWNLOAD_ERROR"
  | "THEME_ERROR"
  | "IO_ERROR"
  | "SYSTEM_STATUS"
  | "UNKNOWN";

export interface AppRpcError {
  code: AppErrorCode;
  message: string;
  details?: unknown;
  recoverable?: boolean;
}

export type SidecarMode = "rust-exe" | "mock-child" | "node-fallback" | "unavailable";
export type ComponentAvailability = "ready" | "warning" | "missing" | "fallback";

export interface SystemComponentStatus {
  id: string;
  label: string;
  availability: ComponentAvailability;
  summary: string;
  path?: string | null;
  sourceUrl?: string | null;
  autoInstall?: boolean;
  requiredFor: string[];
  help: string[];
}

export interface SystemStatus {
  appMode: "development" | "packaged";
  os: string;
  sidecarMode: SidecarMode;
  sidecarVersion?: string | null;
  components: SystemComponentStatus[];
  capabilities: {
    canAnalyze: boolean;
    canDownload: boolean;
    canUseYoutube: boolean;
    canManageThemes: boolean;
  };
  notices: string[];
}

export interface AppSettings {
  activeThemeId: string;
}

export interface ThemeFontDefinition {
  family: string;
  file: string;
  weight?: string;
  style?: string;
}

export interface ThemeManifest {
  schemaVersion: number;
  id: string;
  name: string;
  version: string;
  author: string;
  description?: string;
  targetAppVersion?: string;
  entryCss: string;
  previewImage?: string;
  fonts?: ThemeFontDefinition[];
  variables?: Record<string, string>;
  assets?: Record<string, string>;
  modes?: string[];
  supportsCustomWallpaper?: boolean;
}

export interface ThemeRecord {
  manifest: ThemeManifest;
  active: boolean;
}

export interface ThemeSummary extends ThemeManifest {
  active: boolean;
  stylesheetUrl: string;
  previewUrl?: string;
}

export interface AnalyzeFormat {
  id: string;
  ext: string | null;
  resolution: string | null;
  note: string | null;
  audioOnly: boolean;
  videoOnly: boolean;
}

export interface AnalyzeResult {
  url: string;
  webpageUrl: string;
  extractor: string | null;
  title: string;
  durationSeconds: number | null;
  thumbnailUrl: string | null;
  uploader: string | null;
  formats: AnalyzeFormat[];
}

export type NetworkStrategy = "direct" | "proxy" | "system-bypass";

export interface NetworkSettings {
  strategy: NetworkStrategy;
  proxyUrl?: string | null;
  impersonate?: string | null;
  cookiesFromBrowser?: string | null;
}

export interface AnalyzeRequest {
  url: string;
  network?: NetworkSettings;
}

export type DownloadPreset = "best" | "mp3";

export interface DownloadRequest {
  id: string;
  url: string;
  outputDir: string;
  preset: DownloadPreset;
  network?: NetworkSettings;
}

export interface DownloadQueuedPayload {
  id: string;
  preset: DownloadPreset;
  url: string;
}

export interface DownloadStartedPayload {
  id: string;
}

export interface DownloadProgressPayload {
  id: string;
  percent: number | null;
  downloadedBytes: number | null;
  totalBytes: number | null;
  speedBytesPerSecond: number | null;
  etaSeconds: number | null;
  stage?: string | null;
  message?: string | null;
}

export interface DownloadCompletedPayload {
  id: string;
  outputPath?: string | null;
  message?: string | null;
}

export interface DownloadFailedPayload {
  id: string;
  error: AppRpcError;
}

export interface DownloadCancelledPayload {
  id: string;
}

export interface ThemeAppliedPayload {
  theme: ThemeSummary | ThemeRecord;
}

export interface SystemErrorPayload {
  error: AppRpcError;
}

export type SystemNoticeTone = "info" | "success" | "warning" | "danger";

export interface SystemNoticePayload {
  title: string;
  message: string;
  tone: SystemNoticeTone;
  steps?: string[];
  refreshStatus?: boolean;
}

export type DownloadEventEnvelope =
  | { event: "download.queued"; payload: DownloadQueuedPayload }
  | { event: "download.started"; payload: DownloadStartedPayload }
  | { event: "download.progress"; payload: DownloadProgressPayload }
  | { event: "download.completed"; payload: DownloadCompletedPayload }
  | { event: "download.failed"; payload: DownloadFailedPayload }
  | { event: "download.cancelled"; payload: DownloadCancelledPayload }
  | { event: "system.notice"; payload: SystemNoticePayload }
  | { event: "system.error"; payload: SystemErrorPayload };

export type ThemeEventEnvelope = { event: "theme.applied"; payload: ThemeAppliedPayload };

export type SidecarEvent = DownloadEventEnvelope | ThemeEventEnvelope;

export interface ThemeImportRequest {
  filePath: string;
}

export interface ThemeExportRequest {
  id: string;
  outPath: string;
}

export interface CreateThemeRequest {
  id: string;
  name: string;
  description?: string;
  author?: string;
  variables?: Record<string, string>;
}

export interface StartDownloadResponse {
  accepted: true;
  id: string;
}

export interface SystemPingResult {
  status: "ok";
  engine: "rust" | "mock";
  version: string;
}

export interface AppApi {
  analyzeUrl(url: string, network?: NetworkSettings): Promise<AnalyzeResult>;
  startDownload(payload: DownloadRequest): Promise<StartDownloadResponse>;
  cancelDownload(id: string): Promise<{ cancelled: boolean; id: string }>;
  getSystemStatus(): Promise<SystemStatus>;
  repairRuntimeTools(): Promise<SystemStatus>;
  openExternal(url: string): Promise<{ opened: boolean }>;
  getThemes(): Promise<ThemeSummary[]>;
  applyTheme(id: string): Promise<ThemeSummary>;
  importTheme(filePath: string): Promise<ThemeSummary>;
  exportTheme(id: string, outPath: string): Promise<{ exported: true; outPath: string }>;
  createTheme(payload: CreateThemeRequest): Promise<ThemeSummary>;
  subscribeDownloadEvents(handler: (event: DownloadEventEnvelope) => void): void;
  unsubscribeDownloadEvents(handler?: (event: DownloadEventEnvelope) => void): void;
  subscribeThemeEvents(handler: (event: ThemeEventEnvelope) => void): void;
  unsubscribeThemeEvents(handler?: (event: ThemeEventEnvelope) => void): void;
}
