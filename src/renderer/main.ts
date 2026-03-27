import "./styles.css";

import type {
  AnalyzeResult,
  AppRpcError,
  DownloadEventEnvelope,
  LibraryEntry,
  DownloadRequest,
  NetworkSettings,
  SystemComponentStatus,
  SystemStatus,
  ThemeEventEnvelope,
  ThemeSummary
} from "../../shared/contracts";
import { detectLocale, LOCALE_STORAGE_KEY, t as translate, type UiLocale } from "./i18n";
import { applyThemeStyles } from "./theme";

type ViewName = "downloader" | "queue" | "themes";
type LogTone = "info" | "success" | "warning" | "danger";

interface TaskSnapshot {
  id: string;
  status: "queued" | "started" | "progress" | "completed" | "failed" | "cancelled";
  percent: number | null;
  preset?: string;
  url?: string;
  outputPath?: string | null;
  message?: string;
}

interface LogEntry {
  id: string;
  timestamp: string;
  tone: LogTone;
  message: string;
}

interface NoticeEntry {
  id: string;
  title: string;
  message: string;
  tone: LogTone;
  steps: string[];
}

const state = {
  currentView: "downloader" as ViewName,
  locale: detectLocale() as UiLocale,
  activeTheme: null as ThemeSummary | null,
  systemStatus: null as SystemStatus | null,
  repairInFlight: false,
  defaultOutputDir: "",
  themes: [] as ThemeSummary[],
  analyzeResult: null as AnalyzeResult | null,
  library: [] as LibraryEntry[],
  tasks: new Map<string, TaskSnapshot>(),
  logs: [] as LogEntry[],
  notices: [] as NoticeEntry[]
};

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function parseInvokeError(error: unknown): AppRpcError {
  if (typeof error === "object" && error !== null && "message" in error) {
    const message = String((error as { message?: string }).message ?? "");
    const jsonStart = message.indexOf("{");

    if (jsonStart >= 0) {
      try {
        return JSON.parse(message.slice(jsonStart)) as AppRpcError;
      } catch {
        return { code: "UNKNOWN", message };
      }
    }

    return { code: "UNKNOWN", message };
  }

  return { code: "UNKNOWN", message: t("error.unknownRenderer") };
}

function t(key: Parameters<typeof translate>[1], vars?: Record<string, string | number>): string {
  return translate(state.locale, key, vars);
}

function appendLog(message: string, tone: LogTone = "info"): void {
  state.logs.unshift({
    id: crypto.randomUUID(),
    timestamp: new Date().toLocaleTimeString(),
    tone,
    message
  });

  state.logs = state.logs.slice(0, 40);
  renderLogFeed();
}

function pushNotice(title: string, message: string, tone: LogTone = "info", steps: string[] = []): void {
  const key = `${title}::${message}`;
  const existing = state.notices.findIndex((entry) => `${entry.title}::${entry.message}` === key);

  const notice: NoticeEntry = {
    id: crypto.randomUUID(),
    title,
    message,
    tone,
    steps
  };

  if (existing >= 0) {
    state.notices.splice(existing, 1);
  }

  state.notices.unshift(notice);
  state.notices = state.notices.slice(0, 3);
  renderNotices();
}

function describeError(error: AppRpcError): { title: string; message: string; tone: LogTone; steps: string[] } {
  const details = typeof error.details === "object" && error.details !== null ? (error.details as Record<string, unknown>) : {};
  const helpFromDetails = Array.isArray(details.help) ? details.help.filter((value): value is string => typeof value === "string") : [];

  if (error.code === "BINARY_MISSING") {
    return {
      title: t("error.missingBinaryTitle"),
      message: error.message,
      tone: "warning",
      steps:
        helpFromDetails.length > 0
          ? helpFromDetails
          : [t("error.missingBinaryHelp1"), t("error.missingBinaryHelp2")]
    };
  }

  if (error.code === "SIDECAR_UNAVAILABLE") {
    return {
      title: t("error.engineOfflineTitle"),
      message: error.message,
      tone: "warning",
      steps: [t("error.engineOfflineHelp1"), t("error.engineOfflineHelp2")]
    };
  }

  if (details.category === "ANTI_BOT") {
    return {
      title: t("error.antiBotTitle"),
      message: error.message,
      tone: "warning",
      steps:
        helpFromDetails.length > 0
          ? helpFromDetails
          : [t("error.antiBotHelp1"), t("error.antiBotHelp2"), t("error.antiBotHelp3")]
    };
  }

  if (details.category === "NETWORK") {
    return {
      title: t("error.networkTitle"),
      message: error.message,
      tone: "warning",
      steps:
        helpFromDetails.length > 0
          ? helpFromDetails
          : [t("error.networkHelp1"), t("error.networkHelp2"), t("error.networkHelp3")]
    };
  }

  if (error.code === "THEME_ERROR") {
    return {
      title: t("error.themeTitle"),
      message: error.message,
      tone: "warning",
      steps: [t("error.themeHelp1"), t("error.themeHelp2")]
    };
  }

  return {
    title: t("error.systemTitle"),
    message: error.message,
    tone: error.code === "VALIDATION_ERROR" ? "warning" : "danger",
    steps: helpFromDetails
  };
}

function appendDiagnosticHints(error: AppRpcError): void {
  const message = error.message.toLowerCase();

  if (message.includes("not a bot") || message.includes("sign in")) {
    appendLog(t("hint.antiBot"), "warning");
  }

  if (message.includes("proxy") || message.includes("timed out") || message.includes("connection")) {
    appendLog(t("hint.network"), "warning");
  }

  if (message.includes("deno.exe")) {
    appendLog(t("hint.deno"), "warning");
  }
}

function presentError(error: AppRpcError): void {
  const described = describeError(error);
  appendLog(`${described.title}: ${described.message}`, described.tone);
  pushNotice(described.title, described.message, described.tone, described.steps);
  appendDiagnosticHints(error);
}

function availabilityTone(availability: SystemComponentStatus["availability"]): LogTone {
  if (availability === "ready") {
    return "success";
  }

  if (availability === "fallback" || availability === "warning") {
    return "warning";
  }

  return "danger";
}

function availabilityLabel(availability: SystemComponentStatus["availability"]): string {
  if (availability === "ready") {
    return t("availability.ready");
  }

  if (availability === "fallback") {
    return t("availability.fallback");
  }

  if (availability === "warning") {
    return t("availability.warning");
  }

  return t("availability.missing");
}

function statusText(task: TaskSnapshot): string {
  if (task.status === "progress" && typeof task.percent === "number") {
    return `${task.percent.toFixed(1)}%`;
  }

  if (task.status === "completed") {
    return t("task.completed");
  }

  if (task.status === "failed") {
    return t("task.failed");
  }

  if (task.status === "cancelled") {
    return t("task.cancelled");
  }

  if (task.status === "queued" || task.status === "started") {
    return t("download.awaiting");
  }

  return task.status;
}

function formatDuration(seconds: number | null): string {
  if (!seconds || !Number.isFinite(seconds)) {
    return t("downloader.durationUnknown");
  }

  const totalSeconds = Math.max(0, Math.round(seconds));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const remainingSeconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(remainingSeconds).padStart(2, "0")}`;
  }

  return `${minutes}:${String(remainingSeconds).padStart(2, "0")}`;
}

function formatAbsoluteDate(value: string | null | undefined): string {
  if (!value) {
    return t("library.unknownDate");
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return parsed.toLocaleDateString(state.locale === "ru" ? "ru-RU" : "en-US", {
    year: "numeric",
    month: "short",
    day: "numeric"
  });
}

function presetLabel(preset?: string): string {
  if (preset === "mp3") {
    return t("download.mp3");
  }

  return t("download.best");
}

type PreviewPlayer =
  | { kind: "youtube"; src: string; label: string }
  | { kind: "video"; src: string; label: string }
  | { kind: "poster"; label: string };

const DIRECT_VIDEO_PATTERN = /\.(mp4|webm|ogg|ogv|mov|m4v)(?:$|[?#])/i;

function isDirectVideoUrl(url: string | null | undefined): url is string {
  return typeof url === "string" && DIRECT_VIDEO_PATTERN.test(url);
}

function extractYouTubeVideoId(rawUrl: string | null | undefined): string | null {
  if (!rawUrl) {
    return null;
  }

  try {
    const url = new URL(rawUrl);
    const host = url.hostname.replace(/^www\./, "").toLowerCase();

    if (host === "youtu.be") {
      return url.pathname.split("/").filter(Boolean)[0] ?? null;
    }

    if (host.endsWith("youtube.com")) {
      const watchId = url.searchParams.get("v");
      if (watchId) {
        return watchId;
      }

      const segments = url.pathname.split("/").filter(Boolean);
      if (segments[0] === "embed" || segments[0] === "shorts" || segments[0] === "live") {
        return segments[1] ?? null;
      }
    }
  } catch {
    return null;
  }

  return null;
}

function buildPreviewPlayer(result: AnalyzeResult): PreviewPlayer {
  const youtubeId = extractYouTubeVideoId(result.webpageUrl) ?? extractYouTubeVideoId(result.url);

  if (youtubeId) {
    return {
      kind: "youtube",
      src: `https://www.youtube.com/embed/${encodeURIComponent(youtubeId)}?autoplay=0&rel=0&modestbranding=1&playsinline=1`,
      label: t("player.youtube")
    };
  }

  if (isDirectVideoUrl(result.url)) {
    return {
      kind: "video",
      src: result.url,
      label: t("player.video")
    };
  }

  if (isDirectVideoUrl(result.webpageUrl)) {
    return {
      kind: "video",
      src: result.webpageUrl,
      label: t("player.video")
    };
  }

  return {
    kind: "poster",
    label: t("player.poster")
  };
}

function bindAnalyzeResultActions(): void {
  document.querySelectorAll<HTMLButtonElement>("[data-open-source-url]").forEach((button) => {
    button.addEventListener("click", async () => {
      const url = button.dataset.openSourceUrl;
      if (!url) {
        return;
      }

      try {
        await window.appApi.openExternal(url);
        appendLog(t("log.sourceOpened", { url }), "info");
      } catch (error) {
        presentError(parseInvokeError(error));
      }
    });
  });
}

function renderShell(): void {
  const app = document.querySelector<HTMLDivElement>("#app");

  if (!app) {
    throw new Error("Missing #app root.");
  }

  app.innerHTML = `
    <div class="shell">
      <aside class="sidebar">
        <div class="brand brand-bar">
          <div>
            <p class="eyebrow">${t("app.shell")}</p>
            <h1>Dismas Downloader</h1>
            <p class="lede">${t("app.subtitle")}</p>
          </div>
          <label class="language-switch">
            <span>${t("lang.label")}</span>
            <select id="locale-switch">
              <option value="ru" ${state.locale === "ru" ? "selected" : ""}>${t("lang.ru")}</option>
              <option value="en" ${state.locale === "en" ? "selected" : ""}>${t("lang.en")}</option>
            </select>
          </label>
        </div>

        <nav class="nav">
          <button class="nav-button is-active" data-view="downloader">${t("nav.downloader")}</button>
          <button class="nav-button" data-view="queue">${t("nav.queue")}</button>
          <button class="nav-button" data-view="themes">${t("nav.themes")}</button>
        </nav>

        <section class="sidebar-card theme-status-card">
          <p class="eyebrow">${t("theme.activeEyebrow")}</p>
          <h2 id="active-theme-name">${t("theme.awaiting")}</h2>
          <p id="active-theme-description">${t("theme.noActive")}</p>
        </section>

        <details class="sidebar-card compact-details network-card">
          <summary>
            <div>
              <p class="eyebrow">${t("network.eyebrow")}</p>
              <h2>${t("network.title")}</h2>
            </div>
          </summary>
          <div class="mini-form">
            <label>
              <span>${t("network.route")}</span>
              <select id="network-strategy">
                <option value="direct">${t("network.direct")}</option>
                <option value="proxy">${t("network.proxyMode")}</option>
                <option value="system-bypass">${t("network.systemBypass")}</option>
              </select>
            </label>
            <label>
              <span>${t("network.proxy")}</span>
              <input id="proxy-url" type="text" placeholder="socks5://127.0.0.1:1080" />
            </label>
            <label>
              <span>${t("network.impersonate")}</span>
              <input id="impersonate-value" type="text" placeholder="chrome-120:windows-10" />
            </label>
            <label>
              <span>${t("network.cookies")}</span>
              <input id="cookies-browser" type="text" placeholder="chrome" />
            </label>
          </div>
          <p class="hint-copy">${t("network.hint")}</p>
        </details>

        <section class="sidebar-card system-card">
          <p class="eyebrow">${t("system.eyebrow")}</p>
          <h2 id="system-summary">${t("system.scanning")}</h2>
          <p id="system-mode-copy">${t("system.modeCopy")}</p>
          <div class="system-actions">
            <button id="repair-tools-button" class="accent-button" type="button">${t("system.repair")}</button>
          </div>
          <details class="compact-details system-details">
            <summary>${t("system.details")}</summary>
            <div id="system-capabilities" class="capability-list empty-inline">${t("system.capPending")}</div>
            <div id="system-components" class="component-list empty-inline">${t("system.noDiag")}</div>
          </details>
        </section>

        <p class="sidebar-footnote">${t("app.legal")}</p>
      </aside>

      <main class="workspace">
        <header class="masthead">
          <div>
            <p class="eyebrow">${t("app.shell")}</p>
            <h2 id="view-title">${t("nav.downloader")}</h2>
          </div>
          <div id="status-strip" class="status-strip">
            <span class="status-pill">${t("status.portable")}</span>
            <span class="status-pill">${t("status.secure")}</span>
          </div>
        </header>

        <section id="notice-tray" class="notice-tray empty-state">
          ${t("notice.none")}
        </section>

        <section class="view is-active" data-panel="downloader">
          <div class="panel hero-panel">
            <div class="panel-header">
              <div>
                <p class="eyebrow">${t("downloader.eyebrow")}</p>
                <h3>${t("downloader.title")}</h3>
              </div>
            </div>
            <form id="analyze-form" class="stack-form">
              <label>
                <span>${t("downloader.url")}</span>
                <input id="url-input" name="url" type="url" placeholder="${t("downloader.urlPlaceholder")}" required />
              </label>
              <div class="form-actions">
                <button type="submit" class="accent-button">${t("downloader.analyze")}</button>
              </div>
            </form>
            <article id="analyze-result" class="analyze-result empty-state">
              ${t("downloader.previewEmpty")}
            </article>
          </div>

          <div class="panel ritual-panel">
            <div class="panel-header">
              <div>
                <p class="eyebrow">${t("download.eyebrow")}</p>
                <h3>${t("download.title")}</h3>
              </div>
            </div>
            <form id="download-form" class="stack-form">
              <label>
                <span>${t("download.output")}</span>
                <input id="output-dir-input" name="outputDir" type="text" placeholder="${t("download.outputPlaceholder")}" />
              </label>
              <label>
                <span>${t("download.preset")}</span>
                <select id="preset-input" name="preset">
                  <option value="best">${t("download.best")}</option>
                  <option value="mp3">${t("download.mp3")}</option>
                </select>
              </label>
              <div class="form-actions">
                <button type="submit" class="accent-button">${t("download.start")}</button>
              </div>
            </form>
            <div id="download-current" class="current-task empty-state">
              ${t("download.noTask")}
            </div>
          </div>
        </section>

        <section class="view" data-panel="queue">
          <div class="panel queue-panel">
            <div class="panel-header">
              <div>
                <p class="eyebrow">${t("queue.eyebrow")}</p>
                <h3>${t("queue.title")}</h3>
              </div>
            </div>
            <div id="queue-list" class="queue-list empty-state">${t("queue.empty")}</div>

            <details class="compact-details queue-log-details">
              <summary>${t("log.toggle")}</summary>
              <div id="log-feed" class="log-feed empty-state">${t("log.empty")}</div>
            </details>
          </div>

          <div class="panel library-panel">
            <div class="panel-header">
              <div>
                <p class="eyebrow">${t("library.eyebrow")}</p>
                <h3>${t("library.title")}</h3>
              </div>
            </div>
            <div id="library-list" class="library-list empty-state">${t("library.empty")}</div>
          </div>
        </section>

        <section class="view" data-panel="themes">
          <div class="themes-layout">
            <div class="panel theme-browser-panel">
              <div class="panel-header">
                <div>
                  <p class="eyebrow">${t("themes.eyebrow")}</p>
                  <h3>${t("themes.title")}</h3>
                </div>
              </div>
              <div id="themes-grid" class="themes-grid empty-state">${t("themes.empty")}</div>
            </div>

            <div class="panel theme-tools-panel">
              <div class="panel-header">
                <div>
                  <p class="eyebrow">${t("workshop.eyebrow")}</p>
                  <h3>${t("workshop.title")}</h3>
                </div>
              </div>

              <form id="import-form" class="stack-form compact-form">
                <label>
                  <span>${t("workshop.importPath")}</span>
                  <input name="filePath" type="text" placeholder="${t("workshop.importPlaceholder")}" required />
                </label>
                <button type="submit" class="accent-button">${t("workshop.import")}</button>
              </form>

              <form id="export-form" class="stack-form compact-form">
                <label>
                  <span>${t("workshop.exportId")}</span>
                  <input name="id" type="text" placeholder="default_darkest" required />
                </label>
                <label>
                  <span>${t("workshop.exportPath")}</span>
                  <input name="outPath" type="text" placeholder="${t("workshop.exportPlaceholder")}" required />
                </label>
                <button type="submit" class="ghost-button">${t("workshop.export")}</button>
              </form>

              <form id="create-theme-form" class="stack-form compact-form">
                <label>
                  <span>${t("workshop.createId")}</span>
                  <input name="id" type="text" placeholder="blood_steel" required />
                </label>
                <label>
                  <span>${t("workshop.createName")}</span>
                  <input name="name" type="text" placeholder="Blood Steel" required />
                </label>
                <label>
                  <span>${t("workshop.createDescription")}</span>
                  <input name="description" type="text" placeholder="Portable forged variant" />
                </label>
                <label>
                  <span>${t("workshop.createAccent")}</span>
                  <input name="accent" type="text" placeholder="#8a0303" />
                </label>
                <button type="submit" class="ghost-button">${t("workshop.create")}</button>
              </form>
            </div>
          </div>
        </section>
      </main>
    </div>
  `;
}

function updateView(nextView: ViewName): void {
  state.currentView = nextView;

  document.querySelectorAll<HTMLElement>(".view").forEach((panel) => {
    panel.classList.toggle("is-active", panel.dataset.panel === nextView);
  });

  document.querySelectorAll<HTMLButtonElement>(".nav-button").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.view === nextView);
  });

  const title = document.querySelector<HTMLElement>("#view-title");
  if (title) {
    title.textContent =
      nextView === "downloader" ? t("nav.downloader") : nextView === "queue" ? t("nav.queue") : t("nav.themes");
  }
}

function renderNotices(): void {
  const tray = document.querySelector<HTMLDivElement>("#notice-tray");
  if (!tray) {
    return;
  }

  if (state.notices.length === 0) {
    tray.className = "notice-tray empty-state";
    tray.textContent = t("notice.none");
    return;
  }

  tray.className = "notice-tray";
  tray.innerHTML = state.notices
    .map(
      (notice) => `
        <article class="notice-card tone-${notice.tone}">
          <div class="notice-copy">
            <p class="eyebrow">${escapeHtml(notice.title)}</p>
            <h3>${escapeHtml(notice.message)}</h3>
          </div>
          ${
            notice.steps.length > 0
              ? `<ul class="notice-steps">
                  ${notice.steps.map((step) => `<li>${escapeHtml(step)}</li>`).join("")}
                </ul>`
              : ""
          }
        </article>
      `
    )
    .join("");
}

function renderSystemStatus(): void {
  const summary = document.querySelector<HTMLElement>("#system-summary");
  const modeCopy = document.querySelector<HTMLElement>("#system-mode-copy");
  const capabilityList = document.querySelector<HTMLDivElement>("#system-capabilities");
  const componentList = document.querySelector<HTMLDivElement>("#system-components");
  const statusStrip = document.querySelector<HTMLDivElement>("#status-strip");
  const repairButton = document.querySelector<HTMLButtonElement>("#repair-tools-button");

  if (!summary || !modeCopy || !capabilityList || !componentList || !statusStrip || !repairButton) {
    return;
  }

  const status = state.systemStatus;

  if (!status) {
    summary.textContent = t("system.scanning");
    modeCopy.textContent = t("system.modeCopy");
    repairButton.disabled = true;
    repairButton.textContent = t("system.repair");
    capabilityList.className = "capability-list empty-inline";
    capabilityList.textContent = t("system.capPending");
    componentList.className = "component-list empty-inline";
    componentList.textContent = t("system.noDiag");
    return;
  }

  const readyCount = status.components.filter((entry) => entry.availability === "ready").length;
  const blockerCount = status.components.filter((entry) => entry.availability === "missing").length;
  const warningCount = status.components.filter((entry) => entry.availability === "warning" || entry.availability === "fallback").length;
  const autoRepairTargets = status.components.filter((entry) => entry.autoInstall && entry.availability === "missing");

  repairButton.disabled = state.repairInFlight || autoRepairTargets.length === 0;
  repairButton.textContent = state.repairInFlight
    ? t("system.repairing")
    : autoRepairTargets.length > 0
      ? `${t("system.repair")} (${autoRepairTargets.length})`
      : t("system.repair");

  summary.textContent =
    blockerCount === 0
      ? `${t("availability.ready")} ${readyCount}/${status.components.length}`
      : t("status.blockers", { count: blockerCount });

  modeCopy.textContent =
    `${t("status.mode", { mode: status.sidecarMode })}${status.sidecarVersion ? ` (${status.sidecarVersion})` : ""}. ` +
    `${warningCount > 0 ? `${t("availability.warning")}: ${warningCount}` : t("status.noBlockers")}`;

  const capabilityEntries = [
    { label: t("downloader.analyze"), value: status.capabilities.canAnalyze },
    { label: t("download.title"), value: status.capabilities.canDownload },
    { label: "YouTube", value: status.capabilities.canUseYoutube },
    { label: t("nav.themes"), value: status.capabilities.canManageThemes }
  ];

  capabilityList.className = "capability-list";
  capabilityList.innerHTML = capabilityEntries
    .map(
      (entry) => `
        <span class="capability-pill ${entry.value ? "is-ready" : "is-blocked"}">
          ${escapeHtml(entry.label)}: ${entry.value ? t("status.ready") : t("status.limited")}
        </span>
      `
    )
    .join("");

  componentList.className = "component-list";
  componentList.innerHTML = status.components
    .map(
      (component) => `
        <article class="component-card tone-${availabilityTone(component.availability)}">
          <div class="component-head">
            <strong>${escapeHtml(component.label)}</strong>
            <span class="component-state">${escapeHtml(availabilityLabel(component.availability))}</span>
          </div>
          <p>${escapeHtml(component.summary)}</p>
          <p class="component-help">${escapeHtml(component.help[0] ?? t("system.noHint"))}</p>
          <div class="component-links">
            ${
              component.sourceUrl
                ? `<button class="ghost-button source-link-button" type="button" data-source-url="${escapeHtml(component.sourceUrl)}">${t("system.openSource")}</button>`
                : ""
            }
            ${
              component.path
                ? `<span class="component-path">${escapeHtml(component.path)}</span>`
                : ""
            }
          </div>
        </article>
      `
    )
    .join("");

  statusStrip.innerHTML = `
    <span class="status-pill">${t("status.portable")}</span>
    <span class="status-pill">${t("status.mode", { mode: status.sidecarMode })}</span>
    <span class="status-pill">${escapeHtml(blockerCount === 0 ? t("status.noBlockers") : t("status.blockers", { count: blockerCount }))}</span>
  `;

  componentList.querySelectorAll<HTMLButtonElement>("[data-source-url]").forEach((button) => {
    button.addEventListener("click", async () => {
      const url = button.dataset.sourceUrl;
      if (!url) {
        return;
      }

      try {
        await window.appApi.openExternal(url);
        appendLog(t("log.sourceOpened", { url }), "info");
      } catch (error) {
        presentError(parseInvokeError(error));
      }
    });
  });
}

function renderAnalyzeResult(): void {
  const container = document.querySelector<HTMLDivElement>("#analyze-result");
  if (!container) {
    return;
  }

  const result = state.analyzeResult;

  if (!result) {
    container.className = "analyze-result empty-state";
    container.innerHTML = t("downloader.previewEmpty");
    return;
  }

  const player = buildPreviewPlayer(result);
  const avatarLabel = (result.uploader ?? result.title ?? "D").trim().charAt(0).toUpperCase() || "D";
  const posterStyle = result.thumbnailUrl ? ` style="background-image:url('${escapeHtml(result.thumbnailUrl)}')"` : "";

  container.className = "analyze-result";
  container.innerHTML = `
    <div class="youtube-preview-shell">
      <div class="youtube-stage-card">
        ${
          player.kind === "youtube"
            ? `<iframe
                class="youtube-frame youtube-frame--embed"
                src="${escapeHtml(player.src)}"
                title="${escapeHtml(result.title)}"
                loading="lazy"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                referrerpolicy="strict-origin-when-cross-origin"
                allowfullscreen
              ></iframe>`
            : player.kind === "video"
              ? `<video
                  class="youtube-frame youtube-frame--video"
                  src="${escapeHtml(player.src)}"
                  poster="${escapeHtml(result.thumbnailUrl ?? "")}"
                  controls
                  preload="metadata"
                  playsinline
                ></video>`
              : `<div class="youtube-frame youtube-frame--poster"${posterStyle}>
                  <div class="youtube-frame-scrim"></div>
                  <div class="youtube-play-badge" aria-hidden="true"></div>
                  <div class="youtube-fake-controls">
                    <div class="youtube-progress-track"><span></span></div>
                    <div class="youtube-control-row">
                      <span>${t("player.poster")}</span>
                      <span>16:9</span>
                    </div>
                  </div>
                </div>`
        }
      </div>

      <div class="youtube-meta-card">
        <div class="youtube-heading-row">
          <div>
            <p class="eyebrow">${escapeHtml(player.label)}</p>
            <h4>${escapeHtml(result.title)}</h4>
          </div>
          <button class="ghost-button preview-source-button" type="button" data-open-source-url="${escapeHtml(result.webpageUrl)}">
            ${t("player.openSource")}
          </button>
        </div>

        <div class="youtube-channel-row">
          <div class="youtube-avatar">${escapeHtml(avatarLabel)}</div>
          <div class="youtube-channel-copy">
            <strong>${escapeHtml(result.uploader ?? t("common.unknownUploader"))}</strong>
            <p>${escapeHtml(player.kind === "poster" ? t("player.posterHint") : t("player.embedHint"))}</p>
          </div>
        </div>

        <div class="youtube-stat-row">
          <span class="youtube-chip">${escapeHtml(t("downloader.duration", { value: formatDuration(result.durationSeconds) }))}</span>
          <span class="youtube-chip">${escapeHtml(t("downloader.formats", { count: result.formats.length }))}</span>
          <span class="youtube-chip">${escapeHtml(result.extractor ?? t("common.unknownExtractor"))}</span>
        </div>
      </div>
    </div>
  `;

  bindAnalyzeResultActions();
}

function renderCurrentTask(): void {
  const container = document.querySelector<HTMLDivElement>("#download-current");
  if (!container) {
    return;
  }

  const latestTask = [...state.tasks.values()][0];

  if (!latestTask) {
    container.className = "current-task empty-state";
    container.textContent = t("download.noTask");
    return;
  }

  const progressPercent = typeof latestTask.percent === "number" ? `${latestTask.percent.toFixed(1)}%` : t("download.awaiting");

  container.className = "current-task";
  container.innerHTML = `
    <div class="task-card-head">
      <div>
        <p class="eyebrow">${escapeHtml(t("download.task", { id: latestTask.id.slice(0, 8) }))}</p>
        <h4>${escapeHtml(presetLabel(latestTask.preset))} - ${escapeHtml(statusText(latestTask))}</h4>
      </div>
      <button class="danger-button" data-cancel-id="${escapeHtml(latestTask.id)}">${t("download.cancel")}</button>
    </div>
    <div class="stress-track">
      <div class="stress-fill" style="width:${typeof latestTask.percent === "number" ? latestTask.percent : 0}%"></div>
    </div>
    <p>${escapeHtml(progressPercent)}${latestTask.message ? ` - ${escapeHtml(latestTask.message)}` : ""}</p>
  `;

  container.querySelector<HTMLButtonElement>("[data-cancel-id]")?.addEventListener("click", async (event) => {
    const id = (event.currentTarget as HTMLButtonElement).dataset.cancelId;
    if (!id) {
      return;
    }

    try {
      await window.appApi.cancelDownload(id);
      appendLog(t("log.cancelOrdered", { id }), "warning");
    } catch (error) {
      presentError(parseInvokeError(error));
    }
  });
}

function renderQueue(): void {
  const queueList = document.querySelector<HTMLDivElement>("#queue-list");
  if (!queueList) {
    return;
  }

  const tasks = [...state.tasks.values()];

  if (tasks.length === 0) {
    queueList.className = "queue-list empty-state";
    queueList.textContent = t("queue.empty");
    return;
  }

  queueList.className = "queue-list";
  queueList.innerHTML = tasks
    .map(
      (task) => `
        <article class="queue-item status-${task.status}">
          <div>
            <p class="eyebrow">${escapeHtml(task.id)}</p>
            <h4>${escapeHtml(task.url ?? t("downloader.urlPlaceholder"))}</h4>
          </div>
          <div class="queue-meta">
            <strong>${escapeHtml(statusText(task))}</strong>
            <span>${escapeHtml(presetLabel(task.preset))}${task.outputPath ? ` - ${escapeHtml(task.outputPath)}` : ""}</span>
          </div>
        </article>
      `
    )
    .join("");
}

function renderLibrary(): void {
  const list = document.querySelector<HTMLDivElement>("#library-list");
  if (!list) {
    return;
  }

  if (state.library.length === 0) {
    list.className = "library-list empty-state";
    list.textContent = t("library.empty");
    return;
  }

  list.className = "library-list";
  list.innerHTML = state.library
    .map(
      (entry) => `
        <article class="library-card ${entry.fileExists ? "" : "is-missing"}">
          <div class="library-card-head">
            <div class="library-thumb">
              ${
                entry.thumbnailUrl
                  ? `<img src="${escapeHtml(entry.thumbnailUrl)}" alt="${escapeHtml(entry.title)}" />`
                  : `<div class="library-thumb-placeholder">${escapeHtml(entry.title.slice(0, 1).toUpperCase())}</div>`
              }
            </div>
            <div class="library-copy">
              <p class="eyebrow">${escapeHtml(presetLabel(entry.preset))}</p>
              <h4>${escapeHtml(entry.title)}</h4>
              <p>${escapeHtml(entry.uploader ?? t("common.unknownUploader"))}</p>
            </div>
            <button
              class="${entry.fileExists ? "accent-button" : "ghost-button"}"
              type="button"
              data-open-library-path="${escapeHtml(entry.outputPath)}"
              ${entry.fileExists ? "" : "disabled"}
            >
              ${entry.fileExists ? t("library.play") : t("library.fileMissing")}
            </button>
          </div>
          <div class="library-meta-row">
            <span class="youtube-chip">${escapeHtml(t("library.duration"))}: ${escapeHtml(entry.durationSeconds ? formatDuration(entry.durationSeconds) : t("library.unknownDuration"))}</span>
            <span class="youtube-chip">${escapeHtml(t("library.published"))}: ${escapeHtml(formatAbsoluteDate(entry.publishedAt))}</span>
            <span class="youtube-chip">${escapeHtml(t("library.downloaded"))}: ${escapeHtml(formatAbsoluteDate(entry.downloadedAt))}</span>
          </div>
          <p class="component-path"><strong>${escapeHtml(t("library.path"))}:</strong> ${escapeHtml(entry.outputPath)}</p>
        </article>
      `
    )
    .join("");

  list.querySelectorAll<HTMLButtonElement>("[data-open-library-path]").forEach((button) => {
    button.addEventListener("click", async () => {
      const targetPath = button.dataset.openLibraryPath;
      if (!targetPath) {
        return;
      }

      try {
        const result = await window.appApi.openPath(targetPath);
        if (!result.opened) {
          presentError({
            code: "IO_ERROR",
            message: result.error || `Failed to open file: ${targetPath}`,
            recoverable: true
          });
          return;
        }

        appendLog(`${t("library.play")}: ${targetPath}`, "info");
      } catch (error) {
        presentError(parseInvokeError(error));
      }
    });
  });
}

function renderLogFeed(): void {
  const feed = document.querySelector<HTMLDivElement>("#log-feed");
  if (!feed) {
    return;
  }

  if (state.logs.length === 0) {
    feed.className = "log-feed empty-state";
    feed.textContent = t("log.empty");
    return;
  }

  feed.className = "log-feed";
  feed.innerHTML = state.logs
    .map(
      (entry) => `
        <article class="log-entry tone-${entry.tone}">
          <span>${escapeHtml(entry.timestamp)}</span>
          <p>${escapeHtml(entry.message)}</p>
        </article>
      `
    )
    .join("");
}

function renderThemeStatus(theme: ThemeSummary | null): void {
  const name = document.querySelector<HTMLElement>("#active-theme-name");
  const description = document.querySelector<HTMLElement>("#active-theme-description");

  if (!name || !description) {
    return;
  }

  if (!theme) {
    name.textContent = t("theme.awaiting");
    description.textContent = t("theme.noActive");
    return;
  }

  name.textContent = theme.name;
  description.textContent = theme.description ?? t("theme.fallbackDescription");
}

function renderThemes(): void {
  const grid = document.querySelector<HTMLDivElement>("#themes-grid");
  if (!grid) {
    return;
  }

  if (state.themes.length === 0) {
    grid.className = "themes-grid empty-state";
    grid.textContent = t("themes.empty");
    return;
  }

  grid.className = "themes-grid";
  grid.innerHTML = state.themes
    .map(
      (theme) => `
        <article class="theme-card ${theme.active ? "is-active" : ""}">
          <div class="theme-preview">
            ${
              theme.previewUrl
                ? `<img src="${escapeHtml(theme.previewUrl)}" alt="Preview for ${escapeHtml(theme.name)}" />`
                : `<div class="theme-preview-placeholder">${t("theme.noPreview")}</div>`
            }
          </div>
          <div class="theme-copy">
            <p class="eyebrow">${escapeHtml(theme.version)}</p>
            <h4>${escapeHtml(theme.name)}</h4>
            <p>${escapeHtml(theme.description ?? t("theme.noDescription"))}</p>
            <div class="theme-meta">
              <span>${escapeHtml(theme.id)}</span>
              <span>${escapeHtml(theme.author)}</span>
            </div>
          </div>
          <button class="${theme.active ? "ghost-button" : "accent-button"}" data-apply-theme="${escapeHtml(theme.id)}">
            ${theme.active ? t("theme.active") : t("theme.apply")}
          </button>
        </article>
      `
    )
    .join("");

  grid.querySelectorAll<HTMLButtonElement>("[data-apply-theme]").forEach((button) => {
    button.addEventListener("click", async () => {
      const id = button.dataset.applyTheme;
      if (!id) {
        return;
      }

      try {
        const theme = await window.appApi.applyTheme(id);
        state.themes = state.themes.map((entry) => ({ ...entry, active: entry.id === theme.id }));
        state.activeTheme = theme;
        applyThemeStyles(theme);
        renderThemeStatus(theme);
        renderThemes();
        appendLog(t("log.themeApplied", { name: theme.name }), "success");
      } catch (error) {
        presentError(parseInvokeError(error));
      }
    });
  });
}

function bindNavigation(): void {
  document.querySelectorAll<HTMLButtonElement>(".nav-button").forEach((button) => {
    button.addEventListener("click", () => {
      const view = button.dataset.view as ViewName | undefined;
      if (view) {
        updateView(view);
      }
    });
  });
}

function bindLanguageSwitcher(): void {
  const select = document.querySelector<HTMLSelectElement>("#locale-switch");
  if (!select) {
    return;
  }

  select.addEventListener("change", () => {
    const next = select.value === "ru" ? "ru" : "en";
    window.localStorage.setItem(LOCALE_STORAGE_KEY, next);
    window.location.reload();
  });
}

function syncDefaultOutputDir(): void {
  const outputInput = document.querySelector<HTMLInputElement>("#output-dir-input");
  if (!outputInput || !state.defaultOutputDir || outputInput.value.trim()) {
    return;
  }

  outputInput.value = state.defaultOutputDir;
}

function bindSystemActions(): void {
  const repairButton = document.querySelector<HTMLButtonElement>("#repair-tools-button");
  if (!repairButton) {
    return;
  }

  repairButton.addEventListener("click", async () => {
    await ensureRuntimeTools("manual");
  });
}

function bindAnalyzeForm(): void {
  const form = document.querySelector<HTMLFormElement>("#analyze-form");
  if (!form) {
    return;
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const formData = new FormData(form);
    const url = String(formData.get("url") ?? "").trim();

    if (!url) {
      appendLog(t("log.urlRequired"), "warning");
      return;
    }

    try {
      const result = await window.appApi.analyzeUrl(url, readNetworkSettings());
      state.analyzeResult = result;
      renderAnalyzeResult();
      appendLog(t("log.analyzeSuccess", { title: result.title }), "success");
    } catch (error) {
      presentError(parseInvokeError(error));
      void refreshSystemStatus();
    }
  });
}

function readNetworkSettings(): NetworkSettings {
  const strategy = (document.querySelector<HTMLSelectElement>("#network-strategy")?.value ?? "direct") as NetworkSettings["strategy"];
  const proxyUrl = document.querySelector<HTMLInputElement>("#proxy-url")?.value.trim() ?? "";
  const impersonate = document.querySelector<HTMLInputElement>("#impersonate-value")?.value.trim() ?? "";
  const cookiesFromBrowser = document.querySelector<HTMLInputElement>("#cookies-browser")?.value.trim() ?? "";

  return {
    strategy,
    proxyUrl: proxyUrl || null,
    impersonate: impersonate || null,
    cookiesFromBrowser: cookiesFromBrowser || null
  };
}

function bindDownloadForm(): void {
  const form = document.querySelector<HTMLFormElement>("#download-form");
  const urlInput = document.querySelector<HTMLInputElement>("#url-input");

  if (!form || !urlInput) {
    return;
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const formData = new FormData(form);
    const outputDir = String(formData.get("outputDir") ?? "").trim() || state.defaultOutputDir;
    const initialAnalyzed = state.analyzeResult && state.analyzeResult.url === urlInput.value.trim() ? state.analyzeResult : null;
    const payload: DownloadRequest = {
      id: crypto.randomUUID(),
      url: urlInput.value.trim(),
      outputDir,
      preset: String(formData.get("preset") ?? "best") === "mp3" ? "mp3" : "best",
      network: readNetworkSettings()
    };

    if (!payload.url || !payload.outputDir) {
      appendLog(t("log.urlOutputRequired"), "warning");
      return;
    }

    try {
      const analyzed = initialAnalyzed ?? (await window.appApi.analyzeUrl(payload.url, payload.network));
      state.analyzeResult = analyzed;
      renderAnalyzeResult();
      payload.metadata = {
        title: analyzed.title,
        webpageUrl: analyzed.webpageUrl,
        durationSeconds: analyzed.durationSeconds,
        publishedAt: analyzed.publishedAt ?? null,
        thumbnailUrl: analyzed.thumbnailUrl,
        uploader: analyzed.uploader
      };

      await window.appApi.startDownload(payload);
      state.tasks.set(payload.id, {
        id: payload.id,
        status: "queued",
        percent: 0,
        preset: payload.preset,
        url: payload.url
      });
      renderQueue();
      renderCurrentTask();
      updateView("queue");
      appendLog(t("log.taskAccepted", { id: payload.id }), "info");
    } catch (error) {
      presentError(parseInvokeError(error));
      void refreshSystemStatus();
    }
  });
}

function bindThemeForms(): void {
  const importForm = document.querySelector<HTMLFormElement>("#import-form");
  const exportForm = document.querySelector<HTMLFormElement>("#export-form");
  const createForm = document.querySelector<HTMLFormElement>("#create-theme-form");

  importForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const formData = new FormData(importForm);
    const filePath = String(formData.get("filePath") ?? "").trim();

    try {
      const theme = await window.appApi.importTheme(filePath);
      state.themes = await window.appApi.getThemes();
      renderThemes();
      appendLog(t("log.themeImported", { name: theme.name }), "success");
    } catch (error) {
      presentError(parseInvokeError(error));
    }
  });

  exportForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const formData = new FormData(exportForm);
    const id = String(formData.get("id") ?? "").trim();
    const outPath = String(formData.get("outPath") ?? "").trim();

    try {
      const result = await window.appApi.exportTheme(id, outPath);
      appendLog(t("log.themeExported", { id, path: result.outPath }), "success");
    } catch (error) {
      presentError(parseInvokeError(error));
    }
  });

  createForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const formData = new FormData(createForm);
    const accent = String(formData.get("accent") ?? "").trim();

    try {
      const theme = await window.appApi.createTheme({
        id: String(formData.get("id") ?? "").trim(),
        name: String(formData.get("name") ?? "").trim(),
        description: String(formData.get("description") ?? "").trim(),
        author: "User",
        variables: accent ? { "--accent": accent } : undefined
      });
      state.themes = await window.appApi.getThemes();
      renderThemes();
      appendLog(t("log.themeCreated", { name: theme.name }), "success");
    } catch (error) {
      presentError(parseInvokeError(error));
    }
  });
}

function handleDownloadEvent(event: DownloadEventEnvelope): void {
  if (event.event === "system.notice") {
    appendLog(`${event.payload.title}: ${event.payload.message}`, event.payload.tone);
    pushNotice(event.payload.title, event.payload.message, event.payload.tone, event.payload.steps ?? []);

    if (event.payload.refreshStatus) {
      void refreshSystemStatus();
    }

    return;
  }

  if (event.event === "system.error") {
    presentError(event.payload.error);
    void refreshSystemStatus();
    return;
  }

  if (event.event === "download.queued") {
    state.tasks.set(event.payload.id, {
      id: event.payload.id,
      status: "queued",
      percent: 0,
      preset: event.payload.preset,
      url: event.payload.url
    });
    appendLog(t("log.taskAccepted", { id: event.payload.id }), "info");
  }

  if (event.event === "download.started") {
    const existing = state.tasks.get(event.payload.id);
    if (existing) {
      state.tasks.set(event.payload.id, { ...existing, status: "started", message: t("download.awaiting") });
    }
    appendLog(t("log.taskAccepted", { id: event.payload.id }), "info");
  }

  if (event.event === "download.progress") {
    const existing = state.tasks.get(event.payload.id);
    state.tasks.set(event.payload.id, {
      ...(existing ?? { id: event.payload.id, status: "progress", percent: null }),
      status: "progress",
      percent: event.payload.percent,
      message: event.payload.message ?? event.payload.stage ?? undefined
    });
  }

  if (event.event === "download.completed") {
    const existing = state.tasks.get(event.payload.id);
    state.tasks.set(event.payload.id, {
      ...(existing ?? { id: event.payload.id, status: "completed", percent: 100 }),
      status: "completed",
      percent: 100,
      outputPath: event.payload.outputPath ?? null,
      message: event.payload.message ?? t("task.completed")
    });
    appendLog(`Task ${event.payload.id} completed.`, "success");
    void loadLibrary();
  }

  if (event.event === "download.failed") {
    const existing = state.tasks.get(event.payload.id);
    state.tasks.set(event.payload.id, {
      ...(existing ?? { id: event.payload.id, status: "failed", percent: null }),
      status: "failed",
      percent: existing?.percent ?? null,
      message: event.payload.error.message
    });
    appendLog(`Task ${event.payload.id} failed: ${event.payload.error.message}`, "danger");
    presentError(event.payload.error);
  }

  if (event.event === "download.cancelled") {
    const existing = state.tasks.get(event.payload.id);
    state.tasks.set(event.payload.id, {
      ...(existing ?? { id: event.payload.id, status: "cancelled", percent: null }),
      status: "cancelled",
      percent: existing?.percent ?? null,
      message: t("task.cancelled")
    });
    appendLog(`Task ${event.payload.id} was cancelled.`, "warning");
  }

  renderQueue();
  renderCurrentTask();
}

function handleThemeEvent(event: ThemeEventEnvelope): void {
  const incoming = event.payload.theme;

  if ("manifest" in incoming) {
    void loadThemes();
    return;
  }

  state.activeTheme = incoming;
  state.themes = state.themes.map((entry) => ({ ...entry, active: entry.id === incoming.id }));
  applyThemeStyles(incoming);
  renderThemes();
  renderThemeStatus(incoming);
}

async function loadThemes(): Promise<void> {
  const themes = await window.appApi.getThemes();
  state.themes = themes;
  state.activeTheme = themes.find((theme) => theme.active) ?? themes[0] ?? null;

  if (state.activeTheme) {
    applyThemeStyles(state.activeTheme);
  }

  renderThemeStatus(state.activeTheme);
  renderThemes();
}

async function loadLibrary(): Promise<void> {
  state.library = await window.appApi.getLibrary();
  renderLibrary();
}

function shouldAutoRepair(status: SystemStatus | null): boolean {
  if (!status) {
    return false;
  }

  return status.components.some((component) => component.autoInstall && component.availability === "missing");
}

async function ensureRuntimeTools(mode: "auto" | "manual"): Promise<void> {
  if (state.repairInFlight) {
    return;
  }

  state.repairInFlight = true;
  renderSystemStatus();

  if (mode === "auto") {
    pushNotice(t("notice.autoRepairTitle"), t("notice.autoRepairMessage"), "info");
  }

  try {
    state.systemStatus = await window.appApi.repairRuntimeTools();
    renderSystemStatus();
    appendLog(t("log.repairDone"), "success");
  } catch (error) {
    presentError(parseInvokeError(error));
  } finally {
    state.repairInFlight = false;
    renderSystemStatus();
    await refreshSystemStatus();
  }
}

async function refreshSystemStatus(): Promise<void> {
  try {
    state.systemStatus = await window.appApi.getSystemStatus();
    renderSystemStatus();

    for (const notice of state.systemStatus.notices) {
      pushNotice(t("system.details"), notice, "warning");
    }
  } catch (error) {
    presentError(parseInvokeError(error));
  }
}

async function bootstrap(): Promise<void> {
  renderShell();
  bindNavigation();
  bindLanguageSwitcher();
  bindSystemActions();
  bindAnalyzeForm();
  bindDownloadForm();
  bindThemeForms();
  renderAnalyzeResult();
  renderCurrentTask();
  renderQueue();
  renderLibrary();
  renderLogFeed();
  renderNotices();
  renderSystemStatus();
  updateView("downloader");

  try {
    state.defaultOutputDir = await window.appApi.getDefaultOutputDir();
  } catch {
    state.defaultOutputDir = "";
  }

  syncDefaultOutputDir();

  window.appApi.subscribeDownloadEvents(handleDownloadEvent);
  window.appApi.subscribeThemeEvents(handleThemeEvent);

  await refreshSystemStatus();

  if (shouldAutoRepair(state.systemStatus)) {
    void ensureRuntimeTools("auto");
  }

  try {
    await loadThemes();
    appendLog(t("log.themesLoaded"), "success");
  } catch (error) {
    presentError(parseInvokeError(error));
  }

  try {
    await loadLibrary();
  } catch (error) {
    presentError(parseInvokeError(error));
  }
}

void bootstrap();
