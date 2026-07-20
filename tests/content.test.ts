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
  assert.match(
    rendered.html,
    /<div class="mj-audio-meta"><span>audio<\/span><strong>Song<\/strong><\/div>/
  );
  assert.match(rendered.html, /mj-bookmark-card/);
});

test("markdown custom cards never expand inside fenced or inline code", () => {
  const rendered = renderMarkdown([
    "```md",
    '[audio:Hidden](/uploads/hidden.mp3 "inside fence")',
    '[bookmark:Hidden](https://example.com "inside fence")',
    "::callout Hidden",
    "inside fence",
    "::",
    "[code]const hidden = true;[/code]",
    "```",
    "",
    "Inline `[audio:Inline](/uploads/inline.mp3)` and `[code]inline[/code]`.",
    "",
    "~~~text",
    "[bookmark:Tilde](https://example.com)",
    "~~~",
    "",
    "    [code]indented[/code]",
    "",
    "<pre><code>[code]raw html[/code]</code></pre>",
    "",
    "- nested fence",
    "  ```md",
    "  [code]inside list fence[/code]",
    "  ```"
  ].join("\n"));

  assert.doesNotMatch(rendered.html, /mj-(?:audio|bookmark|callout|code)-/);
  assert.match(
    rendered.html,
    /\[audio:Hidden\]\(\/uploads\/hidden\.mp3 "inside fence"\)/
  );
  assert.match(
    rendered.html,
    /<code>\[audio:Inline\]\(\/uploads\/inline\.mp3\)<\/code>/
  );
  assert.match(
    rendered.html,
    /\[bookmark:Tilde\]\(https:\/\/example\.com\)/
  );
  assert.match(rendered.html, /\[code\]indented\[\/code\]/);
  assert.match(rendered.html, /\[code\]raw html\[\/code\]/);
  assert.match(rendered.html, /\[code\]inside list fence\[\/code\]/);
});

test("heading ids and toc labels come from rendered plain text", () => {
  const rendered = renderMarkdown([
    "## **API** [Guide](/docs) `v2` &amp; <em>stable</em>",
    "",
    "## API Guide v2 &amp; stable"
  ].join("\n"));

  assert.deepEqual(rendered.toc, [
    {
      id: "api-guide-v2-stable",
      level: 2,
      text: "API Guide v2 & stable"
    },
    {
      id: "api-guide-v2-stable-2",
      level: 2,
      text: "API Guide v2 & stable"
    }
  ]);
  assert.match(
    rendered.html,
    /<h2 id="api-guide-v2-stable"><strong>API<\/strong> <a href="\/docs">Guide<\/a> <code>v2<\/code> &amp; <em>stable<\/em><\/h2>/
  );
});

test("sanitization preserves the documented rich-content DOM classes", () => {
  const rendered = renderMarkdown([
    "[code:ts]const value = 1;[/code]",
    "",
    '[audio:Signal](/uploads/signal.mp3 "Recorded locally")',
    "",
    '[bookmark:Docs](https://example.com "Reference")',
    "",
    "::callout Notice",
    "Read this first.",
    "::",
    "",
    "| Name | Value |",
    "| --- | --- |",
    "| status | ready |",
    "",
    '<div class="rift-scanlines">must not inherit a theme utility class</div>',
    '<aside class="rift-scanlines">must not inherit an aside utility class</aside>',
    '<p class="rift-scanlines"><span class="rift-scanlines">plain text</span></p>',
    '<strong class="rift-scanlines">strong text</strong>',
    '<small class="rift-scanlines">small text</small>',
    '<figcaption class="rift-scanlines">caption</figcaption>',
    '<a class="rift-scanlines" href="data:text/html,unsafe">unsafe link</a>',
    '<img class="rift-scanlines" alt="inline image" src="data:image/png;base64,AA">'
  ].join("\n"));

  assert.match(rendered.html, /<pre class="mj-code-block">/);
  assert.match(rendered.html, /<figure class="kg-card mj-audio-card">/);
  assert.match(rendered.html, /<div class="mj-audio-meta">/);
  assert.match(rendered.html, /<a class="kg-card mj-bookmark-card"/);
  assert.match(rendered.html, /<aside class="kg-card mj-callout-card">/);
  assert.match(rendered.html, /<div class="table-scroll"><table>/);
  assert.doesNotMatch(rendered.html, /class="rift-scanlines"/);
  assert.doesNotMatch(rendered.html, /href="data:/);
  assert.match(rendered.html, /src="data:image\/png;base64,AA"/);
});

test("custom callouts render native inline and fenced code without leaking into the toc", () => {
  const rendered = renderMarkdown([
    "::callout Deploy safely",
    "Run `npm test` before deploying.",
    "",
    "[code:ts]const nested = true;[/code]",
    "",
    "```sh",
    "npm run check",
    "```",
    "::"
  ].join("\n"));

  assert.match(
    rendered.html,
    /<aside class="kg-card mj-callout-card"><strong>Deploy safely<\/strong>/
  );
  assert.match(rendered.html, /Run <code>npm test<\/code> before deploying\./);
  assert.match(
    rendered.html,
    /<pre class="mj-code-block"><code class="language-ts">const nested = true;<\/code><\/pre>/
  );
  assert.match(
    rendered.html,
    /<pre><code class="language-sh">npm run check\n<\/code><\/pre>/
  );
  assert.deepEqual(rendered.toc, []);
});

test("callout boundaries ignore closing markers inside fenced code", () => {
  const rendered = renderMarkdown([
    "::callout Colon token",
    "```text",
    "::",
    "```",
    "After fence.",
    "::"
  ].join("\n"));

  assert.match(rendered.html, /<code class="language-text">::\n<\/code>/);
  assert.match(rendered.html, /After fence\./);
  assert.equal(
    (rendered.html.match(/mj-callout-card/g) ?? []).length,
    1
  );
});

test("callout boundaries understand list and blockquote fenced code", () => {
  const rendered = renderMarkdown([
    "::callout Container fences",
    "- ```text",
    "  ::",
    "  ```",
    "> ```text",
    "> ::",
    "> ```",
    "After container fences.",
    "::"
  ].join("\n"));

  assert.equal(
    (rendered.html.match(/<code class="language-text">::\n<\/code>/g) ?? [])
      .length,
    2
  );
  assert.match(rendered.html, /After container fences\./);
  assert.equal(
    (rendered.html.match(/mj-callout-card/g) ?? []).length,
    1
  );
});

test("callout boundaries track ordered-list content indentation", () => {
  const rendered = renderMarkdown([
    "::callout Ordered fence",
    "10. ```text",
    "    ::",
    "    ```",
    "After ordered fence.",
    "::"
  ].join("\n"));

  assert.match(rendered.html, /<ol>/);
  assert.match(rendered.html, /<code class="language-text">::\n<\/code>/);
  assert.match(rendered.html, /After ordered fence\./);
  assert.equal(
    (rendered.html.match(/mj-callout-card/g) ?? []).length,
    1
  );
});

test("callout boundaries ignore closing markers inside compatibility code", () => {
  const rendered = renderMarkdown([
    "::callout Compat code",
    "[code]",
    "::",
    "[/code]",
    "After code.",
    "::"
  ].join("\n"));

  assert.match(
    rendered.html,
    /<pre class="mj-code-block"><code>::<\/code><\/pre>/
  );
  assert.match(rendered.html, /After code\./);
  assert.equal(
    (rendered.html.match(/mj-callout-card/g) ?? []).length,
    1
  );
});

test("ordinary blockquotes preserve document reference links", () => {
  const rendered = renderMarkdown([
    '[docs]: https://example.com/path "Docs"',
    "",
    "> Read [docs] and ![logo][docs]."
  ].join("\n"));

  assert.match(
    rendered.html,
    /<blockquote><p>Read <a href="https:\/\/example\.com\/path"/
  );
  assert.match(
    rendered.html,
    /<img src="https:\/\/example\.com\/path" alt="logo" title="Docs"/
  );
});

test("custom callouts inherit document references without adding headings to the toc", () => {
  const rendered = renderMarkdown([
    '[docs]: https://example.com/docs "Docs"',
    "",
    "::callout Reference",
    "## Internal heading",
    "",
    "See [docs].",
    "::"
  ].join("\n"));

  assert.match(rendered.html, /<h2>Internal heading<\/h2>/);
  assert.match(
    rendered.html,
    /See <a href="https:\/\/example\.com\/docs"[^>]*>docs<\/a>/
  );
  assert.deepEqual(rendered.toc, []);
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

test("encoded leading titles are removed against their plain-text entry title", () => {
  const rendered = renderEntryMarkdown(
    "# Tom &amp; Jerry\n\nBody",
    "Tom & Jerry"
  );

  assert.doesNotMatch(rendered.html, /<h[12][ >]/);
  assert.match(rendered.html, /<p>Body<\/p>/);
  assert.deepEqual(rendered.toc, []);
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
    ["manjyun-console", "paper-atlas", "neon-rift"]
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
