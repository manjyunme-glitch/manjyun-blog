import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { getThemeContractIssues } from "@/lib/themes/contract";
import { resolveThemeMutation } from "@/lib/themes/selection";
import {
  presentCollection,
  presentEntrySummary,
  presentHome,
  presentNavigation,
  presentPage
} from "@/lib/themes/presenter";
import { manjyunConsoleTheme } from "@/themes/manjyun-console";
import { neonRiftTheme } from "@/themes/neon-rift";
import { paperArchiveYear, paperAtlasTheme } from "@/themes/paper-atlas";
import type { HomeModule, NavLink, PostRecord, SiteSettings } from "@/types/blog";

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
  version: 1,
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
      {
        action: "activate",
        themeId: "paper-atlas",
        expectedActiveTheme: "manjyun-console"
      },
      { activeTheme: "manjyun-console", previousTheme: null },
      available
    ),
    {
      ok: true,
      action: "activate",
      targetTheme: "paper-atlas",
      expectedActiveTheme: "manjyun-console"
    }
  );

  const uncompiled = resolveThemeMutation(
    {
      action: "activate",
      themeId: "manifest-only",
      expectedActiveTheme: "manjyun-console"
    },
    { activeTheme: "manjyun-console", previousTheme: null },
    available
  );
  assert.equal(uncompiled.ok, false);
  assert.equal(uncompiled.ok ? 0 : uncompiled.status, 400);

  assert.deepEqual(
    resolveThemeMutation(
      {
        action: "rollback",
        themeId: "manjyun-console",
        expectedActiveTheme: "paper-atlas"
      },
      { activeTheme: "paper-atlas", previousTheme: "manjyun-console" },
      available
    ),
    {
      ok: true,
      action: "rollback",
      targetTheme: "manjyun-console",
      expectedActiveTheme: "paper-atlas"
    }
  );

  const incompatibleRollback = resolveThemeMutation(
    {
      action: "rollback",
      themeId: "removed-theme",
      expectedActiveTheme: "paper-atlas"
    },
    { activeTheme: "paper-atlas", previousTheme: "removed-theme" },
    available
  );
  assert.equal(incompatibleRollback.ok, false);
  assert.equal(incompatibleRollback.ok ? 0 : incompatibleRollback.status, 409);

  const staleRollback = resolveThemeMutation(
    {
      action: "rollback",
      themeId: "manjyun-console",
      expectedActiveTheme: "paper-atlas"
    },
    { activeTheme: "neon-rift", previousTheme: "paper-atlas" },
    [...available, "neon-rift"]
  );
  assert.equal(staleRollback.ok, false);
  assert.equal(staleRollback.ok ? 0 : staleRollback.status, 409);
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

test("collection pagination preserves the theme contract and canonical page links", () => {
  const model = presentCollection({
    settings,
    navLinks,
    title: "随笔",
    description: "分页列表",
    href: "/posts",
    posts: [post],
    pagination: {
      page: 2,
      totalPages: 3,
      total: 25
    }
  });

  assert.equal(model.countLabel, "25 entries");
  assert.deepEqual(model.pagination, {
    label: "第 2 / 3 页",
    currentPage: 2,
    totalPages: 3,
    previous: {
      label: "上一页",
      href: "/posts",
      isExternal: false
    },
    next: {
      label: "下一页",
      href: "/posts?page=3",
      isExternal: false
    }
  });

  for (const theme of [manjyunConsoleTheme, paperAtlasTheme, neonRiftTheme]) {
    const html = renderToStaticMarkup(theme.slots.Collection({ model }));
    assert.match(html, /aria-label="集合分页"/);
    assert.match(html, /href="\/posts"/);
    assert.match(html, /href="\/posts\?page=3"/);
    assert.match(html, /aria-current="page">第 2 \/ 3 页/);
  }
});

test("neon rift serves responsive modern tower assets within a bounded byte budget", () => {
  const source = readFileSync(
    new URL("../src/themes/neon-rift/index.tsx", import.meta.url),
    "utf8"
  );
  assert.match(source, /type="image\/avif"/);
  assert.match(source, /type="image\/webp"/);
  assert.match(source, /signal-tower-432\.avif 432w/);
  assert.match(source, /signal-tower-864\.avif 864w/);
  assert.match(source, /signal-tower-432\.webp 432w/);
  assert.match(source, /signal-tower-864\.webp 864w/);

  const assets = [
    ["signal-tower.png", 450_000],
    ["signal-tower-432.avif", 50_000],
    ["signal-tower-864.avif", 100_000],
    ["signal-tower-432.webp", 75_000],
    ["signal-tower-864.webp", 175_000]
  ] as const;
  for (const [filename, maximumBytes] of assets) {
    const asset = new URL(
      `../public/themes/neon-rift/${filename}`,
      import.meta.url
    );
    assert.ok(
      statSync(asset).size <= maximumBytes,
      `${filename} should stay at or below ${maximumBytes} bytes`
    );
  }
});

test("paper archive groups boundary timestamps in the displayed Shanghai year", () => {
  assert.equal(
    paperArchiveYear("2025-12-31T16:30:00.000Z", "2026-01-01"),
    "2026"
  );
  assert.equal(
    paperArchiveYear("2026-12-31T15:59:59.999Z", "2026-12-31"),
    "2026"
  );
  assert.equal(
    paperArchiveYear("2026-12-31T18:00:00.000Z", "2027-01-01"),
    "2027"
  );
  assert.equal(paperArchiveYear("not-a-date", "legacy-label"), "lega");
});

test("all public themes preserve configured home modules in DOM and mobile reading order", () => {
  const modules: HomeModule[] = [
    { id: "now", enabled: true, sortOrder: 40, config: {} },
    { id: "projects", enabled: true, sortOrder: 50, config: {} },
    { id: "frequentLinks", enabled: true, sortOrder: 10, config: {} },
    { id: "stack", enabled: true, sortOrder: 30, config: {} },
    { id: "recentPosts", enabled: true, sortOrder: 20, config: {} }
  ];
  const model = presentHome({
    settings,
    navLinks,
    frequentLinks: [],
    modules,
    posts: [post],
    projects: []
  });
  const expectedOrder = [
    "frequentLinks",
    "recentPosts",
    "stack",
    "now",
    "projects"
  ];

  for (const theme of [manjyunConsoleTheme, paperAtlasTheme, neonRiftTheme]) {
    const html = renderToStaticMarkup(theme.slots.Home({ model }));
    const renderedOrder = Array.from(
      html.matchAll(/data-home-module="([^"]+)"/g),
      (match) => match[1]
    );
    assert.deepEqual(
      renderedOrder,
      expectedOrder,
      `${theme.meta.id} must render modules in presenter order`
    );
  }
});

test("neon rift keeps its article toc sticky and its telemetry readable", () => {
  const source = readFileSync(
    new URL("../src/themes/neon-rift/theme.css", import.meta.url),
    "utf8"
  );
  assert.match(source, /overflow-x:\s*clip/);
  assert.match(source, /\.rift-status-panel h2\s*\{\s*color:\s*#111114/);
  assert.match(source, /\.rift-status-panel dd\s*\{\s*color:\s*#111114/);
  assert.match(source, /@keyframes rift-title-flicker/);
  assert.match(source, /@keyframes rift-title-signal/);
  assert.match(source, /\.rift-nav a\[aria-current="page"\]\s*\{[\s\S]*?color:\s*#050506/);
  assert.match(source, /\.rift-article-head h1\s*\{[^}]*font-size:\s*clamp\(2\.6rem,\s*5vw,\s*4\.75rem\)/);
  assert.match(source, /\.toc-links\s*\{[^}]*max-height:\s*calc\(66\.667vh - 126\.667px\)[^}]*scrollbar-width:\s*none/);
  assert.match(source, /\.toc-links::-webkit-scrollbar\s*\{\s*width:\s*0;\s*height:\s*0/);
  assert.doesNotMatch(source, /background-size:\s*auto,\s*56px 56px,\s*56px 56px/);
  assert.doesNotMatch(source, /background-size:\s*auto,\s*32px 32px,\s*32px 32px/);
});

test("public themes style viewport and nested scrollbars with their own palette", () => {
  const themes = [
    ["manjyun-console", "#9d7542 #101010"],
    ["neon-rift", "#fcee0a #101013"],
    ["paper-atlas", "#aa3527 #e8e1d2"]
  ] as const;

  for (const [themeId, standardColors] of themes) {
    const source = readFileSync(
      new URL(`../src/themes/${themeId}/theme.css`, import.meta.url),
      "utf8"
    );
    assert.ok(
      source.includes(`html:has([data-theme="${themeId}"])::-webkit-scrollbar`),
      `${themeId} should style the viewport scrollbar`
    );
    assert.ok(
      source.includes(`[data-theme="${themeId}"] *::-webkit-scrollbar-thumb`),
      `${themeId} should style nested scrollbar thumbs`
    );
    assert.ok(
      source.includes(`scrollbar-color: ${standardColors}`),
      `${themeId} should include a standards-based scrollbar fallback`
    );
  }
});

test("all public themes style the sanitized rich-content DOM contract", () => {
  const themes = ["manjyun-console", "paper-atlas", "neon-rift"] as const;
  const requiredClasses = [
    "mj-code-block",
    "mj-audio-card",
    "mj-audio-meta",
    "mj-bookmark-card",
    "mj-callout-card",
    "table-scroll"
  ];

  for (const themeId of themes) {
    const source = readFileSync(
      new URL(`../src/themes/${themeId}/theme.css`, import.meta.url),
      "utf8"
    );
    for (const className of requiredClasses) {
      assert.ok(
        source.includes(`.${className}`),
        `${themeId} must style .${className}`
      );
    }
    assert.match(
      source,
      /\.table-scroll\s*\{[^}]*overflow-x:\s*auto/,
      `${themeId} must contain wide tables instead of widening the viewport`
    );
    assert.match(
      source,
      /\.table-scroll table\s*\{[^}]*width:\s*max-content[^}]*min-width:\s*100%/,
      `${themeId} must let wide tables create an inner horizontal scroller`
    );
  }
});

test("theme manager uses purpose-built thumbnails instead of scrollable iframes", () => {
  const source = readFileSync(
    new URL("../src/components/admin/ThemeManager.tsx", import.meta.url),
    "utf8"
  );
  assert.doesNotMatch(source, /<iframe/);
  assert.match(source, /theme-preview-console/);
  assert.match(source, /theme-preview-paper/);
  assert.match(source, /theme-preview-neon/);
});
