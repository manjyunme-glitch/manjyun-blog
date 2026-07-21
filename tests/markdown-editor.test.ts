import assert from "node:assert/strict";
import test from "node:test";
import {
  applyMarkdownCommand,
  indentMarkdownSelection,
  markdownShortcutCommand,
  normalizeEditorCodeLanguage
} from "@/lib/admin/markdown-editor";
import { renderMarkdown } from "@/lib/content/markdown";

test("inline editor commands wrap, select, and toggle existing markup", () => {
  const bold = applyMarkdownCommand("alpha beta", 6, 10, "bold");
  assert.equal(bold.value, "alpha **beta**");
  assert.deepEqual(
    [bold.selectionStart, bold.selectionEnd],
    [8, 12]
  );

  const unwrapped = applyMarkdownCommand(
    bold.value,
    bold.selectionStart,
    bold.selectionEnd,
    "bold"
  );
  assert.equal(unwrapped.value, "alpha beta");
  assert.deepEqual(
    [unwrapped.selectionStart, unwrapped.selectionEnd],
    [6, 10]
  );

  const link = applyMarkdownCommand("Docs", 0, 4, "link");
  assert.equal(link.value, "[Docs](https://example.com)");
  assert.equal(
    link.value.slice(link.selectionStart, link.selectionEnd),
    "https://example.com"
  );

  const inlineCode = applyMarkdownCommand("`quoted`", 0, 8, "inlineCode");
  assert.equal(inlineCode.value, "`` `quoted` ``");
  assert.equal(
    inlineCode.value.slice(inlineCode.selectionStart, inlineCode.selectionEnd),
    "`quoted`"
  );

  const italicInsideBold = applyMarkdownCommand("**bold**", 2, 6, "italic");
  assert.equal(italicInsideBold.value, "**_bold_**");
  assert.match(
    renderMarkdown(italicInsideBold.value).html,
    /<strong><em>bold<\/em><\/strong>/
  );
  assert.equal(
    italicInsideBold.value.slice(
      italicInsideBold.selectionStart,
      italicInsideBold.selectionEnd
    ),
    "bold"
  );
  const boldRestored = applyMarkdownCommand(
    italicInsideBold.value,
    italicInsideBold.selectionStart,
    italicInsideBold.selectionEnd,
    "italic"
  );
  assert.equal(boldRestored.value, "**bold**");

  const legacyItalic = applyMarkdownCommand("*old*", 1, 4, "italic");
  assert.equal(legacyItalic.value, "old");
  assert.doesNotMatch(renderMarkdown(legacyItalic.value).html, /<em>/);

  const currentItalic = applyMarkdownCommand("_current_", 1, 8, "italic");
  assert.equal(currentItalic.value, "current");
  assert.doesNotMatch(renderMarkdown(currentItalic.value).html, /<em>/);

  const underscoreStrong = applyMarkdownCommand("__bold__", 2, 6, "italic");
  assert.equal(underscoreStrong.value, "___bold___");
  assert.match(
    renderMarkdown(underscoreStrong.value).html,
    /<em><strong>bold<\/strong><\/em>/
  );
  const underscoreStrongRestored = applyMarkdownCommand(
    underscoreStrong.value,
    underscoreStrong.selectionStart,
    underscoreStrong.selectionEnd,
    "italic"
  );
  assert.equal(underscoreStrongRestored.value, "__bold__");
  assert.match(
    renderMarkdown(underscoreStrongRestored.value).html,
    /<strong>bold<\/strong>/
  );
  assert.doesNotMatch(
    renderMarkdown(underscoreStrongRestored.value).html,
    /<em>/
  );

  const legacyBoldItalic = applyMarkdownCommand(
    "***legacy***",
    3,
    9,
    "italic"
  );
  assert.equal(legacyBoldItalic.value, "**legacy**");
  assert.match(
    renderMarkdown(legacyBoldItalic.value).html,
    /<strong>legacy<\/strong>/
  );
  assert.doesNotMatch(renderMarkdown(legacyBoldItalic.value).html, /<em>/);
});

test("line commands insert selected placeholders on an empty document or line", () => {
  const cases = [
    ["heading2", "## 二级标题", "二级标题"],
    ["heading3", "### 三级标题", "三级标题"],
    ["blockquote", "> 引用内容", "引用内容"],
    ["unorderedList", "- 列表项", "列表项"],
    ["orderedList", "1. 列表项", "列表项"],
    ["taskList", "- [ ] 待办事项", "待办事项"]
  ] as const;

  for (const [command, expectedValue, expectedSelection] of cases) {
    const edit = applyMarkdownCommand("", 0, 0, command);
    assert.equal(edit.value, expectedValue, command);
    assert.equal(
      edit.value.slice(edit.selectionStart, edit.selectionEnd),
      expectedSelection,
      command
    );
  }

  const source = "before\n\n  after";
  const emptyLineStart = "before\n".length;
  const nested = applyMarkdownCommand(
    source,
    emptyLineStart,
    emptyLineStart,
    "blockquote"
  );
  assert.equal(nested.value, "before\n> 引用内容\n  after");
  assert.equal(
    nested.value.slice(nested.selectionStart, nested.selectionEnd),
    "引用内容"
  );
});

test("line editor commands transform complete selections without losing indentation", () => {
  const source = "intro\n  first\n  second\noutro";
  const list = applyMarkdownCommand(source, 8, 22, "taskList");
  assert.equal(
    list.value,
    "intro\n  - [ ] first\n  - [ ] second\noutro"
  );

  const restored = applyMarkdownCommand(
    list.value,
    list.selectionStart,
    list.selectionEnd,
    "taskList"
  );
  assert.equal(restored.value, source);

  const heading = applyMarkdownCommand("Title", 0, 0, "heading2");
  assert.equal(heading.value, "## Title");
});

test("block commands preserve selected content and choose safe code fences", () => {
  const code = applyMarkdownCommand(
    "before\nconst marker = ```;\nafter",
    7,
    26,
    "codeBlock",
    { codeLanguage: "C++" }
  );
  assert.match(code.value, /````cpp\nconst marker = ```;\n````/);
  assert.equal(
    code.value.slice(code.selectionStart, code.selectionEnd),
    "const marker = ```;"
  );
  assert.match(renderMarkdown(code.value).html, /language-cpp/);

  const table = applyMarkdownCommand("keep this", 0, 4, "table");
  assert.match(table.value, /keep this/);
  assert.match(table.value, /\| 列 1 \| 列 2 \|/);

  const callout = applyMarkdownCommand("Important", 0, 9, "callout");
  assert.equal(
    callout.value,
    "::callout 备注\nImportant\n::"
  );
  assert.match(renderMarkdown(callout.value).html, /mj-callout-card/);

  const bookmark = applyMarkdownCommand("Docs", 0, 4, "bookmark");
  assert.equal(
    bookmark.value,
    '[bookmark:Docs](https://example.com "可选摘要")'
  );
  assert.match(renderMarkdown(bookmark.value).html, /mj-bookmark-card/);

  const hostileLink = applyMarkdownCommand("x] [y", 0, 6, "link");
  const hostileRendered = renderMarkdown(hostileLink.value);
  assert.match(hostileRendered.html, />x\] \[y<\/a>/);
  assert.equal((hostileRendered.html.match(/<a /g) ?? []).length, 1);
});

test("tab indentation works at a caret and across complete selected lines", () => {
  const caret = indentMarkdownSelection("alpha", 2, 2);
  assert.equal(caret.value, "al  pha");
  assert.deepEqual([caret.selectionStart, caret.selectionEnd], [4, 4]);

  const indented = indentMarkdownSelection("one\ntwo\nthree", 0, 7);
  assert.equal(indented.value, "  one\n  two\nthree");
  const restored = indentMarkdownSelection(
    indented.value,
    indented.selectionStart,
    indented.selectionEnd,
    true
  );
  assert.equal(restored.value, "one\ntwo\nthree");

  const outdentedCaret = indentMarkdownSelection("  item", 4, 4, true);
  assert.equal(outdentedCaret.value, "item");
  assert.deepEqual(
    [outdentedCaret.selectionStart, outdentedCaret.selectionEnd],
    [2, 2]
  );
});

test("editor language aliases and keyboard shortcuts are deterministic", () => {
  assert.equal(normalizeEditorCodeLanguage(" C++ "), "cpp");
  assert.equal(normalizeEditorCodeLanguage("C#"), "csharp");
  assert.equal(normalizeEditorCodeLanguage("TypeScript title=demo"), "typescript");
  assert.equal(normalizeEditorCodeLanguage("bad\"><script"), "bad-script");

  assert.equal(markdownShortcutCommand({ key: "b", ctrlKey: true }), "bold");
  assert.equal(markdownShortcutCommand({ key: "I", metaKey: true }), "italic");
  assert.equal(markdownShortcutCommand({ key: "k", ctrlKey: true }), "link");
  assert.equal(markdownShortcutCommand({ key: "e", ctrlKey: true }), "inlineCode");
  assert.equal(
    markdownShortcutCommand({ key: "x", ctrlKey: true, shiftKey: true }),
    "strikethrough"
  );
  assert.equal(markdownShortcutCommand({ key: "s", ctrlKey: true }), null);
  assert.equal(
    markdownShortcutCommand({ key: "b", ctrlKey: true, altKey: true }),
    null
  );
});
