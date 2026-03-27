import "./styles.css";

import type {
  AnalyzeResult,
  AppRpcError,
  DownloadEventEnvelope,
  DownloadRequest,
  NetworkSettings,
  SystemComponentStatus,
  SystemStatus,
  ThemeEventEnvelope,
  ThemeSummary
} from "../../shared/contracts";
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
  activeTheme: null as ThemeSummary | null,
  systemStatus: null as SystemStatus | null,
  themes: [] as ThemeSummary[],
  analyzeResult: null as AnalyzeResult | null,
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

  return { code: "UNKNOWN", message: "Unknown renderer error." };
}

function appendLog(message: string, tone: LogTone = "info"): void {
  state.logs.unshift({
    id: crypto.randomUUID(),
    timestamp: new Date().toLocaleTimeString(),
    tone,
    message
  });

  state.logs = state.logs.slice(0, 80);
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
  state.notices = state.notices.slice(0, 6);
  renderNotices();
}

function describeError(error: AppRpcError): { title: string; message: string; tone: LogTone; steps: string[] } {
  const details = typeof error.details === "object" && error.details !== null ? (error.details as Record<string, unknown>) : {};
  const helpFromDetails = Array.isArray(details.help) ? details.help.filter((value): value is string => typeof value === "string") : [];

  if (error.code === "BINARY_MISSING") {
    return {
      title: "Missing Binary",
      message: error.message,
      tone: "warning",
      steps:
        helpFromDetails.length > 0
          ? helpFromDetails
          : ["Put the missing executable into libs/.", "Run the system check again after copying the file."]
    };
  }

  if (error.code === "SIDECAR_UNAVAILABLE") {
    return {
      title: "Download Engine Offline",
      message: error.message,
      tone: "warning",
      steps: [
        "The app can fall back to its embedded JS backend when possible.",
        "If you want the native path, build downloader-core.exe and place it in libs/."
      ]
    };
  }

  if (details.category === "ANTI_BOT") {
    return {
      title: "Provider Anti-Bot Challenge",
      message: error.message,
      tone: "warning",
      steps:
        helpFromDetails.length > 0
          ? helpFromDetails
          : ["Try cookies from browser.", "Try impersonation.", "Try a different network path."]
    };
  }

  if (details.category === "NETWORK") {
    return {
      title: "Network Transport Problem",
      message: error.message,
      tone: "warning",
      steps:
        helpFromDetails.length > 0
          ? helpFromDetails
          : [
              "Check the proxy URL.",
              "Switch back to Direct mode to isolate the failure.",
              "If you use System DPI bypass, verify that the external tool is already configured."
            ]
    };
  }

  if (error.code === "THEME_ERROR") {
    return {
      title: "Theme Problem",
      message: error.message,
      tone: "warning",
      steps: ["Check manifest.json and entryCss.", "Avoid ../ in theme asset paths."]
    };
  }

  return {
    title: "System Message",
    message: error.message,
    tone: error.code === "VALIDATION_ERROR" ? "warning" : "danger",
    steps: helpFromDetails
  };
}

function appendDiagnosticHints(error: AppRpcError): void {
  const message = error.message.toLowerCase();

  if (message.includes("not a bot") || message.includes("sign in")) {
    appendLog(
      "This looks like a server-side anti-bot barrier. Try cookies, impersonation, or a different network path.",
      "warning"
    );
  }

  if (message.includes("proxy") || message.includes("timed out") || message.includes("connection")) {
    appendLog("Network transport may be the real cause here. Check proxy settings or fall back to direct mode.", "warning");
  }

  if (message.includes("deno.exe")) {
    appendLog("YouTube support expects a JavaScript runtime sidecar. Place Deno in libs/ before testing those flows.", "warning");
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
    return "Ready";
  }

  if (availability === "fallback") {
    return "Fallback";
  }

  if (availability === "warning") {
    return "Attention";
  }

  return "Missing";
}

function statusText(task: TaskSnapshot): string {
  if (task.status === "progress" && typeof task.percent === "number") {
    return `${task.percent.toFixed(1)}%`;
  }

  if (task.status === "completed") {
    return "Recovered";
  }

  if (task.status === "failed") {
    return "Broken";
  }

  if (task.status === "cancelled") {
    return "Withdrawn";
  }

  return task.status;
}

function renderShell(): void {
  const app = document.querySelector<HTMLDivElement>("#app");

  if (!app) {
    throw new Error("Missing #app root.");
  }

  app.innerHTML = `
    <div class="shell">
      <aside class="sidebar">
        <div class="brand">
          <p class="eyebrow">Portable Shell</p>
          <h1>Dismas Downloader</h1>
          <p class="lede">A rusted wrapper for lawful captures, local themes, and portable recovery paths.</p>
        </div>

        <nav class="nav">
          <button class="nav-button is-active" data-view="downloader">Downloader</button>
          <button class="nav-button" data-view="queue">Queue</button>
          <button class="nav-button" data-view="themes">Themes</button>
        </nav>

        <section class="sidebar-card legal-card">
          <h2>Use With Permission</h2>
          <p>This shell is intended for media you are allowed to download, archive, or transform.</p>
        </section>

        <section class="sidebar-card theme-status-card">
          <p class="eyebrow">Active Theme</p>
          <h2 id="active-theme-name">Awaiting ember</h2>
          <p id="active-theme-description">No theme has been applied yet.</p>
        </section>

        <section class="sidebar-card network-card">
          <p class="eyebrow">Network Strategy</p>
          <h2>Transport Layer</h2>
          <div class="mini-form">
            <label>
              <span>Route</span>
              <select id="network-strategy">
                <option value="direct">Direct</option>
                <option value="proxy">Proxy</option>
                <option value="system-bypass">System DPI bypass</option>
              </select>
            </label>
            <label>
              <span>Proxy URL</span>
              <input id="proxy-url" type="text" placeholder="socks5://127.0.0.1:1080" />
            </label>
            <label>
              <span>Impersonate</span>
              <input id="impersonate-value" type="text" placeholder="chrome-120:windows-10" />
            </label>
            <label>
              <span>Cookies From Browser</span>
              <input id="cookies-browser" type="text" placeholder="chrome" />
            </label>
          </div>
          <p class="hint-copy">System bypass assumes an external Zapret2 or local proxy setup and may require administrator rights.</p>
        </section>

        <section class="sidebar-card system-card">
          <p class="eyebrow">System Health</p>
          <h2 id="system-summary">Scanning portable layout</h2>
          <p id="system-mode-copy">Checking sidecar mode, binaries, themes, and portable notices.</p>
          <div id="system-capabilities" class="capability-list empty-inline">Capabilities pending.</div>
          <div id="system-components" class="component-list empty-inline">No diagnostics yet.</div>
        </section>
      </aside>

      <main class="workspace">
        <header class="masthead">
          <div>
            <p class="eyebrow">Starter Kit</p>
            <h2 id="view-title">Downloader</h2>
          </div>
          <div id="status-strip" class="status-strip">
            <span class="status-pill">Portable roots</span>
            <span class="status-pill">Context isolated</span>
            <span class="status-pill">Diagnostics pending</span>
          </div>
        </header>

        <section id="notice-tray" class="notice-tray empty-state">
          No active recovery notices.
        </section>

        <section class="view is-active" data-panel="downloader">
          <div class="panel hero-panel">
            <div class="panel-header">
              <div>
                <p class="eyebrow">Analyze</p>
                <h3>Scout the target</h3>
              </div>
            </div>
            <form id="analyze-form" class="stack-form">
              <label>
                <span>Media URL</span>
                <input id="url-input" name="url" type="url" placeholder="https://example.com/watch?v=..." required />
              </label>
              <div class="form-actions">
                <button type="submit" class="accent-button">Analyze</button>
              </div>
            </form>
            <article id="analyze-result" class="analyze-result empty-state">
              No reconnaissance yet.
            </article>
          </div>

          <div class="panel ritual-panel">
            <div class="panel-header">
              <div>
                <p class="eyebrow">Download</p>
                <h3>Commit the ritual</h3>
              </div>
            </div>
            <form id="download-form" class="stack-form">
              <label>
                <span>Output Directory</span>
                <input id="output-dir-input" name="outputDir" type="text" placeholder="C:\\Users\\you\\Downloads" required />
              </label>
              <label>
                <span>Preset</span>
                <select id="preset-input" name="preset">
                  <option value="best">Best Video + Audio</option>
                  <option value="mp3">Audio Only MP3</option>
                </select>
              </label>
              <div class="form-actions">
                <button type="submit" class="accent-button">Start Download</button>
              </div>
            </form>
            <div id="download-current" class="current-task empty-state">
              No active task.
            </div>
          </div>
        </section>

        <section class="view" data-panel="queue">
          <div class="panel queue-panel">
            <div class="panel-header">
              <div>
                <p class="eyebrow">Queue</p>
                <h3>March of the expedition</h3>
              </div>
            </div>
            <div id="queue-list" class="queue-list empty-state">The ledger is empty.</div>
          </div>

          <div class="panel log-panel">
            <div class="panel-header">
              <div>
                <p class="eyebrow">Event Log</p>
                <h3>Scars and signals</h3>
              </div>
            </div>
            <div id="log-feed" class="log-feed empty-state">No omens yet.</div>
          </div>
        </section>

        <section class="view" data-panel="themes">
          <div class="themes-layout">
            <div class="panel theme-browser-panel">
              <div class="panel-header">
                <div>
                  <p class="eyebrow">Themes</p>
                  <h3>Portable skins</h3>
                </div>
              </div>
              <div id="themes-grid" class="themes-grid empty-state">No themes discovered.</div>
            </div>

            <div class="panel theme-tools-panel">
              <div class="panel-header">
                <div>
                  <p class="eyebrow">Workshop</p>
                  <h3>Import, export, create</h3>
                </div>
              </div>

              <form id="import-form" class="stack-form compact-form">
                <label>
                  <span>Theme archive path</span>
                  <input name="filePath" type="text" placeholder="C:\\themes\\my-theme.ydtheme" required />
                </label>
                <button type="submit" class="accent-button">Import Theme</button>
              </form>

              <form id="export-form" class="stack-form compact-form">
                <label>
                  <span>Theme ID</span>
                  <input name="id" type="text" placeholder="default_darkest" required />
                </label>
                <label>
                  <span>Output archive path</span>
                  <input name="outPath" type="text" placeholder="C:\\themes\\darkest.ydtheme" required />
                </label>
                <button type="submit" class="ghost-button">Export Theme</button>
              </form>

              <form id="create-theme-form" class="stack-form compact-form">
                <label>
                  <span>Theme ID</span>
                  <input name="id" type="text" placeholder="blood_steel" required />
                </label>
                <label>
                  <span>Display name</span>
                  <input name="name" type="text" placeholder="Blood Steel" required />
                </label>
                <label>
                  <span>Description</span>
                  <input name="description" type="text" placeholder="Portable forged variant" />
                </label>
                <label>
                  <span>Accent color</span>
                  <input name="accent" type="text" placeholder="#8a0303" />
                </label>
                <button type="submit" class="ghost-button">Create Theme</button>
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
    title.textContent = nextView.charAt(0).toUpperCase() + nextView.slice(1);
  }
}

function renderNotices(): void {
  const tray = document.querySelector<HTMLDivElement>("#notice-tray");
  if (!tray) {
    return;
  }

  if (state.notices.length === 0) {
    tray.className = "notice-tray empty-state";
    tray.textContent = "No active recovery notices.";
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

  if (!summary || !modeCopy || !capabilityList || !componentList || !statusStrip) {
    return;
  }

  const status = state.systemStatus;

  if (!status) {
    summary.textContent = "Scanning portable layout";
    modeCopy.textContent = "Checking sidecar mode, binaries, themes, and portable notices.";
    capabilityList.className = "capability-list empty-inline";
    capabilityList.textContent = "Capabilities pending.";
    componentList.className = "component-list empty-inline";
    componentList.textContent = "No diagnostics yet.";
    return;
  }

  const readyCount = status.components.filter((entry) => entry.availability === "ready").length;
  const blockerCount = status.components.filter((entry) => entry.availability === "missing").length;
  const warningCount = status.components.filter((entry) => entry.availability === "warning" || entry.availability === "fallback").length;

  summary.textContent =
    blockerCount === 0 ? `Operational posture ${readyCount}/${status.components.length}` : `${blockerCount} blocker${blockerCount === 1 ? "" : "s"} detected`;

  modeCopy.textContent = `Sidecar mode: ${status.sidecarMode}${status.sidecarVersion ? ` (${status.sidecarVersion})` : ""}. ${warningCount > 0 ? `${warningCount} attention marker${warningCount === 1 ? "" : "s"} active.` : "No active warnings."}`;

  const capabilityEntries = [
    { label: "Analyze", value: status.capabilities.canAnalyze },
    { label: "Download", value: status.capabilities.canDownload },
    { label: "YouTube", value: status.capabilities.canUseYoutube },
    { label: "Themes", value: status.capabilities.canManageThemes }
  ];

  capabilityList.className = "capability-list";
  capabilityList.innerHTML = capabilityEntries
    .map(
      (entry) => `
        <span class="capability-pill ${entry.value ? "is-ready" : "is-blocked"}">
          ${escapeHtml(entry.label)}: ${entry.value ? "ready" : "limited"}
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
          <p class="component-help">${escapeHtml(component.help[0] ?? "No recovery hint recorded.")}</p>
        </article>
      `
    )
    .join("");

  statusStrip.innerHTML = `
    <span class="status-pill">Portable roots</span>
    <span class="status-pill">Context isolated</span>
    <span class="status-pill">Mode: ${escapeHtml(status.sidecarMode)}</span>
    <span class="status-pill">${escapeHtml(blockerCount === 0 ? "No hard blockers" : `${blockerCount} blocker${blockerCount === 1 ? "" : "s"}`)}</span>
  `;
}

function renderAnalyzeResult(): void {
  const container = document.querySelector<HTMLDivElement>("#analyze-result");
  if (!container) {
    return;
  }

  const result = state.analyzeResult;

  if (!result) {
    container.className = "analyze-result empty-state";
    container.innerHTML = "No reconnaissance yet.";
    return;
  }

  container.className = "analyze-result";
  container.innerHTML = `
    <div class="result-media">
      ${
        result.thumbnailUrl
          ? `<img class="result-thumb" src="${escapeHtml(result.thumbnailUrl)}" alt="Thumbnail for ${escapeHtml(result.title)}" />`
          : `<div class="result-thumb result-thumb--empty">No preview</div>`
      }
      <div class="result-copy">
        <p class="eyebrow">Source</p>
        <h4>${escapeHtml(result.title)}</h4>
        <p>${escapeHtml(result.uploader ?? "Unknown uploader")} - ${escapeHtml(result.extractor ?? "Unknown extractor")}</p>
        <p>Duration: ${escapeHtml(result.durationSeconds ? `${Math.round(result.durationSeconds)}s` : "unknown")}</p>
        <p>Formats discovered: ${result.formats.length}</p>
      </div>
    </div>
  `;
}

function renderCurrentTask(): void {
  const container = document.querySelector<HTMLDivElement>("#download-current");
  if (!container) {
    return;
  }

  const latestTask = [...state.tasks.values()][0];

  if (!latestTask) {
    container.className = "current-task empty-state";
    container.textContent = "No active task.";
    return;
  }

  const progressPercent = typeof latestTask.percent === "number" ? `${latestTask.percent.toFixed(1)}%` : "Awaiting";

  container.className = "current-task";
  container.innerHTML = `
    <div class="task-card-head">
      <div>
        <p class="eyebrow">Task ${escapeHtml(latestTask.id.slice(0, 8))}</p>
        <h4>${escapeHtml(latestTask.preset ?? "preset")} - ${escapeHtml(statusText(latestTask))}</h4>
      </div>
      <button class="danger-button" data-cancel-id="${escapeHtml(latestTask.id)}">Cancel</button>
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
      appendLog(`Withdrawal ordered for task ${id}.`, "warning");
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
    queueList.textContent = "The ledger is empty.";
    return;
  }

  queueList.className = "queue-list";
  queueList.innerHTML = tasks
    .map(
      (task) => `
        <article class="queue-item status-${task.status}">
          <div>
            <p class="eyebrow">${escapeHtml(task.id)}</p>
            <h4>${escapeHtml(task.url ?? "Unknown target")}</h4>
          </div>
          <div class="queue-meta">
            <strong>${escapeHtml(statusText(task))}</strong>
            <span>${escapeHtml(task.preset ?? "unknown")}${task.outputPath ? ` - ${escapeHtml(task.outputPath)}` : ""}</span>
          </div>
        </article>
      `
    )
    .join("");
}

function renderLogFeed(): void {
  const feed = document.querySelector<HTMLDivElement>("#log-feed");
  if (!feed) {
    return;
  }

  if (state.logs.length === 0) {
    feed.className = "log-feed empty-state";
    feed.textContent = "No omens yet.";
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
    name.textContent = "Awaiting ember";
    description.textContent = "No theme has been applied yet.";
    return;
  }

  name.textContent = theme.name;
  description.textContent = theme.description ?? "A portable skin is holding the shell together.";
}

function renderThemes(): void {
  const grid = document.querySelector<HTMLDivElement>("#themes-grid");
  if (!grid) {
    return;
  }

  if (state.themes.length === 0) {
    grid.className = "themes-grid empty-state";
    grid.textContent = "No themes discovered.";
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
                : `<div class="theme-preview-placeholder">No preview</div>`
            }
          </div>
          <div class="theme-copy">
            <p class="eyebrow">${escapeHtml(theme.id)}</p>
            <h4>${escapeHtml(theme.name)}</h4>
            <p>${escapeHtml(theme.description ?? "No description.")}</p>
            <div class="theme-meta">
              <span>${escapeHtml(theme.version)}</span>
              <span>${escapeHtml(theme.author)}</span>
            </div>
          </div>
          <button class="${theme.active ? "ghost-button" : "accent-button"}" data-apply-theme="${escapeHtml(theme.id)}">
            ${theme.active ? "Active" : "Apply Theme"}
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
        appendLog(`Theme ${theme.name} now rules the shell.`, "success");
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
      appendLog("A URL is required before reconnaissance.", "warning");
      return;
    }

    try {
      const result = await window.appApi.analyzeUrl(url, readNetworkSettings());
      state.analyzeResult = result;
      renderAnalyzeResult();
      appendLog(`Analysis completed for ${result.title}.`, "success");
    } catch (error) {
      presentError(parseInvokeError(error));
      void refreshSystemStatus(false);
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
    const payload: DownloadRequest = {
      id: crypto.randomUUID(),
      url: urlInput.value.trim(),
      outputDir: String(formData.get("outputDir") ?? "").trim(),
      preset: String(formData.get("preset") ?? "best") === "mp3" ? "mp3" : "best",
      network: readNetworkSettings()
    };

    if (!payload.url || !payload.outputDir) {
      appendLog("URL and output directory are both required.", "warning");
      return;
    }

    try {
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
      appendLog(`Task ${payload.id} accepted into the march.`, "info");
    } catch (error) {
      presentError(parseInvokeError(error));
      void refreshSystemStatus(false);
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
      appendLog(`Imported theme ${theme.name}.`, "success");
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
      appendLog(`Theme ${id} exported to ${result.outPath}.`, "success");
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
      appendLog(`Created theme ${theme.name}.`, "success");
    } catch (error) {
      presentError(parseInvokeError(error));
    }
  });
}

function handleDownloadEvent(event: DownloadEventEnvelope): void {
  if (event.event === "system.error") {
    presentError(event.payload.error);
    void refreshSystemStatus(false);
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
    appendLog(`Task ${event.payload.id} queued.`, "info");
  }

  if (event.event === "download.started") {
    const existing = state.tasks.get(event.payload.id);
    if (existing) {
      state.tasks.set(event.payload.id, { ...existing, status: "started", message: "Transfer engaged" });
    }
    appendLog(`Task ${event.payload.id} started.`, "info");
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
      message: event.payload.message ?? "Payload secured"
    });
    appendLog(`Task ${event.payload.id} completed.`, "success");
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
      message: "Retreat ordered"
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

async function refreshSystemStatus(pushRecoveredNotice = true): Promise<void> {
  try {
    state.systemStatus = await window.appApi.getSystemStatus();
    renderSystemStatus();

    for (const notice of state.systemStatus.notices) {
      pushNotice("Recovery Hint", notice, "warning");
    }

    if (pushRecoveredNotice && state.systemStatus.notices.length === 0) {
      pushNotice(
        "System Ready",
        "Portable diagnostics completed without active blockers. You can still inspect the sidebar for optional improvements.",
        "success"
      );
    }
  } catch (error) {
    presentError(parseInvokeError(error));
  }
}

async function bootstrap(): Promise<void> {
  renderShell();
  bindNavigation();
  bindAnalyzeForm();
  bindDownloadForm();
  bindThemeForms();
  renderAnalyzeResult();
  renderCurrentTask();
  renderQueue();
  renderLogFeed();
  renderNotices();
  renderSystemStatus();
  updateView("downloader");

  window.appApi.subscribeDownloadEvents(handleDownloadEvent);
  window.appApi.subscribeThemeEvents(handleThemeEvent);

  await refreshSystemStatus();

  try {
    await loadThemes();
    appendLog("Themes discovered and bound to the shell.", "success");
  } catch (error) {
    presentError(parseInvokeError(error));
  }
}

void bootstrap();
