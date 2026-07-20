import { Marked, Parser, Renderer } from "marked";
import type { Token, TokenizerAndRendererExtension, Tokens } from "marked";
import sanitizeHtml from "sanitize-html";
import { slugify } from "@/lib/content/slug";
import type { RenderedMarkdown } from "@/types/blog";

type InlineMarkdownToken = {
  type: string;
  text?: string;
  tokens?: InlineMarkdownToken[];
};

let calloutBodyMarkdown: Marked;

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

function decodeHeadingEntities(value: string) {
  return sanitizeHtml(value, {
    allowedTags: [],
    allowedAttributes: {}
  })
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function inlineTokensToEncodedText(tokens: InlineMarkdownToken[]): string {
  return tokens
    .map((token) => {
      if (token.type === "html") return "";
      if (token.type === "br") return " ";
      if (token.tokens?.length) return inlineTokensToEncodedText(token.tokens);
      return token.text ?? "";
    })
    .join("");
}

function inlineTokensToPlainText(tokens: InlineMarkdownToken[]): string {
  return decodeHeadingEntities(inlineTokensToEncodedText(tokens))
    .replace(/\s+/g, " ")
    .trim();
}

type CustomCardToken = Tokens.Generic & {
  title?: string;
  url?: string;
  description?: string;
  language?: string;
  body?: string;
  tokens?: Token[];
};

function whitespaceColumns(value: string) {
  let columns = 0;
  for (const character of value) {
    columns += character === "\t" ? 4 - (columns % 4) : 1;
  }
  return columns;
}

function stripBlockquotePrefixes(line: string) {
  let rest = line;
  while (true) {
    const blockquote = /^ {0,3}>[\t ]?/.exec(rest);
    if (blockquote) {
      rest = rest.slice(blockquote[0].length);
      continue;
    }
    return rest;
  }
}

function inspectFenceOpeningLine(line: string) {
  let rest = line;
  let listIndent = 0;
  while (true) {
    const blockquote = /^ {0,3}>[\t ]?/.exec(rest);
    if (blockquote) {
      rest = rest.slice(blockquote[0].length);
      continue;
    }
    const list =
      /^( {0,3})(?:[-+*]|\d{1,9}[.)])([\t ]+)/.exec(rest);
    if (list) {
      listIndent += whitespaceColumns(list[0]);
      rest = rest.slice(list[0].length);
      continue;
    }
    return { line: rest, listIndent };
  }
}

function tokenizeCalloutBlock(src: string) {
  const header =
    /^ {0,3}::callout[\t ]+([^\r\n]+)(?:\r?\n|$)/.exec(src);
  if (!header) return null;

  let cursor = header[0].length;
  let fence: {
    marker: "`" | "~";
    length: number;
    listIndent: number;
  } | null = null;
  let htmlCodeContainer: "pre" | "code" | null = null;
  let compatibilityCode = false;

  while (cursor < src.length) {
    const newline = src.indexOf("\n", cursor);
    const lineEnd = newline === -1 ? src.length : newline + 1;
    const line = src.slice(cursor, newline === -1 ? src.length : newline)
      .replace(/\r$/, "");
    const openingLine = inspectFenceOpeningLine(line);

    if (htmlCodeContainer) {
      if (new RegExp(`</${htmlCodeContainer}[\\t >]`, "i").test(`${line} `)) {
        htmlCodeContainer = null;
      }
      cursor = lineEnd;
      continue;
    }

    if (compatibilityCode) {
      if (/\[\/code\]/i.test(openingLine.line)) {
        compatibilityCode = false;
      }
      cursor = lineEnd;
      continue;
    }

    if (fence) {
      const closingLine = stripBlockquotePrefixes(line);
      const closing =
        /^([\t ]*)(`+|~+)[\t ]*$/.exec(closingLine);
      if (
        closing &&
        closing[2][0] === fence.marker &&
        closing[2].length >= fence.length
      ) {
        const indent = whitespaceColumns(closing[1]);
        if (
          indent >= fence.listIndent &&
          indent <= fence.listIndent + 3
        ) {
          fence = null;
        }
      }
      cursor = lineEnd;
      continue;
    }

    const openingFence = /^ {0,3}(`{3,}|~{3,})/.exec(openingLine.line);
    if (openingFence) {
      fence = {
        marker: openingFence[1][0] as "`" | "~",
        length: openingFence[1].length,
        listIndent: openingLine.listIndent
      };
      cursor = lineEnd;
      continue;
    }

    const htmlCodeOpening = /<(pre|code)(?:[\t >])/i.exec(`${line} `);
    if (
      htmlCodeOpening &&
      !new RegExp(`</${htmlCodeOpening[1]}>`, "i").test(line)
    ) {
      htmlCodeContainer = htmlCodeOpening[1].toLowerCase() as "pre" | "code";
      cursor = lineEnd;
      continue;
    }

    const compatibilityCodeOpening =
      /^ {0,3}\[code(?::[a-z0-9_-]+)?\]/i.exec(openingLine.line);
    if (
      compatibilityCodeOpening &&
      !/\[\/code\]/i.test(
        openingLine.line.slice(compatibilityCodeOpening[0].length)
      ) &&
      /\[\/code\]/i.test(src.slice(lineEnd))
    ) {
      compatibilityCode = true;
      cursor = lineEnd;
      continue;
    }

    if (/^ {0,3}::[\t ]*$/.test(line)) {
      return {
        raw: src.slice(0, lineEnd),
        title: header[1],
        body: src.slice(header[0].length, cursor)
      };
    }
    cursor = lineEnd;
  }

  return null;
}

/*
 * Marked invokes block extensions only where Markdown block syntax is active.
 * That keeps these compatibility cards out of inline/fenced/indented code and
 * raw HTML code containers without maintaining a second Markdown lexer.
 */
const customCardExtensions: TokenizerAndRendererExtension[] = [
  {
    name: "mjCodeBlock",
    level: "block",
    tokenizer(src) {
      const match =
        /^ {0,3}\[code(?::([a-z0-9_-]+))?\]([\s\S]*?)\[\/code\][\t ]*(?:\r?\n|$)/i.exec(
          src
        );
      if (!match) return;
      return {
        type: "mjCodeBlock",
        raw: match[0],
        language: match[1] ?? "",
        body: match[2]
      };
    },
    renderer(token) {
      const { language = "", body = "" } = token as CustomCardToken;
      const code = normalizeCodeBlock(body);
      const normalizedLanguage = inferCodeLanguage(language, code);
      const className = normalizedLanguage
        ? ` class="language-${normalizedLanguage}"`
        : "";
      return `<pre class="mj-code-block"><code${className}>${escapeHtml(code)}</code></pre>`;
    }
  },
  {
    name: "mjAudioCard",
    level: "block",
    tokenizer(src) {
      const match =
        /^ {0,3}\[audio:([^\]\r\n]+)\]\(([^)\s]+)(?:[\t ]+"([^"\r\n]+)")?\)[\t ]*(?:\r?\n|$)/.exec(
          src
        );
      if (!match) return;
      return {
        type: "mjAudioCard",
        raw: match[0],
        title: match[1],
        url: match[2],
        description: match[3] ?? ""
      };
    },
    renderer(token) {
      const {
        title = "",
        url = "",
        description = ""
      } = token as CustomCardToken;
      const safeCaption = description
        ? `<figcaption>${escapeHtml(description.trim())}</figcaption>`
        : "";
      return `<figure class="kg-card mj-audio-card"><div class="mj-audio-meta"><span>audio</span><strong>${escapeHtml(
        title.trim()
      )}</strong></div><audio controls src="${escapeAttribute(
        url
      )}"></audio>${safeCaption}</figure>`;
    }
  },
  {
    name: "mjBookmarkCard",
    level: "block",
    tokenizer(src) {
      const match =
        /^ {0,3}\[bookmark:([^\]\r\n]+)\]\(([^)\s]+)(?:[\t ]+"([^"\r\n]+)")?\)[\t ]*(?:\r?\n|$)/.exec(
          src
        );
      if (!match) return;
      return {
        type: "mjBookmarkCard",
        raw: match[0],
        title: match[1],
        url: match[2],
        description: match[3] ?? ""
      };
    },
    renderer(token) {
      const {
        title = "",
        url = "",
        description = ""
      } = token as CustomCardToken;
      const safeUrl = escapeAttribute(url);
      const safeDescription = description
        ? `<p>${escapeHtml(description.trim())}</p>`
        : "";
      return `<a class="kg-card mj-bookmark-card" href="${safeUrl}"><span>bookmark</span><strong>${escapeHtml(
        title.trim()
      )}</strong>${safeDescription}<small>${safeUrl}</small></a>`;
    }
  },
  {
    name: "mjCalloutCard",
    level: "block",
    childTokens: ["tokens"],
    tokenizer(src) {
      const match = tokenizeCalloutBlock(src);
      if (!match) return;
      return {
        type: "mjCalloutCard",
        raw: match.raw,
        title: match.title,
        body: match.body,
        tokens: this.lexer.blockTokens(match.body)
      };
    },
    renderer(token) {
      const { title = "", tokens = [] } = token as CustomCardToken;
      const renderedBody = calloutBodyMarkdown.parser(tokens);
      return `<aside class="kg-card mj-callout-card"><strong>${escapeHtml(
        title.trim()
      )}</strong>${renderedBody}</aside>`;
    }
  }
];

calloutBodyMarkdown = new Marked(
  { extensions: customCardExtensions },
  { gfm: true, breaks: false }
);

export function renderMarkdown(
  markdown: string,
  options: { demoteH1?: boolean } = {}
): RenderedMarkdown {
  const toc: RenderedMarkdown["toc"] = [];
  const headingIds = new Set<string>();
  const renderer = new Renderer();
  const inlineParser = new Parser();

  renderer.heading = ({ tokens, depth }) => {
    const renderedText = inlineParser.parseInline(tokens);
    const text =
      inlineTokensToPlainText(tokens as InlineMarkdownToken[]) || "章节";
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
      return `<h${renderedDepth} id="${id}">${renderedText}</h${renderedDepth}>`;
    }
    return `<h${renderedDepth}>${renderedText}</h${renderedDepth}>`;
  };

  renderer.blockquote = function ({ tokens }) {
    const body = this.parser.parse(tokens);
    const callout = body.match(
      /^<p>\[!(NOTE|TIP|WARN|INFO)\](?:[\t ]+|\r?\n)?/i
    );
    if (callout) {
      const label = callout[1].toLowerCase();
      const content = body
        .replace(callout[0], "<p>")
        .replace(/^<p><\/p>\s*/, "");
      return `<aside class="kg-card mj-callout-card ${label}"><strong>${label}</strong>${content}</aside>`;
    }
    return `<blockquote>${body}</blockquote>`;
  };

  const markdownParser = new Marked(
    {
      extensions: customCardExtensions
    },
    {
      gfm: true,
      breaks: false,
      renderer
    }
  );

  const html = markdownParser.parse(markdown, {
    async: false
  }) as string;
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
      img: ["src", "alt", "title", "loading"],
      h2: ["id"],
      h3: ["id"],
      code: ["class"],
      pre: ["class"],
      div: ["class"],
      figure: ["class"],
      figcaption: [],
      audio: ["controls", "src"],
      source: ["src", "type"],
      aside: ["class"],
      span: [],
      small: [],
      strong: [],
      p: [],
      input: ["type", "checked", "disabled"]
    },
    allowedClasses: {
      a: ["kg-card", "mj-bookmark-card"],
      code: [/^language-[a-z0-9_-]+$/],
      pre: ["mj-code-block"],
      div: ["mj-audio-meta"],
      figure: ["kg-card", "mj-audio-card"],
      aside: ["kg-card", "mj-callout-card", "note", "tip", "warn", "info"]
    },
    allowedSchemes: ["http", "https", "mailto", "tel"],
    allowedSchemesByTag: {
      img: ["http", "https", "data"],
      audio: ["http", "https", "data"],
      source: ["http", "https", "data"]
    },
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
  return decodeHeadingEntities(
    value
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
  )
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
