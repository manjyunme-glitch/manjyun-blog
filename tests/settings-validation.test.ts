import assert from "node:assert/strict";
import test from "node:test";
import {
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

test("ordered item helpers use stable ten-point order values", () => {
  const items = normalizeOrder(moveOrderedItem([{ id: "a", sortOrder: 5 }, { id: "b", sortOrder: 99 }], 1, -1));
  assert.deepEqual(items, [{ id: "b", sortOrder: 10 }, { id: "a", sortOrder: 20 }]);
});

