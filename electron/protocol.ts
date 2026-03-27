import { net, protocol } from "electron";
import path from "node:path";
import { access } from "node:fs/promises";
import { pathToFileURL } from "node:url";

import type { RuntimePaths } from "./app-paths";

const DISMAS_PROTOCOL = "dismas";

function normalizeSegment(segment: string): string {
  return decodeURIComponent(segment).replaceAll("\\", "/");
}

function safeResolve(baseDir: string, fragments: string[]): string | null {
  const target = path.resolve(baseDir, ...fragments.map(normalizeSegment));
  const relative = path.relative(baseDir, target);

  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    return null;
  }

  return target;
}

export function registerDismasProtocol(paths: RuntimePaths): void {
  protocol.handle(DISMAS_PROTOCOL, async (request) => {
    const url = new URL(request.url);

    if (url.hostname !== "theme") {
      return new Response("Not found", { status: 404 });
    }

    const [themeId, ...fileParts] = url.pathname.split("/").filter(Boolean);

    if (!themeId || fileParts.length === 0) {
      return new Response("Not found", { status: 404 });
    }

    const themeDir = path.join(paths.themesDir, themeId);
    const filePath = safeResolve(themeDir, fileParts);

    if (!filePath) {
      return new Response("Forbidden", { status: 403 });
    }

    try {
      await access(filePath);
      return net.fetch(pathToFileURL(filePath).toString());
    } catch {
      return new Response("Not found", { status: 404 });
    }
  });
}

export function toThemeAssetUrl(themeId: string, relativePath: string): string {
  const normalized = relativePath
    .replaceAll("\\", "/")
    .split("/")
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join("/");

  return `${DISMAS_PROTOCOL}://theme/${encodeURIComponent(themeId)}/${normalized}`;
}
