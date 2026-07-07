import { marked, Renderer } from "marked";
import sanitizeHtml from "sanitize-html";
import { slugify } from "@/lib/content/slug";
import type { RenderedMarkdown } from "@/types/blog";

function escapeAttribute(value: string) {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

function preprocessCards(markdown: string) {
  return markdown
    .replace(
      /^\[audio:([^\]]+)\]\(([^)\s]+)(?:\s+"([^"]+)")?\)$/gm,
      (_match, title: string, url: string, caption = "") => {
        const safeUrl = escapeAttribute(url);
        const safeTitle = escapeAttribute(title.trim());
        const safeCaption = caption
          ? `<figcaption>${escapeAttribute(caption.trim())}</figcaption>`
          : "";
        return `<figure class="kg-card mj-audio-card"><div class="mj-audio-meta"><span>audio</span><strong>${safeTitle}</strong></div><audio controls src="${safeUrl}"></audio>${safeCaption}</figure>`;
      }
    )
    .replace(
      /^\[bookmark:([^\]]+)\]\(([^)\s]+)(?:\s+"([^"]+)")?\)$/gm,
      (_match, title: string, url: string, description = "") => {
        const safeUrl = escapeAttribute(url);
        const safeTitle = escapeAttribute(title.trim());
        const safeDescription = description
          ? `<p>${escapeAttribute(description.trim())}</p>`
          : "";
        return `<a class="kg-card mj-bookmark-card" href="${safeUrl}"><span>bookmark</span><strong>${safeTitle}</strong>${safeDescription}<small>${safeUrl}</small></a>`;
      }
    )
    .replace(
      /^::callout\s+([^\n]+)\n([\s\S]*?)^::$/gm,
      (_match, title: string, body: string) =>
        `<aside class="kg-card mj-callout-card"><strong>${escapeAttribute(
          title.trim()
        )}</strong><p>${escapeAttribute(body.trim())}</p></aside>`
    );
}

export function renderMarkdown(markdown: string): RenderedMarkdown {
  const toc: RenderedMarkdown["toc"] = [];
  const renderer = new Renderer();

  renderer.heading = ({ tokens, depth }) => {
    const text = tokens.map((token) => token.raw).join("");
    if (depth === 2 || depth === 3) {
      const base = slugify(text, "heading");
      let id = base;
      let index = 2;
      while (toc.some((item) => item.id === id)) {
        id = `${base}-${index}`;
        index += 1;
      }
      toc.push({ id, level: depth, text });
      return `<h${depth} id="${id}">${marked.parseInline(text)}</h${depth}>`;
    }
    return `<h${depth}>${marked.parseInline(text)}</h${depth}>`;
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
      "small"
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
      p: ["class"]
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
