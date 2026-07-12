import assert from "node:assert/strict";
import test from "node:test";
import { renderEntryMarkdown, renderMarkdown } from "@/lib/content/markdown";
import { readingTime } from "@/lib/content/reading-time";
import { slugify } from "@/lib/content/slug";
import {
  adminContentListHref,
  normalizeAdminContentPage,
  normalizeAdminContentQuery,
  normalizeAdminContentStatus,
  normalizeAdminContentType
} from "@/lib/admin/content-list";
import {
  ADMIN_CONTENT_TYPE_DEFINITIONS,
  CONTENT_TYPE_DEFINITIONS,
  canAdminChangeContentType,
  contentHref,
  isAdminCreatableContentType,
  isAdminContentType,
  isContentType
} from "@/lib/content/content-types";
import { auditThemeManifest } from "@/lib/themes/import";
import { getTheme, getThemes } from "@/themes";

test("slugify keeps useful unicode and removes separators", () => {
  assert.equal(slugify("  Docker 部署：端口 4482!  "), "docker-部署-端口-4482");
  assert.equal(slugify("!!!", "post"), "post");
});

test("reading time handles Chinese text", () => {
  assert.equal(readingTime("这是一篇短文。"), "1 min read");
});

test("content type registry keeps public ids stable and hides legacy pages from admin workflows", () => {
  assert.deepEqual(Object.keys(CONTENT_TYPE_DEFINITIONS).sort(), ["page", "post", "project"]);
  assert.equal(CONTENT_TYPE_DEFINITIONS.post.label, "随笔");
  assert.equal(CONTENT_TYPE_DEFINITIONS.project.label, "项目");
  assert.equal(CONTENT_TYPE_DEFINITIONS.page.adminVisible, false);
  assert.equal(CONTENT_TYPE_DEFINITIONS.page.adminCreatable, false);
  assert.deepEqual(
    ADMIN_CONTENT_TYPE_DEFINITIONS.map((definition) => definition.id),
    ["post", "project"]
  );

  assert.equal(isContentType("page"), true);
  assert.equal(isContentType("__proto__"), false);
  assert.equal(isAdminContentType("page"), false);
  assert.equal(isAdminCreatableContentType("page"), false);
  assert.equal(canAdminChangeContentType("page", "page"), true);
  assert.equal(canAdminChangeContentType("page", "post"), false);
  assert.equal(canAdminChangeContentType("post", "project"), true);
  assert.equal(contentHref("post", "hello"), "/posts/hello");
  assert.equal(contentHref("project", "demo"), "/projects/demo");
  assert.equal(contentHref("page", "about"), "/about");
});

test("admin content list parameters normalize safely and preserve combined filters", () => {
  assert.equal(normalizeAdminContentStatus("trash"), "trashed");
  assert.equal(normalizeAdminContentStatus("unknown"), "all");
  assert.equal(normalizeAdminContentType("project"), "project");
  assert.equal(normalizeAdminContentType("page"), "all");
  assert.equal(normalizeAdminContentQuery("  Docker NAS  "), "Docker NAS");
  assert.equal(normalizeAdminContentPage("3"), 3);
  assert.equal(normalizeAdminContentPage("0"), 1);
  assert.equal(normalizeAdminContentPage("2.5"), 1);
  assert.equal(normalizeAdminContentPage("not-a-page"), 1);

  assert.equal(
    adminContentListHref({
      type: "project",
      status: "draft",
      q: "  Docker NAS  ",
      page: 3
    }),
    "/admin/posts?type=project&status=draft&q=Docker+NAS&page=3"
  );
  assert.equal(
    adminContentListHref({ type: "project", status: "published", q: "Docker NAS" }),
    "/admin/posts?type=project&status=published&q=Docker+NAS"
  );
  assert.equal(adminContentListHref({ page: 1 }), "/admin/posts");
});

test("markdown renderer supports headings and custom cards", () => {
  const rendered = renderMarkdown(`# Title

## Section

### Section

## Section

[audio:Song](/uploads/song.mp3 "demo")

[bookmark:Site](https://example.com "external")
`);
  assert.deepEqual(rendered.toc, [
    { id: "section", level: 2, text: "Section" },
    { id: "section-3", level: 2, text: "Section" }
  ]);
  assert.match(rendered.html, /<h3 id="section-2">Section<\/h3>/);
  assert.match(rendered.html, /mj-audio-card/);
  assert.match(rendered.html, /mj-bookmark-card/);
});

test("entry table of contents includes h2 headings only", () => {
  const rendered = renderEntryMarkdown(`## Overview

### Detail one

### Detail two

## Result`, "Example");

  assert.deepEqual(rendered.toc, [
    { id: "overview", level: 2, text: "Overview" },
    { id: "result", level: 2, text: "Result" }
  ]);
  assert.match(rendered.html, /<h3 id="detail-one">Detail one<\/h3>/);
  assert.match(rendered.html, /<h3 id="detail-two">Detail two<\/h3>/);
});

test("entry markdown leaves the theme title as the only h1", () => {
  const rendered = renderEntryMarkdown(`# Same title

# Another section

Body`, "Same title");

  assert.doesNotMatch(rendered.html, /<h1[ >]/);
  assert.match(rendered.html, /<h2 id="another-section">Another section<\/h2>/);
  assert.deepEqual(rendered.toc[0], {
    id: "another-section",
    level: 2,
    text: "Another section"
  });
});

test("markdown renderer supports compatible code blocks and task lists", () => {
  const rendered = renderMarkdown(`[code] { "blog": "[www.manjyun.top](http://www.manjyun.top/)" } [/code]

- [x] done
`);

  assert.match(rendered.html, /mj-code-block/);
  assert.match(rendered.html, /language-json/);
  assert.match(rendered.html, /www\.manjyun\.top/);
  assert.match(rendered.html, /type="checkbox"/);
});

test("compatible code blocks preserve indentation exactly", () => {
  const rendered = renderMarkdown(`[code]
    {
      "blog": "www.manjyun.top",
      "motto": "能自建的绝不用别人的，能折腾的绝不躺平。"
    }
[/code]`);

  assert.match(
    rendered.html,
    /<code class="language-json">    \{\n      "blog": "www\.manjyun\.top",\n      "motto": "能自建的绝不用别人的，能折腾的绝不躺平。"\n    \}<\/code>/
  );
});

test("theme registry returns the default theme", () => {
  assert.deepEqual(
    getThemes().map((theme) => theme.meta.id),
    ["manjyun-console", "paper-atlas"]
  );
  assert.equal(getTheme("paper-atlas").meta.id, "paper-atlas");
  assert.equal(getTheme("missing").meta.id, "manjyun-console");
});

test("theme manifest audit accepts JSON text and reports incompatibility", () => {
  const compatible = auditThemeManifest(JSON.stringify({
    meta: {
      id: "sample-theme",
      name: "Sample Theme",
      version: "1.0.0",
      description: "A test theme manifest."
    },
    apiVersion: "1",
    coreCompatibility: {
      minimum: "0.1.0",
      maximumExclusive: "1.0.0"
    },
    capabilities: ["home-modules", "not-found"],
    tokens: {
      bg: "#050505",
      surface: "#111111",
      text: "#f8f4e8",
      accent: "#f8b64c"
    },
    slots: {
      Home: "DefaultHome",
      Collection: "DefaultCollection",
      Entry: "DefaultEntry",
      Page: "DefaultPage",
      NotFound: "DefaultNotFound"
    }
  }));

  assert.equal(compatible.compatible, true);
  assert.deepEqual(compatible.issues, []);
  assert.equal(compatible.manifest.id, "sample-theme");

  const incompatible = auditThemeManifest({
    meta: { id: "Broken Theme" },
    tokens: { bg: "#000" },
    slots: { Home: "DefaultHome" }
  });

  assert.equal(incompatible.compatible, false);
  assert.match(incompatible.issues.join("\n"), /meta\.id/);
  assert.match(incompatible.issues.join("\n"), /slots 必须声明 Entry/);
});
