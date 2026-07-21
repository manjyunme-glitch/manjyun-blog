import {
  escapeCustomCardTitle,
  escapeMarkdownLabel
} from "@/lib/admin/media-markdown";
import { normalizeCodeLanguage } from "@/lib/content/code-language";

export type MarkdownCommand =
  | "heading2"
  | "heading3"
  | "bold"
  | "italic"
  | "strikethrough"
  | "inlineCode"
  | "link"
  | "image"
  | "blockquote"
  | "unorderedList"
  | "orderedList"
  | "taskList"
  | "codeBlock"
  | "table"
  | "horizontalRule"
  | "callout"
  | "bookmark"
  | "audio";

export type MarkdownEdit = {
  value: string;
  selectionStart: number;
  selectionEnd: number;
};

type MarkdownCommandOptions = {
  codeLanguage?: string;
};

function clampSelection(value: string, selectionStart: number, selectionEnd: number) {
  const start = Math.max(0, Math.min(value.length, Math.trunc(selectionStart)));
  const end = Math.max(start, Math.min(value.length, Math.trunc(selectionEnd)));
  return { start, end };
}

function replacementEdit(
  value: string,
  start: number,
  end: number,
  replacement: string,
  relativeSelectionStart = replacement.length,
  relativeSelectionEnd = relativeSelectionStart
): MarkdownEdit {
  return {
    value: `${value.slice(0, start)}${replacement}${value.slice(end)}`,
    selectionStart: start + relativeSelectionStart,
    selectionEnd: start + relativeSelectionEnd
  };
}

function wrapSelection(
  value: string,
  start: number,
  end: number,
  opening: string,
  closing: string,
  placeholder: string
) {
  const selected = value.slice(start, end);
  if (
    selected &&
    start >= opening.length &&
    value.slice(start - opening.length, start) === opening &&
    value.slice(end, end + closing.length) === closing
  ) {
    return replacementEdit(
      value,
      start - opening.length,
      end + closing.length,
      selected,
      0,
      selected.length
    );
  }

  if (
    selected.startsWith(opening) &&
    selected.endsWith(closing) &&
    selected.length >= opening.length + closing.length
  ) {
    const inner = selected.slice(opening.length, -closing.length);
    return replacementEdit(value, start, end, inner, 0, inner.length);
  }

  const content = selected || placeholder;
  return replacementEdit(
    value,
    start,
    end,
    `${opening}${content}${closing}`,
    opening.length,
    opening.length + content.length
  );
}

function delimiterRunBefore(
  value: string,
  index: number,
  delimiter: "_" | "*"
) {
  let cursor = index - 1;
  while (cursor >= 0 && value[cursor] === delimiter) cursor -= 1;
  return index - cursor - 1;
}

function delimiterRunAfter(
  value: string,
  index: number,
  delimiter: "_" | "*"
) {
  let cursor = index;
  while (cursor < value.length && value[cursor] === delimiter) cursor += 1;
  return cursor - index;
}

function delimiterRunAtStart(value: string, delimiter: "_" | "*") {
  let cursor = 0;
  while (cursor < value.length && value[cursor] === delimiter) cursor += 1;
  return cursor;
}

function delimiterRunAtEnd(value: string, delimiter: "_" | "*") {
  let cursor = value.length - 1;
  while (cursor >= 0 && value[cursor] === delimiter) cursor -= 1;
  return value.length - cursor - 1;
}

function italicEdit(value: string, start: number, end: number) {
  const selected = value.slice(start, end);
  if (selected) {
    for (const delimiter of ["_", "*"] as const) {
      const openingRun = delimiterRunBefore(value, start, delimiter);
      const closingRun = delimiterRunAfter(value, end, delimiter);
      if (openingRun % 2 === 1 && closingRun % 2 === 1) {
        return replacementEdit(
          value,
          start - 1,
          end + 1,
          selected,
          0,
          selected.length
        );
      }
    }

    for (const delimiter of ["_", "*"] as const) {
      const openingRun = delimiterRunAtStart(selected, delimiter);
      const closingRun = delimiterRunAtEnd(selected, delimiter);
      if (
        openingRun % 2 === 1 &&
        closingRun % 2 === 1 &&
        openingRun + closingRun <= selected.length
      ) {
        const inner = selected.slice(1, -1);
        return replacementEdit(value, start, end, inner, 0, inner.length);
      }
    }
  }

  const content = selected || "斜体文字";
  return replacementEdit(
    value,
    start,
    end,
    `_${content}_`,
    1,
    1 + content.length
  );
}

function lineSelection(value: string, start: number, end: number) {
  const lineStart = value.lastIndexOf("\n", Math.max(0, start - 1)) + 1;
  const effectiveEnd = end > start && value[end - 1] === "\n" ? end - 1 : end;
  const nextNewline = value.indexOf("\n", effectiveEnd);
  const lineEnd = nextNewline === -1 ? value.length : nextNewline;
  return {
    lineStart,
    lineEnd,
    lines: value.slice(lineStart, lineEnd).split("\n")
  };
}

function editLines(
  value: string,
  start: number,
  end: number,
  matchesPrefix: (content: string) => boolean,
  removePrefix: (content: string) => string,
  addPrefix: (content: string, index: number) => string,
  emptyPlaceholder?: string
) {
  const selection = lineSelection(value, start, end);
  if (
    emptyPlaceholder !== undefined &&
    selection.lines.length === 1 &&
    !selection.lines[0].trim()
  ) {
    const indentation = /^(\s*)/.exec(selection.lines[0])?.[1] ?? "";
    const content = addPrefix(emptyPlaceholder, 0);
    const placeholderStart = content.indexOf(emptyPlaceholder);
    const replacement = `${indentation}${content}`;
    return replacementEdit(
      value,
      selection.lineStart,
      selection.lineEnd,
      replacement,
      indentation.length + placeholderStart,
      indentation.length + placeholderStart + emptyPlaceholder.length
    );
  }

  const nonEmpty = selection.lines.filter((line) => line.trim());
  const shouldRemove =
    nonEmpty.length > 0 &&
    nonEmpty.every((line) => {
      const indentation = /^(\s*)/.exec(line)?.[1] ?? "";
      return matchesPrefix(line.slice(indentation.length));
    });
  let itemIndex = 0;
  const replacement = selection.lines
    .map((line) => {
      if (!line.trim()) return line;
      const indentation = /^(\s*)/.exec(line)?.[1] ?? "";
      const content = line.slice(indentation.length);
      if (shouldRemove) return `${indentation}${removePrefix(content)}`;
      const next = addPrefix(removePrefix(content), itemIndex);
      itemIndex += 1;
      return `${indentation}${next}`;
    })
    .join("\n");

  return replacementEdit(
    value,
    selection.lineStart,
    selection.lineEnd,
    replacement,
    0,
    replacement.length
  );
}

function editHeading(
  value: string,
  start: number,
  end: number,
  marker: "## " | "### "
) {
  const exact = new RegExp(`^${marker.trim().replace(/#/g, "\\#")}\\s+`);
  const placeholder = marker === "## " ? "二级标题" : "三级标题";
  return editLines(
    value,
    start,
    end,
    (content) => exact.test(content),
    (content) => content.replace(/^#{1,6}\s+/, ""),
    (content) => `${marker}${content}`,
    placeholder
  );
}

function insertBlock(
  value: string,
  start: number,
  end: number,
  block: string,
  blockSelectionStart = block.length,
  blockSelectionEnd = blockSelectionStart
) {
  const before = value.slice(0, start);
  const after = value.slice(end);
  const prefix =
    before.length === 0 ? "" : before.endsWith("\n\n") ? "" : before.endsWith("\n") ? "\n" : "\n\n";
  const suffix =
    after.length === 0 ? "" : after.startsWith("\n\n") ? "" : after.startsWith("\n") ? "\n" : "\n\n";
  const replacement = `${prefix}${block}${suffix}`;
  return replacementEdit(
    value,
    start,
    end,
    replacement,
    prefix.length + blockSelectionStart,
    prefix.length + blockSelectionEnd
  );
}

function longestBacktickRun(value: string) {
  return Math.max(0, ...Array.from(value.matchAll(/`+/g), (match) => match[0].length));
}

export function normalizeEditorCodeLanguage(language: string) {
  return normalizeCodeLanguage(language);
}

function inlineCodeEdit(value: string, start: number, end: number) {
  const selected = value.slice(start, end) || "inline code";
  const delimiter = "`".repeat(Math.max(1, longestBacktickRun(selected) + 1));
  const needsPadding = selected.startsWith("`") || selected.endsWith("`");
  const content = needsPadding ? ` ${selected} ` : selected;
  return replacementEdit(
    value,
    start,
    end,
    `${delimiter}${content}${delimiter}`,
    delimiter.length + (needsPadding ? 1 : 0),
    delimiter.length + (needsPadding ? 1 : 0) + selected.length
  );
}

function linkEdit(value: string, start: number, end: number, image: boolean) {
  const selected = value.slice(start, end);
  const label = escapeMarkdownLabel(
    selected || (image ? "图片说明" : "链接文字")
  );
  const destination = image ? "/uploads/image.png" : "https://example.com";
  const opening = image ? "![" : "[";
  const replacement = `${opening}${label}](${destination})`;
  const labelStart = opening.length;
  const destinationStart = opening.length + label.length + 2;
  return replacementEdit(
    value,
    start,
    end,
    replacement,
    selected ? destinationStart : labelStart,
    selected ? destinationStart + destination.length : labelStart + label.length
  );
}

export function applyMarkdownCommand(
  value: string,
  selectionStart: number,
  selectionEnd: number,
  command: MarkdownCommand,
  options: MarkdownCommandOptions = {}
): MarkdownEdit {
  const { start, end } = clampSelection(value, selectionStart, selectionEnd);

  switch (command) {
    case "heading2":
      return editHeading(value, start, end, "## ");
    case "heading3":
      return editHeading(value, start, end, "### ");
    case "bold":
      return wrapSelection(value, start, end, "**", "**", "粗体文字");
    case "italic":
      return italicEdit(value, start, end);
    case "strikethrough":
      return wrapSelection(value, start, end, "~~", "~~", "删除文字");
    case "inlineCode":
      return inlineCodeEdit(value, start, end);
    case "link":
      return linkEdit(value, start, end, false);
    case "image":
      return linkEdit(value, start, end, true);
    case "blockquote":
      return editLines(
        value,
        start,
        end,
        (content) => /^>\s?/.test(content),
        (content) => content.replace(/^>\s?/, ""),
        (content) => `> ${content}`,
        "引用内容"
      );
    case "unorderedList":
      return editLines(
        value,
        start,
        end,
        (content) => /^[-+*]\s+/.test(content) && !/^[-+*]\s+\[[ xX]\]\s+/.test(content),
        (content) => content.replace(/^(?:[-+*]\s+(?:\[[ xX]\]\s+)?|\d{1,9}[.)]\s+)/, ""),
        (content) => `- ${content}`,
        "列表项"
      );
    case "orderedList":
      return editLines(
        value,
        start,
        end,
        (content) => /^\d{1,9}[.)]\s+/.test(content),
        (content) => content.replace(/^(?:[-+*]\s+(?:\[[ xX]\]\s+)?|\d{1,9}[.)]\s+)/, ""),
        (content, index) => `${index + 1}. ${content}`,
        "列表项"
      );
    case "taskList":
      return editLines(
        value,
        start,
        end,
        (content) => /^[-+*]\s+\[[ xX]\]\s+/.test(content),
        (content) => content.replace(/^(?:[-+*]\s+(?:\[[ xX]\]\s+)?|\d{1,9}[.)]\s+)/, ""),
        (content) => `- [ ] ${content}`,
        "待办事项"
      );
    case "codeBlock": {
      const selected = value.slice(start, end) || 'const value = "example";';
      const fence = "`".repeat(Math.max(3, longestBacktickRun(selected) + 1));
      const language = normalizeEditorCodeLanguage(options.codeLanguage ?? "text");
      const opening = `${fence}${language}\n`;
      const block = `${opening}${selected}\n${fence}`;
      return insertBlock(
        value,
        start,
        end,
        block,
        opening.length,
        opening.length + selected.length
      );
    }
    case "table": {
      const block = [
        "| 列 1 | 列 2 |",
        "| --- | --- |",
        "| 内容 | 内容 |"
      ].join("\n");
      return insertBlock(value, start, start, block, 2, 5);
    }
    case "horizontalRule":
      return insertBlock(value, start, start, "---");
    case "callout": {
      const selected = value.slice(start, end) || "这里写提示内容。";
      const opening = "::callout 备注\n";
      const block = `${opening}${selected}\n::`;
      return insertBlock(
        value,
        start,
        end,
        block,
        opening.length,
        opening.length + selected.length
      );
    }
    case "bookmark": {
      const title = escapeCustomCardTitle(
        value.slice(start, end) || "书签标题"
      );
      const block = `[bookmark:${title}](https://example.com "可选摘要")`;
      const destinationStart = block.indexOf("https://");
      return insertBlock(
        value,
        start,
        end,
        block,
        destinationStart,
        destinationStart + "https://example.com".length
      );
    }
    case "audio": {
      const title = escapeCustomCardTitle(
        value.slice(start, end) || "音频标题"
      );
      const block = `[audio:${title}](/uploads/audio.mp3 "可选说明")`;
      const destinationStart = block.indexOf("/uploads/");
      return insertBlock(
        value,
        start,
        end,
        block,
        destinationStart,
        destinationStart + "/uploads/audio.mp3".length
      );
    }
  }
}

export function indentMarkdownSelection(
  value: string,
  selectionStart: number,
  selectionEnd: number,
  outdent = false
): MarkdownEdit {
  const { start, end } = clampSelection(value, selectionStart, selectionEnd);

  if (start === end && !outdent) {
    return replacementEdit(value, start, end, "  ");
  }

  const selection = lineSelection(value, start, end);
  const replacement = selection.lines
    .map((line) => {
      if (!outdent) return `  ${line}`;
      if (line.startsWith("\t")) return line.slice(1);
      return line.replace(/^ {1,2}/, "");
    })
    .join("\n");

  if (start === end) {
    const removed =
      selection.lineEnd - selection.lineStart - replacement.length;
    return replacementEdit(
      value,
      selection.lineStart,
      selection.lineEnd,
      replacement,
      Math.max(0, start - selection.lineStart - removed)
    );
  }

  return replacementEdit(
    value,
    selection.lineStart,
    selection.lineEnd,
    replacement,
    0,
    replacement.length
  );
}

export function markdownShortcutCommand(input: {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
}): MarkdownCommand | null {
  if (!(input.ctrlKey || input.metaKey) || input.altKey) return null;
  const key = input.key.toLowerCase();
  if (key === "b" && !input.shiftKey) return "bold";
  if (key === "i" && !input.shiftKey) return "italic";
  if (key === "k" && !input.shiftKey) return "link";
  if (key === "e" && !input.shiftKey) return "inlineCode";
  if (key === "x" && input.shiftKey) return "strikethrough";
  return null;
}
