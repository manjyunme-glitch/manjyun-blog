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

  assert.doesNotMatch(rendered.html, /mj-(?:audio|bookmark|callout)-/);
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
    /<pre class="mj-code-block"><code class="language-typescript">const nested = true;<\/code><\/pre>/
  );
  assert.match(
    rendered.html,
    /<pre class="mj-code-block"><code class="language-bash">npm run check<\/code><\/pre>/
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

  assert.match(rendered.html, /<code class="language-text">::<\/code>/);
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
    (rendered.html.match(/<code class="language-text">::<\/code>/g) ?? [])
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

  assert.match(rendered.html, /<ol start="10">/);
  assert.match(rendered.html, /<code class="language-text">::<\/code>/);
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

test("custom blocks interrupt adjacent paragraphs without requiring blank lines", () => {
  const rendered = renderMarkdown([
    "NAS 上目前跑着的服务：",
    "[code:sh]",
    "docker compose ps",
    "[/code]",
    "音频：",
    '[audio:Signal](/uploads/signal.mp3 "Local")',
    "参考：",
    '[bookmark:Docs](https://example.com "Reference")',
    "注意：",
    "::callout Deploy",
    "Run `npm test` first.",
    "::",
    "完成。"
  ].join("\n"));

  assert.match(rendered.html, /<p>NAS 上目前跑着的服务：<\/p>/);
  assert.match(
    rendered.html,
    /<pre class="mj-code-block"><code class="language-bash">docker compose ps<\/code><\/pre>/
  );
  assert.match(rendered.html, /<p>音频：<\/p>/);
  assert.match(rendered.html, /<figure class="kg-card mj-audio-card">/);
  assert.match(rendered.html, /<p>参考：<\/p>/);
  assert.match(rendered.html, /<a class="kg-card mj-bookmark-card"/);
  assert.match(rendered.html, /<p>注意：<\/p>/);
  assert.match(rendered.html, /<aside class="kg-card mj-callout-card">/);
  assert.match(rendered.html, /<p>完成。<\/p>/);
  assert.doesNotMatch(rendered.html, /\[\/?(?:code|audio|bookmark)/);
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

test("standard fenced code preserves meaningful leading and trailing blank lines", () => {
  const rendered = renderMarkdown([
    "```text",
    "",
    "first",
    "",
    "```"
  ].join("\n"));

  assert.match(
    rendered.html,
    /<pre class="mj-code-block"><code class="language-text">\nfirst\n<\/code><\/pre>/
  );
});

test("GFM formatting survives sanitization with its visible semantics intact", () => {
  const rendered = renderMarkdown([
    "~~retired~~",
    "",
    "3. third",
    "4. fourth",
    "",
    "| Left | Center | Right |",
    "| :--- | :---: | ---: |",
    "| a | b | c |",
    "",
    '[Docs](https://example.com/docs "Reference title")',
    "",
    "- [x] shipped",
    "",
    "<https://example.com/auto>"
  ].join("\n"));

  assert.match(rendered.html, /<del>retired<\/del>/);
  assert.match(rendered.html, /<ol start="3">/);
  assert.match(rendered.html, /<th align="left">Left<\/th>/);
  assert.match(rendered.html, /<th align="center">Center<\/th>/);
  assert.match(rendered.html, /<th align="right">Right<\/th>/);
  assert.match(
    rendered.html,
    /<a href="https:\/\/example\.com\/docs" title="Reference title" target="_blank" rel="noopener noreferrer">/
  );
  assert.match(
    rendered.html,
    /<input(?=[^>]*type="checkbox")(?=[^>]*checked)(?=[^>]*disabled)[^>]*>/
  );
  assert.match(
    rendered.html,
    /<a href="https:\/\/example\.com\/auto" target="_blank" rel="noopener noreferrer">/
  );
});

test("sanitization keeps disabled task checkboxes and removes arbitrary raw inputs", () => {
  const rendered = renderMarkdown([
    "- [x] shipped",
    "",
    '<input type="file">',
    '<input type="text" disabled>',
    '<input type="checkbox">',
    '<input type="checkbox" checked disabled>'
  ].join("\n"));

  assert.equal((rendered.html.match(/<input/g) ?? []).length, 1);
  assert.match(
    rendered.html,
    /<input(?=[^>]*type="checkbox")(?=[^>]*checked)(?=[^>]*disabled)[^>]*>/
  );
  assert.doesNotMatch(rendered.html, /type="(?:file|text)"/);
});

test("raw inputs cannot survive through Markdown heading inline rendering", () => {
  const rendered = renderMarkdown(
    '## Heading <input type="checkbox" checked disabled>'
  );

  assert.match(rendered.html, /<h2 id="heading">Heading <\/h2>/);
  assert.doesNotMatch(rendered.html, /<input/);
});

test("raw inputs cannot survive through callout heading inline rendering", () => {
  const rendered = renderEntryMarkdown([
    "::callout Nested",
    '# Callout heading <input type="checkbox" checked disabled>',
    "::"
  ].join("\n"), "Page title");

  assert.match(rendered.html, /<h2>Callout heading <\/h2>/);
  assert.doesNotMatch(rendered.html, /<input/);
});

test("code blocks normalize common language aliases and always escape code HTML", () => {
  const rendered = renderMarkdown([
    "[code:C++]",
    "#include <script>alert(1)</script>",
    "[/code]",
    "",
    "```C#",
    'Console.WriteLine("<b>safe</b>");',
    "```",
    "",
    "```TypeScript",
    "const ready = true;",
    "```"
  ].join("\n"));

  assert.match(rendered.html, /class="language-cpp"/);
  assert.match(rendered.html, /class="language-csharp"/);
  assert.match(rendered.html, /class="language-typescript"/);
  assert.match(rendered.html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(rendered.html, /&lt;b&gt;safe&lt;\/b&gt;/);
  assert.doesNotMatch(rendered.html, /<script|<b>safe/);
});

test("entry rendering demotes raw and nested h1 headings without polluting the toc", () => {
  const rendered = renderEntryMarkdown([
    '<h1 onclick="alert(1)">Raw heading</h1>',
    "",
    "::callout Nested",
    "# Callout heading",
    "::",
    "",
    "# Public section"
  ].join("\n"), "Page title");

  assert.doesNotMatch(rendered.html, /<h1[ >]/);
  assert.match(rendered.html, /<h2>Raw heading<\/h2>/);
  assert.match(rendered.html, /<h2>Callout heading<\/h2>/);
  assert.match(
    rendered.html,
    /<h2 id="public-section">Public section<\/h2>/
  );
  assert.deepEqual(rendered.toc, [
    { id: "public-section", level: 2, text: "Public section" }
  ]);
  assert.doesNotMatch(rendered.html, /onclick=/);
});

test("blockquote alerts cover the documented variants and harden external links", () => {
  const rendered = renderMarkdown([
    "> [!IMPORTANT]",
    "> Keep this.",
    "",
    "> [!WARNING]",
    "> Check this.",
    "",
    "> [!CAUTION]",
    "> Stop here.",
    "",
    '<a href="//example.com/path">protocol relative</a>',
    "",
    '<a href="HTTPS://example.com/path">uppercase scheme</a>'
  ].join("\n"));

  assert.match(rendered.html, /mj-callout-card important/);
  assert.match(rendered.html, /mj-callout-card warn/);
  assert.match(rendered.html, /mj-callout-card caution/);
  assert.equal(
    (rendered.html.match(/rel="noopener noreferrer"/g) ?? []).length,
    2
  );
});

test("every target blank link is protected even when its href is not classified as external", () => {
  const rendered = renderMarkdown([
    '<a href="/local" target="_blank" rel="opener">local</a>',
    "",
    '<a href="/\\\\evil.example/path" target="_BLANK" rel="opener">normalized external</a>'
  ].join("\n"));

  assert.equal(
    (rendered.html.match(/target="_blank" rel="noopener noreferrer"/g) ?? [])
      .length,
    2
  );
  assert.doesNotMatch(rendered.html, /rel="opener"/);
});

test("unclosed custom blocks remain recoverable text instead of swallowing the document", () => {
  const rendered = renderMarkdown([
    "Before",
    "[code:C++]",
    "int main() {}",
    "",
    "::callout Missing close",
    "After"
  ].join("\n"));

  assert.match(rendered.html, /\[code:C\+\+\]/);
  assert.match(rendered.html, /int main\(\) \{\}/);
  assert.match(rendered.html, /::callout Missing close/);
  assert.match(rendered.html, /After/);
  assert.doesNotMatch(rendered.html, /mj-code-block|mj-callout-card/);
});

test("audio and bookmark cards accept balanced, escaped, and angle-bracket destinations", () => {
  const rendered = renderMarkdown([
    '[bookmark:Reference](https://example.com/wiki/Function_(math) "Balanced")',
    "",
    String.raw`[audio:Episode](/uploads/episode\(1\).mp3 "Escaped")`,
    "",
    '[bookmark:Spaced](<https://example.com/a%20b> "Angle")'
  ].join("\n"));

  assert.match(
    rendered.html,
    /href="https:\/\/example\.com\/wiki\/Function_\(math\)"/
  );
  assert.match(rendered.html, /src="\/uploads\/episode\(1\)\.mp3"/);
  assert.match(rendered.html, /href="https:\/\/example\.com\/a%20b"/);
  assert.equal(
    (rendered.html.match(/mj-bookmark-card/g) ?? []).length,
    2
  );
  assert.equal((rendered.html.match(/mj-audio-card/g) ?? []).length, 1);
});

test("bookmark destination text cannot break out of its small element", () => {
  const rendered = renderMarkdown(
    "[bookmark:Reference](https://example.com/</small><img/src=https://evil.example/pixel>)"
  );

  assert.match(
    rendered.html,
    /<small>https:\/\/example\.com\/&lt;\/small&gt;&lt;img\/src=https:\/\/evil\.example\/pixel&gt;<\/small>/
  );
  assert.doesNotMatch(rendered.html, /<img/);
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
