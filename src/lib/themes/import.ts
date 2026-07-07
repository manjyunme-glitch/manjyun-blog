export type ThemeManifestAudit = {
  compatible: boolean;
  issues: string[];
  manifest: {
    id: string;
    name: string;
    version: string;
    description: string;
  };
};

const requiredSlots = ["Home", "Post", "Archive", "Page"];
const requiredTokens = ["bg", "surface", "text", "accent"];

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
  const metaRaw = root.meta && typeof root.meta === "object" ? (root.meta as Record<string, unknown>) : {};
  const tokensRaw = root.tokens && typeof root.tokens === "object" ? (root.tokens as Record<string, unknown>) : {};
  const slotsRaw = root.slots;

  const manifest = {
    id: readString(metaRaw, "id"),
    name: readString(metaRaw, "name"),
    version: readString(metaRaw, "version"),
    description: readString(metaRaw, "description")
  };

  if (!manifest.id || !/^[a-z0-9._-]+$/.test(manifest.id)) {
    issues.push("meta.id 必须存在，并且只能包含小写字母、数字、点、下划线或连字符。");
  }
  if (!manifest.name) issues.push("meta.name 缺失。");
  if (!manifest.version) issues.push("meta.version 缺失。");
  if (!manifest.description) issues.push("meta.description 缺失。");

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
      description: manifest.description || "导入的主题 manifest 不完整。"
    }
  };
}
