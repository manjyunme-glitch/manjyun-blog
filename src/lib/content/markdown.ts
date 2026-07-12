import { marked, Renderer } from "marked";
import sanitizeHtml from "sanitize-html";
import { slugify } from "@/lib/content/slug";
import type { RenderedMarkdown } from "@/types/blog";

function escapeAttribute(value: string) {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

function escapeHtml(value: string) {
  return escapeAttribute(value).replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function inferCodeLanguage(language: string, body: string) {
  const explicit = language.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "");
  if (explicit) return explicit;
  const trimmed = body.trim();
  if (
    (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
    (trimmed.startsWith("[") && trimmed.endsWith("]"))
  ) {
    return "json";
  }
  return "";
}

function normalizeCodeBlock(body: string) {
  return body
    .replace(/\r\n?/g, "\n")
    .replace(/^\n/, "")
    .replace(/\n$/, "");
}

function preprocessCards(markdown: string) {
  return markdown
    .replace(
      /\[code(?::([a-z0-9_-]+))?\]([\s\S]*?)\[\/code\]/gi,
      (_match, language = "", body: string) => {
        const code = normalizeCodeBlock(body);
        const normalizedLanguage = inferCodeLanguage(language, code);
        const className = normalizedLanguage ? ` class="language-${normalizedLanguage}"` : "";
        return `<pre class="mj-code-block"><code${className}>${escapeHtml(code)}</code></pre>`;
      }
    )
    .replace(
      /^\[audio:([^\]]+)\]\(([^)\s]+)(?:\s+"([^"]+)")?\)$/gm,
      (_match, title: string, url: string, caption = "") => {
        const safeUrl = escapeAttribute(url);
        const safeTitle = escapeHtml(title.trim());
        const safeCaption = caption
          ? `<figcaption>${escapeHtml(caption.trim())}</figcaption>`
          : "";
        return `<figure class="kg-card mj-audio-card"><div class="mj-audio-meta"><span>audio</span><strong>${safeTitle}</strong></div><audio controls src="${safeUrl}"></audio>${safeCaption}</figure>`;
      }
    )
    .replace(
      /^\[bookmark:([^\]]+)\]\(([^)\s]+)(?:\s+"([^"]+)")?\)$/gm,
      (_match, title: string, url: string, description = "") => {
        const safeUrl = escapeAttribute(url);
        const safeTitle = escapeHtml(title.trim());
        const safeDescription = description
          ? `<p>${escapeHtml(description.trim())}</p>`
          : "";
        return `<a class="kg-card mj-bookmark-card" href="${safeUrl}"><span>bookmark</span><strong>${safeTitle}</strong>${safeDescription}<small>${safeUrl}</small></a>`;
      }
    )
    .replace(
      /^::callout\s+([^\n]+)\n([\s\S]*?)^::$/gm,
      (_match, title: string, body: string) =>
        `<aside class="kg-card mj-callout-card"><strong>${escapeHtml(
          title.trim()
        )}</strong><p>${escapeHtml(body.trim())}</p></aside>`
    );
}

export function renderMarkdown(
  markdown: string,
  options: { demoteH1?: boolean } = {}
): RenderedMarkdown {
  const toc: RenderedMarkdown["toc"] = [];
  const headingIds = new Set<string>();
  const renderer = new Renderer();

  renderer.heading = ({ tokens, depth }) => {
    const text = tokens.map((token) => token.raw).join("");
    const renderedDepth = options.demoteH1 && depth === 1 ? 2 : depth;
    if (renderedDepth === 2 || renderedDepth === 3) {
      const base = slugify(text, "heading");
      let id = base;
      let index = 2;
      while (headingIds.has(id)) {
        id = `${base}-${index}`;
        index += 1;
      }
      headingIds.add(id);
      if (renderedDepth === 2) {
        toc.push({ id, level: renderedDepth, text });
      }
      return `<h${renderedDepth} id="${id}">${marked.parseInline(text)}</h${renderedDepth}>`;
    }
    return `<h${renderedDepth}>${marked.parseInline(text)}</h${renderedDepth}>`;
  };

  renderer.blockquote = ({ tokens }) => {
    const body = tokens.map((token) => token.raw).join("").trim();
    const callout = body.match(/^\[!(NOTE|TIP|WARN|INFO)\]\s*([\s\S]*)/i);
    if (callout) {
      const label = callout[1].toLowerCase();
      const content = marked.parse(callout[2].trim());
      return `<aside class="kg-card mj-callout-card ${label}"><strong>${label}</strong>${content}</aside>`;
    }
    return `<blockquote>${marked.parse(body)}</blockquote>`;
  };

  marked.use({
    gfm: true,
    breaks: false,
    renderer
  });

  const html = marked.parse(preprocessCards(markdown), { async: false }) as string;
  const sanitized = sanitizeHtml(html, {
    allowedTags: sanitizeHtml.defaults.allowedTags.concat([
      "img",
      "figure",
      "figcaption",
      "audio",
      "source",
      "aside",
      "span",
      "small",
      "input"
    ]),
    allowedAttributes: {
      a: ["href", "name", "target", "rel", "class"],
      img: ["src", "alt", "title", "loading", "class"],
      h2: ["id"],
      h3: ["id"],
      code: ["class"],
      pre: ["class"],
      figure: ["class"],
      figcaption: ["class"],
      audio: ["controls", "src"],
      source: ["src", "type"],
      aside: ["class"],
      span: ["class"],
      small: ["class"],
      strong: ["class"],
      p: ["class"],
      input: ["type", "checked", "disabled"]
    },
    allowedSchemes: ["http", "https", "mailto", "tel", "data"],
    transformTags: {
      a: (_tagName, attribs) => {
        const href = attribs.href ?? "";
        const isExternal = /^https?:\/\//.test(href);
        return {
          tagName: "a",
          attribs: {
            ...attribs,
            ...(isExternal
              ? { target: "_blank", rel: "noopener noreferrer" }
              : {})
          }
        };
      }
    }
  });
  const safeHtml = sanitized
    .replace(/<table>/g, '<div class="table-scroll"><table>')
    .replace(/<\/table>/g, "</table></div>");

  const text = markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*]\([^)]*\)/g, " ")
    .replace(/\[[^\]]+]\([^)]*\)/g, " ")
    .replace(/[#>*_`~:-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return { html: safeHtml, text, toc };
}

function normalizeTitleText(value: string) {
  return value
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[*_`~]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase("zh-CN");
}

export function stripDuplicateLeadingTitle(markdown: string, title: string) {
  const leadingH1 = markdown.match(
    /^(\uFEFF?\s{0,3})#\s+(.+?)(?:\s+#+)?\s*(?:\r?\n|$)/
  );
  if (!leadingH1) return markdown;
  if (normalizeTitleText(leadingH1[2]) !== normalizeTitleText(title)) {
    return markdown;
  }
  return markdown.slice(leadingH1[0].length).replace(/^\s*\r?\n/, "");
}

export function renderEntryMarkdown(markdown: string, title: string) {
  return renderMarkdown(stripDuplicateLeadingTitle(markdown, title), {
    demoteH1: true
  });
}
