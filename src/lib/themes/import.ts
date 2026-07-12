import { getThemeContractIssues } from "@/lib/themes/contract";
import {
  THEME_API_VERSION,
  type ThemeCapability,
  type ThemeCoreCompatibility
} from "@/themes/types";

export type ThemeManifestAudit = {
  compatible: boolean;
  issues: string[];
  manifest: {
    id: string;
    name: string;
    version: string;
    description: string;
    apiVersion: string;
    coreCompatibility: ThemeCoreCompatibility;
    capabilities: ThemeCapability[];
  };
};

const requiredSlots = ["Home", "Collection", "Entry", "Page", "NotFound"];
const requiredTokens = ["bg", "surface", "text", "accent"];
const knownCapabilities = new Set<ThemeCapability>([
  "home-modules",
  "entry-toc",
  "entry-navigation",
  "custom-pages",
  "not-found"
]);

function readString(source: Record<string, unknown>, key: string) {
  const value = source[key];
  return typeof value === "string" ? value.trim() : "";
}

function readRoot(raw: unknown, issues: string[]) {
  let source = raw;

  if (typeof raw === "string") {
    try {
      source = JSON.parse(raw) as unknown;
    } catch {
      issues.push("主题文件不是合法 JSON。");
      return {};
    }
  }

  if (source && typeof source === "object" && !Array.isArray(source)) {
    return source as Record<string, unknown>;
  }

  issues.push("theme manifest 必须是 JSON 对象。");
  return {};
}

export function auditThemeManifest(raw: unknown): ThemeManifestAudit {
  const issues: string[] = [];
  const root = readRoot(raw, issues);
  const metaRaw = root.meta && typeof root.meta === "object"
    ? (root.meta as Record<string, unknown>)
    : {};
  const tokensRaw = root.tokens && typeof root.tokens === "object"
    ? (root.tokens as Record<string, unknown>)
    : {};
  const compatibilityRaw =
    root.coreCompatibility && typeof root.coreCompatibility === "object"
      ? (root.coreCompatibility as Record<string, unknown>)
      : {};
  const slotsRaw = root.slots;
  const capabilitiesRaw = root.capabilities;
  const capabilities = Array.isArray(capabilitiesRaw)
    ? capabilitiesRaw.map(String).filter((capability): capability is ThemeCapability =>
        knownCapabilities.has(capability as ThemeCapability)
      )
    : [];
  const unknownCapabilities = Array.isArray(capabilitiesRaw)
    ? capabilitiesRaw
        .map(String)
        .filter((capability) => !knownCapabilities.has(capability as ThemeCapability))
    : [];

  const manifest = {
    id: readString(metaRaw, "id"),
    name: readString(metaRaw, "name"),
    version: readString(metaRaw, "version"),
    description: readString(metaRaw, "description"),
    apiVersion: readString(root, "apiVersion"),
    coreCompatibility: {
      minimum: readString(compatibilityRaw, "minimum"),
      maximumExclusive:
        readString(compatibilityRaw, "maximumExclusive") || undefined
    },
    capabilities
  };

  if (!manifest.id || !/^[a-z0-9._-]+$/.test(manifest.id)) {
    issues.push("meta.id 必须存在，并且只能包含小写字母、数字、点、下划线或连字符。");
  }
  if (!manifest.name) issues.push("meta.name 缺失。");
  if (!manifest.version) issues.push("meta.version 缺失。");
  if (!manifest.description) issues.push("meta.description 缺失。");
  if (!Array.isArray(capabilitiesRaw)) issues.push("capabilities 必须是数组。");
  for (const capability of unknownCapabilities) {
    issues.push(`capabilities 包含未知能力 ${capability}。`);
  }

  issues.push(...getThemeContractIssues({
    apiVersion: manifest.apiVersion,
    coreCompatibility: manifest.coreCompatibility
  }));

  for (const token of requiredTokens) {
    if (!readString(tokensRaw, token)) {
      issues.push(`tokens.${token} 缺失。`);
    }
  }

  const slots = Array.isArray(slotsRaw)
    ? slotsRaw.map((slot) => String(slot))
    : slotsRaw && typeof slotsRaw === "object"
      ? Object.keys(slotsRaw)
      : [];

  for (const slot of requiredSlots) {
    if (!slots.includes(slot)) {
      issues.push(`slots 必须声明 ${slot}。`);
    }
  }

  return {
    compatible: issues.length === 0,
    issues,
    manifest: {
      id: manifest.id || "invalid-theme",
      name: manifest.name || "Invalid theme",
      version: manifest.version || "0.0.0",
      description: manifest.description || "导入的主题 manifest 不完整。",
      apiVersion: manifest.apiVersion || THEME_API_VERSION,
      coreCompatibility: manifest.coreCompatibility,
      capabilities: manifest.capabilities
    }
  };
}
