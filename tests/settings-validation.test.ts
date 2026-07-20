import assert from "node:assert/strict";
import test from "node:test";
import {
  isValidCalendarDate,
  moveOrderedItem,
  normalizeOrder,
  validateSiteConfigurationPayload
} from "@/lib/admin/settings-validation";

const settings = {
  siteTitle: "ManJyun",
  siteDescription: "Self-hosted notes",
  baseUrl: "https://example.com",
  activeTheme: "neon-rift",
  heroBio: "Bio",
  heroTags: "Docker, Linux",
  stackItems: "Docker",
  uptimeStart: "2026-03-20",
  blogTitle: "随笔",
  blogDescription: "Blog",
  projectsTitle: "Projects",
  projectsDescription: "Projects",
  aboutTitle: "About",
  aboutMarkdown: "About"
};

const modules = [
  { id: "recentPosts", enabled: true, sortOrder: 10, config: { limit: 3 } },
  { id: "now", enabled: true, sortOrder: 20, config: {} },
  { id: "projects", enabled: true, sortOrder: 30, config: { limit: 3 } },
  { id: "frequentLinks", enabled: true, sortOrder: 40, config: {} },
  { id: "stack", enabled: true, sortOrder: 50, config: {} }
];

test("settings validation excludes activeTheme and normalizes order", () => {
  const result = validateSiteConfigurationPayload({
    settings,
    modules,
    mainLinks: [{ label: "Home", url: "/", iconUrl: null, sortOrder: 99 }],
    frequentLinks: [{ label: "OpenAI", url: "https://openai.com", iconUrl: "/icon.png", sortOrder: 2 }]
  });
  assert.equal(result.ok, true, result.issues.join("\n"));
  assert.equal("activeTheme" in result.value.settings, false);
  assert.equal("aboutTitle" in result.value.settings, false);
  assert.equal("aboutMarkdown" in result.value.settings, false);
  assert.equal(result.value.mainLinks[0]?.sortOrder, 10);
});

test("settings validation rejects unsafe URLs and invalid limits", () => {
  const result = validateSiteConfigurationPayload({
    settings: { ...settings, baseUrl: "javascript:alert(1)" },
    modules: modules.map((module) => module.id === "projects" ? { ...module, config: { limit: 0 } } : module),
    mainLinks: [{ label: "Bad", url: "javascript:alert(1)" }],
    frequentLinks: []
  });
  assert.equal(result.ok, false);
  assert.ok(result.issues.some((issue) => issue.includes("站点 URL")));
  assert.ok(result.issues.some((issue) => issue.includes("projects")));
  assert.ok(result.issues.some((issue) => issue.includes("主导航")));
});

test("calendar date validation rejects normalized overflow and handles leap years", () => {
  assert.equal(isValidCalendarDate("2024-02-29"), true);
  assert.equal(isValidCalendarDate("2000-02-29"), true);
  assert.equal(isValidCalendarDate("1900-02-29"), false);
  assert.equal(isValidCalendarDate("2026-02-29"), false);
  assert.equal(isValidCalendarDate("2026-02-31"), false);
  assert.equal(isValidCalendarDate("2026-04-31"), false);
  assert.equal(isValidCalendarDate("2026-13-01"), false);
  assert.equal(isValidCalendarDate("2026-00-10"), false);
  assert.equal(isValidCalendarDate("2026-1-01"), false);

  const result = validateSiteConfigurationPayload({
    settings: { ...settings, uptimeStart: "2026-02-31" },
    modules,
    mainLinks: [],
    frequentLinks: []
  });
  assert.equal(result.ok, false);
  assert.deepEqual(result.fieldErrors["settings.uptimeStart"], [
    "Uptime 起始日期必须是有效的 YYYY-MM-DD 日期。"
  ]);
});

test("settings validation keeps incomplete links visible and reports field errors", () => {
  const result = validateSiteConfigurationPayload({
    settings,
    modules,
    mainLinks: [
      { label: "Home", url: "/" },
      { label: "Incomplete", url: "" },
      { label: "", url: "/missing-label" }
    ],
    frequentLinks: []
  });

  assert.equal(result.ok, false);
  assert.equal(result.value.mainLinks.length, 3);
  assert.deepEqual(result.fieldErrors["mainLinks.1.url"], [
    "主导航“Incomplete”的 URL 必须是站内路径或 HTTP(S) 地址。"
  ]);
  assert.deepEqual(result.fieldErrors["mainLinks.2.label"], [
    "主导航第 3 项缺少名称。"
  ]);
});

test("ordered item helpers use stable ten-point order values", () => {
  const items = normalizeOrder(moveOrderedItem([{ id: "a", sortOrder: 5 }, { id: "b", sortOrder: 99 }], 1, -1));
  assert.deepEqual(items, [{ id: "b", sortOrder: 10 }, { id: "a", sortOrder: 20 }]);
});

