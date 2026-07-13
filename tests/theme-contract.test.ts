import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { getThemeContractIssues } from "@/lib/themes/contract";
import { resolveThemeMutation } from "@/lib/themes/selection";
import {
  presentEntrySummary,
  presentNavigation,
  presentPage
} from "@/lib/themes/presenter";
import { manjyunConsoleTheme } from "@/themes/manjyun-console";
import { neonRiftTheme } from "@/themes/neon-rift";
import { paperAtlasTheme } from "@/themes/paper-atlas";
import type { NavLink, PostRecord, SiteSettings } from "@/types/blog";

const post: PostRecord = {
  id: 42,
  type: "post",
  slug: "central-url",
  title: "Central URL",
  markdown: "Body",
  excerpt: "Excerpt",
  cover: null,
  status: "published",
  publishedAt: "2026-07-10T08:00:00.000Z",
  seoTitle: null,
  seoDescription: null,
  createdAt: "2026-07-09T08:00:00.000Z",
  updatedAt: "2026-07-10T08:00:00.000Z",
  tags: [{ id: 7, slug: "theme-sdk", name: "Theme SDK" }]
};

const navLinks: NavLink[] = [
  {
    id: 1,
    groupName: "main",
    label: "首页",
    url: "/",
    iconUrl: null,
    sortOrder: 0
  },
  {
    id: 2,
    groupName: "main",
    label: "随笔",
    url: "/posts",
    iconUrl: null,
    sortOrder: 1
  },
  {
    id: 3,
    groupName: "main",
    label: "外部",
    url: "https://example.com/path",
    iconUrl: null,
    sortOrder: 2
  }
];

const settings: SiteSettings = {
  siteTitle: "Theme Test",
  siteDescription: "Description",
  baseUrl: "https://example.com",
  activeTheme: "manjyun-console",
  heroBio: "Bio",
  heroTags: "One,Two",
  stackItems: "TypeScript",
  uptimeStart: "2026-01-01",
  blogTitle: "随笔",
  blogDescription: "随笔列表",
  projectsTitle: "项目",
  projectsDescription: "项目列表",
  aboutTitle: "关于",
  aboutMarkdown: "关于"
};

test("registered console theme satisfies the versioned SDK contract", () => {
  assert.deepEqual(getThemeContractIssues(manjyunConsoleTheme), []);
  assert.equal(manjyunConsoleTheme.apiVersion, "1");
  assert.ok(manjyunConsoleTheme.capabilities.includes("not-found"));
  assert.equal(typeof manjyunConsoleTheme.slots.NotFound, "function");
});

test("paper atlas satisfies the same functional theme contract", () => {
  assert.deepEqual(getThemeContractIssues(paperAtlasTheme), []);
  assert.equal(paperAtlasTheme.apiVersion, manjyunConsoleTheme.apiVersion);
  assert.deepEqual(
    Object.keys(paperAtlasTheme.slots).sort(),
    Object.keys(manjyunConsoleTheme.slots).sort()
  );
  assert.notEqual(paperAtlasTheme.tokens.bg, manjyunConsoleTheme.tokens.bg);
});

test("neon rift satisfies the same functional theme contract", () => {
  assert.deepEqual(getThemeContractIssues(neonRiftTheme), []);
  assert.equal(neonRiftTheme.apiVersion, manjyunConsoleTheme.apiVersion);
  assert.deepEqual(
    Object.keys(neonRiftTheme.slots).sort(),
    Object.keys(manjyunConsoleTheme.slots).sort()
  );
  assert.notEqual(neonRiftTheme.tokens.bg, manjyunConsoleTheme.tokens.bg);
  assert.notEqual(neonRiftTheme.tokens.accent, paperAtlasTheme.tokens.accent);
});

test("theme contract rejects incompatible API and core versions", () => {
  assert.match(
    getThemeContractIssues({
      apiVersion: "2",
      coreCompatibility: { minimum: "2.0.0" }
    }).join("\n"),
    /API 2.*核心版本不低于 2\.0\.0/s
  );
});

test("theme mutation accepts only compiled compatible themes and valid rollback targets", () => {
  const available = ["manjyun-console", "paper-atlas"];
  assert.deepEqual(
    resolveThemeMutation(
      { action: "activate", themeId: "paper-atlas" },
      { activeTheme: "manjyun-console", previousTheme: null },
      available
    ),
    { ok: true, action: "activate", targetTheme: "paper-atlas" }
  );

  const uncompiled = resolveThemeMutation(
    { action: "activate", themeId: "manifest-only" },
    { activeTheme: "manjyun-console", previousTheme: null },
    available
  );
  assert.equal(uncompiled.ok, false);
  assert.equal(uncompiled.ok ? 0 : uncompiled.status, 400);

  assert.deepEqual(
    resolveThemeMutation(
      { action: "rollback" },
      { activeTheme: "paper-atlas", previousTheme: "manjyun-console" },
      available
    ),
    { ok: true, action: "rollback", targetTheme: "manjyun-console" }
  );

  const incompatibleRollback = resolveThemeMutation(
    { action: "rollback" },
    { activeTheme: "paper-atlas", previousTheme: "removed-theme" },
    available
  );
  assert.equal(incompatibleRollback.ok, false);
  assert.equal(incompatibleRollback.ok ? 0 : incompatibleRollback.status, 409);
});

test("presenter owns content URLs, labels, dates, tags and navigation state", () => {
  const entry = presentEntrySummary(post);
  assert.equal(entry.href, "/posts/central-url");
  assert.equal(entry.typeLabel, "随笔");
  assert.equal(entry.published.label, "2026-07-10");
  assert.equal(entry.tags[0]?.href, "/tag/theme-sdk");
  assert.equal("slug" in entry, false);

  const navigation = presentNavigation(navLinks, entry.href);
  assert.equal(navigation.items[0].isCurrent, false);
  assert.equal(navigation.items[1].isCurrent, true);
  assert.equal(navigation.items[2].isCurrent, false);
  assert.equal(navigation.items[2].isExternal, true);
});

test("page presenter leaves the theme title as the only h1", () => {
  const page = presentPage({
    settings,
    navLinks,
    title: "关于",
    href: "/about",
    markdown: "# 关于\n\n# 另一节\n\n正文"
  });
  assert.doesNotMatch(page.content.html, /<h1/);
  assert.match(page.content.html, /<h2[^>]*>另一节<\/h2>/);
});

test("console theme cannot rebuild business URLs from database records", () => {
  const source = readFileSync(
    new URL("../src/themes/manjyun-console/index.tsx", import.meta.url),
    "utf8"
  );
  assert.doesNotMatch(source, /@\/types\/blog/);
  assert.doesNotMatch(source, /contentHref|getContentTypeDefinition/);
  assert.doesNotMatch(source, /["'`]\/(?:posts|projects|tag)\//);
  assert.match(source, /data-theme="manjyun-console"/);
  assert.match(source, /data-site-nav/);
  assert.match(source, /aria-current=\{item\.isCurrent/);
  assert.doesNotMatch(source, /auth-page|auth-card|admin-title|btn-row/);
});

test("neon rift consumes stable view models without rebuilding business URLs", () => {
  const source = readFileSync(
    new URL("../src/themes/neon-rift/index.tsx", import.meta.url),
    "utf8"
  );
  assert.doesNotMatch(source, /@\/types\/blog/);
  assert.doesNotMatch(source, /contentHref|getContentTypeDefinition/);
  assert.doesNotMatch(source, /["'`]\/(?:posts|projects|tag)\//);
  assert.match(source, /data-theme="neon-rift"/);
  assert.match(source, /data-site-nav/);
  assert.match(source, /aria-current=\{item\.isCurrent/);
});
