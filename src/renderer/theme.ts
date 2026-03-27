import type { ThemeSummary } from "../../shared/contracts";

const THEME_LINK_ID = "theme-stylesheet";
const THEME_VARIABLE_STYLE_ID = "theme-variable-style";

function getOrCreateStyle(id: string, tagName: "style" | "link"): HTMLStyleElement | HTMLLinkElement {
  const existing = document.getElementById(id);

  if (existing) {
    return existing as HTMLStyleElement | HTMLLinkElement;
  }

  const element = document.createElement(tagName);
  element.id = id;
  document.head.append(element);
  return element;
}

export function applyThemeStyles(theme: ThemeSummary): void {
  const variableStyle = getOrCreateStyle(THEME_VARIABLE_STYLE_ID, "style") as HTMLStyleElement;
  const stylesheetLink = getOrCreateStyle(THEME_LINK_ID, "link") as HTMLLinkElement;

  stylesheetLink.rel = "stylesheet";
  stylesheetLink.href = `${theme.stylesheetUrl}?v=${encodeURIComponent(theme.version)}-${Date.now()}`;

  const variables = theme.variables ?? {};
  const cssVariables = Object.entries(variables)
    .map(([key, value]) => `  ${key}: ${value};`)
    .join("\n");

  variableStyle.textContent = `:root {\n${cssVariables}\n}`;

  document.body.dataset.themeId = theme.id;
  document.body.style.setProperty("--theme-preview", theme.previewUrl ? `url("${theme.previewUrl}")` : "none");
}
