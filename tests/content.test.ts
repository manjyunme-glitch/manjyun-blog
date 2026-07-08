import assert from "node:assert/strict";
import test from "node:test";
import { renderMarkdown } from "@/lib/content/markdown";
import { readingTime } from "@/lib/content/reading-time";
import { slugify } from "@/lib/content/slug";
import { auditThemeManifest } from "@/lib/themes/import";
import { getTheme, getThemes } from "@/themes";

test("slugify keeps useful unicode and removes separators", () => {
  assert.equal(slugify("  Docker 部署：端口 4482!  "), "docker-部署-端口-4482");
  assert.equal(slugify("!!!", "post"), "post");
});

test("reading time handles Chinese text", () => {
  assert.equal(readingTime("这是一篇短文。"), "1 min read");
});

test("markdown renderer supports headings and custom cards", () => {
  const rendered = renderMarkdown(`# Title

## Section

[audio:Song](/uploads/song.mp3 "demo")

[bookmark:Site](https://example.com "external")
`);
  assert.equal(rendered.toc[0]?.id, "section");
  assert.match(rendered.html, /mj-audio-card/);
  assert.match(rendered.html, /mj-bookmark-card/);
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

test("theme registry returns the default theme", () => {
  assert.equal(getThemes().length, 1);
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
    tokens: {
      bg: "#050505",
      surface: "#111111",
      text: "#f8f4e8",
      accent: "#f8b64c"
    },
    slots: {
      Home: "DefaultHome",
      Post: "DefaultPost",
      Archive: "DefaultArchive",
      Page: "DefaultPage"
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
  assert.match(incompatible.issues.join("\n"), /slots 必须声明 Post/);
});
