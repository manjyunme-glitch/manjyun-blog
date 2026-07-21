import { Marked, Parser, Renderer } from "marked";
import type { Token, TokenizerAndRendererExtension, Tokens } from "marked";
import sanitizeHtml from "sanitize-html";
import { inferCodeLanguage } from "@/lib/content/code-language";
import { slugify } from "@/lib/content/slug";
import type { RenderedMarkdown } from "@/types/blog";

type InlineMarkdownToken = {
  type: string;
  text?: string;
  tokens?: InlineMarkdownToken[];
};

function escapeAttribute(value: string) {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

function escapeHtml(value: string) {
  return escapeAttribute(value).replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function stripRawInputTags(value: string) {
  return value
    .replace(/<input\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi, "")
    .replace(/<\/input\s*>/gi, "");
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

function decodeCardTitle(value: string) {
  return value.replace(/\\([\\\]])/g, "$1");
}

function decodeCardUrl(value: string) {
  return value.replace(/\\([\\()<>])/g, "$1");
}

function tokenizeLinkedCardBlock(src: string, kind: "audio" | "bookmark") {
  const opening = new RegExp(
    `^ {0,3}\\[${kind}:((?:\\\\.|[^\\]\\\\\\r\\n])+)\\]\\(`
  ).exec(src);
  if (!opening) return null;

  let cursor = opening[0].length;
  while (src[cursor] === " " || src[cursor] === "\t") cursor += 1;

  let url = "";
  if (src[cursor] === "<") {
    const end = src.indexOf(">", cursor + 1);
    if (end === -1 || /[\r\n]/.test(src.slice(cursor + 1, end))) return null;
    url = src.slice(cursor + 1, end);
    cursor = end + 1;
  } else {
    const start = cursor;
    let depth = 0;
    while (cursor < src.length) {
      const character = src[cursor];
      if (character === "\r" || character === "\n") return null;
      if (character === "\\") {
        cursor += Math.min(2, src.length - cursor);
        continue;
      }
      if (character === "(") {
        depth += 1;
        cursor += 1;
        continue;
      }
      if (character === ")") {
        if (depth === 0) break;
        depth -= 1;
        cursor += 1;
        continue;
      }
      if ((character === " " || character === "\t") && depth === 0) break;
      cursor += 1;
    }
    url = src.slice(start, cursor);
  }
  if (!url) return null;

  while (src[cursor] === " " || src[cursor] === "\t") cursor += 1;
  let description = "";
  if (src[cursor] === '"') {
    cursor += 1;
    const start = cursor;
    while (cursor < src.length) {
      if (src[cursor] === "\r" || src[cursor] === "\n") return null;
      if (src[cursor] === "\\") {
        cursor += Math.min(2, src.length - cursor);
        continue;
      }
      if (src[cursor] === '"') break;
      cursor += 1;
    }
    if (src[cursor] !== '"') return null;
    description = src.slice(start, cursor).replace(/\\"/g, '"');
    cursor += 1;
    while (src[cursor] === " " || src[cursor] === "\t") cursor += 1;
  }

  if (src[cursor] !== ")") return null;
  cursor += 1;
  while (src[cursor] === " " || src[cursor] === "\t") cursor += 1;
  if (src[cursor] === "\r" && src[cursor + 1] === "\n") cursor += 2;
  else if (src[cursor] === "\n") cursor += 1;
  else if (cursor !== src.length) return null;

  return {
    raw: src.slice(0, cursor),
    title: opening[1],
    url: decodeCardUrl(url),
    description
  };
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
      /^ {0,3}\[code(?::[^\]\r\n]+)?\]/i.exec(openingLine.line);
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
function createCustomCardExtensions(
  renderCalloutBody: (tokens: Token[]) => string
): TokenizerAndRendererExtension[] {
  return [
  {
    name: "mjCodeBlock",
    level: "block",
    start(src) {
      return /\n {0,3}\[code(?::[^\]\r\n]+)?\]/i.exec(src)?.index;
    },
    tokenizer(src) {
      const match =
        /^ {0,3}\[code(?::([^\]\r\n]+))?\]([\s\S]*?)\[\/code\][\t ]*(?:\r?\n|$)/i.exec(
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
    start(src) {
      return /\n {0,3}\[audio:(?:\\.|[^\]\\\r\n])+\]\(/.exec(src)?.index;
    },
    tokenizer(src) {
      const match = tokenizeLinkedCardBlock(src, "audio");
      if (!match) return;
      return {
        type: "mjAudioCard",
        ...match
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
        decodeCardTitle(title.trim())
      )}</strong></div><audio controls src="${escapeAttribute(
        url
      )}"></audio>${safeCaption}</figure>`;
    }
  },
  {
    name: "mjBookmarkCard",
    level: "block",
    start(src) {
      return /\n {0,3}\[bookmark:(?:\\.|[^\]\\\r\n])+\]\(/.exec(src)?.index;
    },
    tokenizer(src) {
      const match = tokenizeLinkedCardBlock(src, "bookmark");
      if (!match) return;
      return {
        type: "mjBookmarkCard",
        ...match
      };
    },
    renderer(token) {
      const {
        title = "",
        url = "",
        description = ""
      } = token as CustomCardToken;
      const safeUrl = escapeAttribute(url);
      const safeUrlText = escapeHtml(url);
      const safeDescription = description
        ? `<p>${escapeHtml(description.trim())}</p>`
        : "";
      return `<a class="kg-card mj-bookmark-card" href="${safeUrl}"><span>bookmark</span><strong>${escapeHtml(
        decodeCardTitle(title.trim())
      )}</strong>${safeDescription}<small>${safeUrlText}</small></a>`;
    }
  },
  {
    name: "mjCalloutCard",
    level: "block",
    start(src) {
      return /\n {0,3}::callout[\t ]+[^\r\n]+(?:\r?\n|$)/.exec(src)?.index;
    },
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
      const renderedBody = renderCalloutBody(tokens);
      return `<aside class="kg-card mj-callout-card"><strong>${escapeHtml(
        title.trim()
      )}</strong>${renderedBody}</aside>`;
    }
  }
  ];
}

export function renderMarkdown(
  markdown: string,
  options: { demoteH1?: boolean } = {}
): RenderedMarkdown {
  const toc: RenderedMarkdown["toc"] = [];
  const headingIds = new Set<string>();
  const renderer = new Renderer();
  const nestedRenderer = new Renderer();
  const inlineParser = new Parser();

  renderer.html = ({ text }) => stripRawInputTags(text);
  nestedRenderer.html = renderer.html;

  renderer.heading = ({ tokens, depth }) => {
    const renderedText = stripRawInputTags(inlineParser.parseInline(tokens));
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

  nestedRenderer.heading = ({ tokens, depth }) => {
    const renderedText = stripRawInputTags(inlineParser.parseInline(tokens));
    const renderedDepth = options.demoteH1 && depth === 1 ? 2 : depth;
    return `<h${renderedDepth}>${renderedText}</h${renderedDepth}>`;
  };

  renderer.code = ({ text: code, lang }) => {
    // Marked has already removed the fence delimiters. Any remaining leading
    // or trailing newline belongs to the code sample and must be preserved.
    const language = inferCodeLanguage(lang ?? "", code);
    const className = language ? ` class="language-${language}"` : "";
    return `<pre class="mj-code-block"><code${className}>${escapeHtml(
      code
    )}</code></pre>`;
  };
  nestedRenderer.code = renderer.code;

  renderer.blockquote = function ({ tokens }) {
    const body = this.parser.parse(tokens);
    const callout = body.match(
      /^<p>\[!(NOTE|TIP|INFO|WARN|WARNING|IMPORTANT|CAUTION)\](?:[\t ]+|\r?\n)?/i
    );
    if (callout) {
      const sourceLabel = callout[1].toLowerCase();
      const label = sourceLabel === "warning" ? "warn" : sourceLabel;
      const content = body
        .replace(callout[0], "<p>")
        .replace(/^<p><\/p>\s*/, "");
      return `<aside class="kg-card mj-callout-card ${label}"><strong>${sourceLabel}</strong>${content}</aside>`;
    }
    return `<blockquote>${body}</blockquote>`;
  };
  nestedRenderer.blockquote = renderer.blockquote;

  let nestedMarkdownParser: Marked;
  const nestedExtensions = createCustomCardExtensions((tokens) =>
    nestedMarkdownParser.parser(tokens)
  );
  nestedMarkdownParser = new Marked(
    { extensions: nestedExtensions },
    {
      gfm: true,
      breaks: false,
      renderer: nestedRenderer
    }
  );

  const customCardExtensions = createCustomCardExtensions((tokens) =>
    nestedMarkdownParser.parser(tokens)
  );
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
      "del",
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
      a: ["href", "name", "target", "rel", "class", "title"],
      img: ["src", "alt", "title", "loading"],
      h2: ["id"],
      h3: ["id"],
      ol: ["start"],
      th: ["align"],
      td: ["align"],
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
      aside: [
        "kg-card",
        "mj-callout-card",
        "note",
        "tip",
        "warn",
        "info",
        "important",
        "caution"
      ]
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
        const isExternal = /^(?:https?:)?\/\//i.test(href);
        const targetsBlank = attribs.target?.trim().toLowerCase() === "_blank";
        return {
          tagName: "a",
          attribs: {
            ...attribs,
            ...(isExternal
              ? { target: "_blank", rel: "noopener noreferrer" }
              : targetsBlank
                ? { target: "_blank", rel: "noopener noreferrer" }
                : {})
          }
        };
      },
      ol: (_tagName, attribs) => {
        const next = { ...attribs };
        if (next.start && !/^-?\d{1,9}$/.test(next.start)) {
          delete next.start;
        }
        return { tagName: "ol", attribs: next };
      },
      th: (_tagName, attribs) => {
        const next = { ...attribs };
        if (
          next.align &&
          !["left", "center", "right"].includes(next.align.toLowerCase())
        ) {
          delete next.align;
        }
        return { tagName: "th", attribs: next };
      },
      td: (_tagName, attribs) => {
        const next = { ...attribs };
        if (
          next.align &&
          !["left", "center", "right"].includes(next.align.toLowerCase())
        ) {
          delete next.align;
        }
        return { tagName: "td", attribs: next };
      },
      ...(options.demoteH1
        ? {
            h1: () => ({
              tagName: "h2",
              attribs: {}
            })
          }
        : {})
    },
    exclusiveFilter(frame) {
      if (frame.tag !== "input") return false;
      return !(
        frame.attribs.type?.toLowerCase() === "checkbox" &&
        Object.hasOwn(frame.attribs, "disabled")
      );
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
