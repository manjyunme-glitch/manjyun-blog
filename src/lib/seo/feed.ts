import { absoluteSiteUrl } from "@/lib/seo/metadata";
import { contentHref } from "@/lib/content/content-types";
import type { PublicFeedItem, SiteSettings } from "@/types/blog";

export function escapeXml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function rfc822(value: string | Date) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? new Date(0).toUTCString() : date.toUTCString();
}

export function buildRssFeed(input: {
  settings: SiteSettings;
  posts: PublicFeedItem[];
  now?: Date;
}) {
  const { settings } = input;
  const homeUrl = absoluteSiteUrl(settings, "/");
  const selfUrl = absoluteSiteUrl(settings, "/feed.xml");
  const items = input.posts.map((post) => {
    const url = absoluteSiteUrl(settings, contentHref(post.type, post.slug));
    const description = post.excerpt || post.seoDescription || "";
    return [
      "    <item>",
      `      <title>${escapeXml(post.title)}</title>`,
      `      <link>${escapeXml(url)}</link>`,
      `      <guid isPermaLink="true">${escapeXml(url)}</guid>`,
      `      <pubDate>${rfc822(post.publishedAt ?? post.createdAt)}</pubDate>`,
      `      <description>${escapeXml(description)}</description>`,
      "    </item>"
    ].join("\n");
  });

  const newest = input.posts
    .map((post) => new Date(post.updatedAt))
    .filter((date) => !Number.isNaN(date.getTime()))
    .sort((left, right) => right.getTime() - left.getTime())[0];
  const lastBuildDate = newest ?? input.now ?? new Date();

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">',
    "  <channel>",
    `    <title>${escapeXml(settings.siteTitle)}</title>`,
    `    <link>${escapeXml(homeUrl)}</link>`,
    `    <description>${escapeXml(settings.siteDescription)}</description>`,
    "    <language>zh-CN</language>",
    `    <lastBuildDate>${rfc822(lastBuildDate)}</lastBuildDate>`,
    `    <atom:link href="${escapeXml(selfUrl)}" rel="self" type="application/rss+xml" />`,
    ...items,
    "  </channel>",
    "</rss>",
    ""
  ].join("\n");
}
