import type { HomeModule, NavLink, SiteSettings } from "@/types/blog";

export const editableSiteSettingKeys = [
  "siteTitle",
  "siteDescription",
  "baseUrl",
  "heroBio",
  "heroTags",
  "stackItems",
  "uptimeStart",
  "blogTitle",
  "blogDescription",
  "projectsTitle",
  "projectsDescription",
  "aboutTitle",
  "aboutMarkdown"
] as const satisfies ReadonlyArray<Exclude<keyof SiteSettings, "activeTheme">>;

type EditableSettingKey = (typeof editableSiteSettingKeys)[number];
export type EditableSiteSettings = Pick<SiteSettings, EditableSettingKey>;
export type LinkInput = Omit<NavLink, "id" | "groupName">;

const moduleIds = new Set(["recentPosts", "now", "projects", "frequentLinks", "stack"]);

function validPublicUrl(value: string) {
  if (value.startsWith("/") && !value.startsWith("//")) return true;
  try {
    const url = new URL(value);
    return (url.protocol === "http:" || url.protocol === "https:") && !url.username && !url.password;
  } catch {
    return false;
  }
}

export function normalizeOrder<T extends { sortOrder: number }>(items: T[]) {
  return items.map((item, index) => ({ ...item, sortOrder: (index + 1) * 10 }));
}

export function moveOrderedItem<T>(items: T[], index: number, direction: -1 | 1) {
  const target = index + direction;
  if (index < 0 || target < 0 || index >= items.length || target >= items.length) return items;
  const next = [...items];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

export function validateSiteConfigurationPayload(input: {
  settings?: unknown;
  modules?: unknown;
  mainLinks?: unknown;
  frequentLinks?: unknown;
}) {
  const issues: string[] = [];
  const source = input.settings && typeof input.settings === "object" && !Array.isArray(input.settings)
    ? input.settings as Record<string, unknown>
    : {};
  const settings = {} as EditableSiteSettings;
  for (const key of editableSiteSettingKeys) {
    settings[key] = String(source[key] ?? "") as never;
  }

  if (!settings.siteTitle.trim()) issues.push("站点标题不能为空。");
  if (settings.siteTitle.length > 120) issues.push("站点标题不能超过 120 个字符。");
  try {
    const baseUrl = new URL(settings.baseUrl);
    if (!["http:", "https:"].includes(baseUrl.protocol) || baseUrl.username || baseUrl.password) throw new Error();
  } catch {
    issues.push("站点 URL 必须是没有账号信息的 HTTP(S) 绝对地址。");
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(settings.uptimeStart) || Number.isNaN(Date.parse(`${settings.uptimeStart}T00:00:00Z`))) {
    issues.push("Uptime 起始日期必须是有效的 YYYY-MM-DD 日期。");
  }
  if (!settings.blogTitle.trim() || !settings.projectsTitle.trim() || !settings.aboutTitle.trim()) {
    issues.push("随笔、项目和 About 页面标题不能为空。");
  }
  if (settings.aboutMarkdown.length > 200_000) issues.push("About Markdown 不能超过 200,000 个字符。");

  const modules = Array.isArray(input.modules)
    ? input.modules.map((raw) => {
        const module = raw as Partial<HomeModule>;
        const id = String(module.id ?? "");
        const config = module.config && typeof module.config === "object" ? { ...module.config } : {};
        if (!moduleIds.has(id)) issues.push(`未知首页模块：${id || "(空)"}。`);
        if (id === "recentPosts" || id === "projects") {
          const limit = Number(config.limit ?? 8);
          if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
            issues.push(`${id} 的显示数量必须是 1 到 50 的整数。`);
          } else {
            config.limit = limit;
          }
        }
        return {
          id,
          enabled: Boolean(module.enabled),
          sortOrder: Number(module.sortOrder) || 0,
          config
        } satisfies HomeModule;
      })
    : [];
  if (modules.length !== moduleIds.size || new Set(modules.map((module) => module.id)).size !== modules.length) {
    issues.push("首页模块列表不完整或包含重复项。");
  }

  function cleanLinks(raw: unknown, label: string): LinkInput[] {
    if (!Array.isArray(raw)) return [];
    const links = raw.map((item, index) => {
      const link = item as Record<string, unknown>;
      const value = {
        label: String(link.label ?? "").trim(),
        url: String(link.url ?? "").trim(),
        iconUrl: String(link.iconUrl ?? "").trim() || null,
        sortOrder: (index + 1) * 10
      };
      if (!value.label) issues.push(`${label}第 ${index + 1} 项缺少名称。`);
      if (!validPublicUrl(value.url)) issues.push(`${label}“${value.label || index + 1}”的 URL 必须是站内路径或 HTTP(S) 地址。`);
      if (value.iconUrl && !validPublicUrl(value.iconUrl)) issues.push(`${label}“${value.label || index + 1}”的图标 URL 无效。`);
      return value;
    });
    return links.filter((link) => link.label && link.url);
  }

  const mainLinks = cleanLinks(input.mainLinks, "主导航");
  const frequentLinks = cleanLinks(input.frequentLinks, "常用链接");

  return {
    ok: issues.length === 0,
    issues,
    value: {
      settings,
      modules: normalizeOrder([...modules].sort((a, b) => a.sortOrder - b.sortOrder)),
      mainLinks,
      frequentLinks
    }
  };
}
