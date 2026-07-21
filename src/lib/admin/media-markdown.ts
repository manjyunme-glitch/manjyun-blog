type MarkdownMedia = {
  originalName: string;
  mime: string;
  url: string;
};

export function escapeMarkdownLabel(value: string) {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\[/g, "\\[")
    .replace(/\]/g, "\\]")
    .replace(/\r?\n/g, " ");
}

export function escapeCustomCardTitle(value: string) {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\]/g, "\\]")
    .replace(/\r?\n/g, " ");
}

export function mediaToMarkdown(media: MarkdownMedia) {
  if (media.mime.startsWith("image/")) {
    return `![${escapeMarkdownLabel(media.originalName)}](${media.url})`;
  }
  if (media.mime.startsWith("audio/")) {
    return `[audio:${escapeCustomCardTitle(media.originalName)}](${media.url})`;
  }
  return `[${escapeMarkdownLabel(media.originalName)}](${media.url})`;
}

export function appendMarkdownBlock(markdown: string, block: string) {
  const separator =
    markdown.length === 0
      ? ""
      : markdown.endsWith("\n\n")
        ? ""
        : markdown.endsWith("\n")
          ? "\n"
          : "\n\n";
  return `${markdown}${separator}${block}\n`;
}
