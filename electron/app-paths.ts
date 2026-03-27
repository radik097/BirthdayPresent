import { app } from "electron";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import type { AppSettings } from "../shared/contracts";

const DEFAULT_SETTINGS: AppSettings = {
  activeThemeId: "default_darkest"
};

export interface RuntimePaths {
  appRoot: string;
  themesDir: string;
  libsDir: string;
  dataDir: string;
  logsDir: string;
  settingsFile: string;
  downloadsDbFile: string;
  rendererIndexHtml: string;
}

export function getRuntimePaths(): RuntimePaths {
  const appRoot = app.isPackaged ? path.dirname(process.execPath) : path.resolve(__dirname, "..");

  return {
    appRoot,
    themesDir: path.join(appRoot, "themes"),
    libsDir: path.join(appRoot, "libs"),
    dataDir: path.join(appRoot, "data"),
    logsDir: path.join(appRoot, "data", "logs"),
    settingsFile: path.join(appRoot, "data", "settings.json"),
    downloadsDbFile: path.join(appRoot, "data", "downloads.db"),
    rendererIndexHtml: path.join(__dirname, "..", "dist", "index.html")
  };
}

export async function ensurePortableLayout(paths: RuntimePaths): Promise<void> {
  await mkdir(paths.themesDir, { recursive: true });
  await mkdir(paths.libsDir, { recursive: true });
  await mkdir(paths.dataDir, { recursive: true });
  await mkdir(paths.logsDir, { recursive: true });

  try {
    await access(paths.settingsFile);
  } catch {
    await writeFile(paths.settingsFile, `${JSON.stringify(DEFAULT_SETTINGS, null, 2)}\n`, "utf8");
  }
}

export async function readSettings(paths: RuntimePaths): Promise<AppSettings> {
  try {
    const raw = await readFile(paths.settingsFile, "utf8");
    const parsed = JSON.parse(raw) as Partial<AppSettings>;

    return {
      activeThemeId: parsed.activeThemeId || DEFAULT_SETTINGS.activeThemeId
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

