import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(path: string) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

test("confirmation dialog exposes modal semantics and owns its focus lifecycle", () => {
  const feedback = source("../src/components/admin/AdminFeedback.tsx");
  assert.match(feedback, /role="alertdialog"/);
  assert.match(feedback, /aria-modal="true"/);
  assert.match(feedback, /event\.key === "Escape"/);
  assert.match(feedback, /event\.key !== "Tab"/);
  assert.match(feedback, /previousFocusRef/);
  assert.match(feedback, /cancelRef\.current\?\.focus\(\)/);
  assert.doesNotMatch(feedback, /autoFocus/);
});

test("closed mobile navigation is hidden and inert while open navigation traps focus", () => {
  const shell = source("../src/components/admin/AdminShell.tsx");
  assert.match(shell, /aria-hidden=\{closedMobileNavigation \|\| undefined\}/);
  assert.match(shell, /inert=\{closedMobileNavigation \|\| undefined\}/);
  assert.match(shell, /firstLinkRef\.current\?\.focus\(\)/);
  assert.match(shell, /event\.key === "Escape"/);
  assert.match(shell, /event\.key !== "Tab"/);
});

test("primary editor and settings controls have programmatic accessible names", () => {
  const editor = source("../src/components/admin/AdminEditor.tsx");
  for (const id of [
    "editor-title",
    "editor-markdown",
    "editor-code-language",
    "editor-slug",
    "editor-type",
    "post-tags",
    "editor-excerpt",
    "editor-cover",
    "editor-media-upload",
    "editor-seo-title",
    "editor-seo-description"
  ]) {
    assert.ok(
      editor.includes(`htmlFor="${id}"`),
      `editor label must target #${id}`
    );
    assert.ok(editor.includes(`id="${id}"`), `editor must render #${id}`);
  }
  assert.match(editor, /role="toolbar"/);
  assert.match(editor, /aria-label="Markdown 格式工具栏"/);
  assert.match(editor, /role="group"/);
  assert.match(editor, /aria-describedby="editor-markdown-keyboard-help"/);
  assert.match(editor, /event\.key === "Escape"/);
  assert.match(editor, /tabExitArmedRef/);

  const settings = source("../src/components/admin/SettingsForm.tsx");
  for (const id of [
    "settings-site-title",
    "settings-base-url",
    "settings-site-description",
    "settings-uptime-start",
    "settings-blog-title",
    "settings-projects-title",
    "settings-blog-description",
    "settings-projects-description",
    "settings-hero-bio",
    "settings-hero-tags"
  ]) {
    assert.ok(
      settings.includes(`htmlFor="${id}"`),
      `settings label must target #${id}`
    );
    assert.ok(settings.includes(`id="${id}"`), `settings must render #${id}`);
  }
  assert.match(settings, /aria-label=\{`\$\{title\}第 \$\{index \+ 1\} 项名称`\}/);
  assert.match(settings, /aria-label=\{`\$\{title\}第 \$\{index \+ 1\} 项 URL`\}/);
});
