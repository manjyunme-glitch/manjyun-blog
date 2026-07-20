import type { MetadataRoute } from "next";
import { contentHref } from "@/lib/content/content-types";
import {
  getSiteSettings,
  getTags,
  listPublishedSitemapEntries
} from "@/lib/db/queries";
import { absoluteSiteUrl } from "@/lib/seo/metadata";
import type { PostType } from "@/types/blog";

export const dynamic = "force-dynamic";

export default function sitemap(): MetadataRoute.Sitemap {
  const settings = getSiteSettings();
  const entries = new Map<string, MetadataRoute.Sitemap[number]>();
  const add = (item: MetadataRoute.Sitemap[number]) => entries.set(item.url, item);

  add({ url: absoluteSiteUrl(settings, "/"), changeFrequency: "weekly", priority: 1 });
  add({ url: absoluteSiteUrl(settings, "/posts"), changeFrequency: "weekly", priority: 0.8 });
  add({ url: absoluteSiteUrl(settings, "/projects"), changeFrequency: "monthly", priority: 0.7 });
  for (const type of ["post", "project", "page"] satisfies PostType[]) {
    for (const post of listPublishedSitemapEntries(type)) {
      add({
        url: absoluteSiteUrl(settings, contentHref(post.type, post.slug)),
        lastModified: new Date(post.updatedAt),
        changeFrequency: post.type === "post" ? "monthly" : "yearly",
        priority: post.type === "page" ? 0.5 : 0.7
      });
    }
  }

  for (const tag of getTags()) {
    add({
      url: absoluteSiteUrl(settings, `/tag/${encodeURIComponent(tag.slug)}`),
      changeFrequency: "monthly",
      priority: 0.4
    });
  }

  return Array.from(entries.values());
}
