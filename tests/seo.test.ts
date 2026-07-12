import assert from "node:assert/strict";
import test from "node:test";
import { buildRssFeed, escapeXml } from "@/lib/seo/feed";
import {
  absoluteSiteUrl,
  createEntryStructuredData,
  createEntryMetadata,
  normalizeBaseUrl
} from "@/lib/seo/metadata";
import type { PostRecord, SiteSettings } from "@/types/blog";

const settings: SiteSettings = {
  siteTitle: "示例站点",
  siteDescription: "站点 <描述>",
  baseUrl: "https://example.com/blog/",
  activeTheme: "manjyun-console",
  heroBio: "bio",
  heroTags: "one,two",
  stackItems: "TypeScript",
  uptimeStart: "2026-01-01",
  blogTitle: "随笔",
  blogDescription: "随笔列表",
  projectsTitle: "项目",
  projectsDescription: "项目列表",
  aboutTitle: "关于",
  aboutMarkdown: "关于"
};

const post: PostRecord = {
  id: 1,
  type: "post",
  slug: "hello-world",
  title: "Hello & 世界",
  markdown: "正文",
  excerpt: "摘要 <测试>",
  cover: "/uploads/cover.png",
  status: "published",
  publishedAt: "2026-07-01T00:00:00.000Z",
  seoTitle: "SEO 标题",
  seoDescription: "SEO 描述",
  createdAt: "2026-06-30T00:00:00.000Z",
  updatedAt: "2026-07-02T00:00:00.000Z",
  tags: []
};

test("SEO URLs normalize invalid values and use the configured origin", () => {
  assert.equal(normalizeBaseUrl("javascript:alert(1)").origin, "http://localhost:4482");
  assert.equal(absoluteSiteUrl(settings, "/posts/hello"), "https://example.com/posts/hello");
});

test("entry metadata uses stored SEO fields and canonical content URLs", () => {
  const metadata = createEntryMetadata(settings, post);
  assert.equal(metadata.title, "SEO 标题");
  assert.equal(metadata.description, "SEO 描述");
  assert.deepEqual(metadata.alternates, {
    canonical: "https://example.com/posts/hello-world",
    types: {
      "application/rss+xml": "https://example.com/feed.xml"
    }
  });
  assert.equal(
    metadata.openGraph && "type" in metadata.openGraph
      ? metadata.openGraph.type
      : undefined,
    "article"
  );
});

test("structured data only exposes web-safe cover URLs", () => {
  const unsafe = createEntryStructuredData(settings, {
    ...post,
    cover: "data:image/png;base64,abc"
  });
  assert.equal("image" in unsafe, false);
  assert.equal(
    createEntryStructuredData(settings, post).image,
    "https://example.com/uploads/cover.png"
  );
});

test("RSS output escapes content and emits absolute canonical item URLs", () => {
  assert.equal(escapeXml("<&\"'>"), "&lt;&amp;&quot;&apos;&gt;");
  const xml = buildRssFeed({ settings, posts: [post], now: new Date(0) });
  assert.match(xml, /<title>Hello &amp; 世界<\/title>/);
  assert.match(xml, /https:\/\/example\.com\/posts\/hello-world/);
  assert.match(xml, /摘要 &lt;测试&gt;/);
  assert.doesNotMatch(xml, /站点 <描述>/);
});
