import type { Metadata } from "next";
import { contentHref } from "@/lib/content/content-types";
import type { PostRecord, SiteSettings } from "@/types/blog";

const fallbackBaseUrl = "http://localhost:4482";

export function normalizeBaseUrl(value: string | null | undefined) {
  try {
    const url = new URL(value || fallbackBaseUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error("Unsupported site URL protocol");
    }
    url.hash = "";
    url.search = "";
    // The app has no Next.js basePath support, so SITE_URL is intentionally
    // normalized to an origin instead of pretending a path prefix is retained.
    url.pathname = "/";
    return url;
  } catch {
    return new URL(fallbackBaseUrl);
  }
}

export function absoluteSiteUrl(
  settings: Pick<SiteSettings, "baseUrl">,
  href = "/"
) {
  const base = normalizeBaseUrl(settings.baseUrl);
  return new URL(href || "/", `${base.toString().replace(/\/$/, "")}/`).toString();
}

function pageAlternates(
  settings: Pick<SiteSettings, "baseUrl">,
  canonical: string
): NonNullable<Metadata["alternates"]> {
  return {
    canonical,
    types: {
      "application/rss+xml": absoluteSiteUrl(settings, "/feed.xml")
    }
  };
}

function absoluteMediaUrl(
  settings: Pick<SiteSettings, "baseUrl">,
  cover: string | null | undefined
) {
  if (!cover || (!cover.startsWith("/") && !/^https?:\/\//i.test(cover))) {
    return null;
  }
  return absoluteSiteUrl(settings, cover);
}

function socialImages(
  settings: Pick<SiteSettings, "baseUrl">,
  cover: string | null | undefined
) {
  const url = absoluteMediaUrl(settings, cover);
  return url ? [{ url }] : undefined;
}

export function createSiteMetadata(settings: SiteSettings): Metadata {
  const canonical = absoluteSiteUrl(settings, "/");
  return {
    metadataBase: normalizeBaseUrl(settings.baseUrl),
    title: {
      default: settings.siteTitle,
      template: `%s | ${settings.siteTitle}`
    },
    description: settings.siteDescription,
    alternates: pageAlternates(settings, canonical),
    icons: {
      icon: [{ url: "/icon-mj-terminal.svg", type: "image/svg+xml" }]
    },
    openGraph: {
      type: "website",
      locale: "zh_CN",
      siteName: settings.siteTitle,
      title: settings.siteTitle,
      description: settings.siteDescription,
      url: canonical
    },
    twitter: {
      card: "summary",
      title: settings.siteTitle,
      description: settings.siteDescription
    }
  };
}

export function createWebsiteStructuredData(settings: SiteSettings) {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: settings.siteTitle,
    description: settings.siteDescription,
    url: absoluteSiteUrl(settings, "/"),
    inLanguage: "zh-CN"
  };
}

export function createEntryStructuredData(settings: SiteSettings, post: PostRecord) {
  const url = absoluteSiteUrl(settings, contentHref(post.type, post.slug));
  const image = absoluteMediaUrl(settings, post.cover);
  return {
    "@context": "https://schema.org",
    "@type": post.type === "post" ? "BlogPosting" : post.type === "project" ? "CreativeWork" : "WebPage",
    headline: post.title,
    description: post.seoDescription || post.excerpt || settings.siteDescription,
    url,
    mainEntityOfPage: url,
    datePublished: post.publishedAt ?? post.createdAt,
    dateModified: post.updatedAt,
    inLanguage: "zh-CN",
    author: {
      "@type": "Person",
      name: settings.siteTitle
    },
    ...(image ? { image } : {})
  };
}

export function createCollectionMetadata(
  settings: SiteSettings,
  input: { title: string; description: string; href: string }
): Metadata {
  const canonical = absoluteSiteUrl(settings, input.href);
  return {
    title: input.title,
    description: input.description,
    alternates: pageAlternates(settings, canonical),
    openGraph: {
      type: "website",
      locale: "zh_CN",
      siteName: settings.siteTitle,
      title: input.title,
      description: input.description,
      url: canonical
    },
    twitter: {
      card: "summary",
      title: input.title,
      description: input.description
    }
  };
}

export function createEntryMetadata(
  settings: SiteSettings,
  post: PostRecord
): Metadata {
  const title = post.seoTitle || post.title;
  const description = post.seoDescription || post.excerpt || settings.siteDescription;
  const canonical = absoluteSiteUrl(settings, contentHref(post.type, post.slug));
  const images = socialImages(settings, post.cover);

  return {
    title,
    description,
    alternates: pageAlternates(settings, canonical),
    openGraph: {
      type: post.type === "page" ? "website" : "article",
      locale: "zh_CN",
      siteName: settings.siteTitle,
      title,
      description,
      url: canonical,
      ...(post.type === "page"
        ? {}
        : {
            publishedTime: post.publishedAt ?? post.createdAt,
            modifiedTime: post.updatedAt
          }),
      ...(images ? { images } : {})
    },
    twitter: {
      card: images ? "summary_large_image" : "summary",
      title,
      description,
      ...(images ? { images: images.map((image) => image.url) } : {})
    }
  };
}

export function createPageMetadata(
  settings: SiteSettings,
  input: {
    title: string;
    description?: string | null;
    href: string;
    cover?: string | null;
  }
): Metadata {
  const description = input.description || settings.siteDescription;
  const canonical = absoluteSiteUrl(settings, input.href);
  const images = socialImages(settings, input.cover);
  return {
    title: input.title,
    description,
    alternates: pageAlternates(settings, canonical),
    openGraph: {
      type: "website",
      locale: "zh_CN",
      siteName: settings.siteTitle,
      title: input.title,
      description,
      url: canonical,
      ...(images ? { images } : {})
    },
    twitter: {
      card: images ? "summary_large_image" : "summary",
      title: input.title,
      description,
      ...(images ? { images: images.map((image) => image.url) } : {})
    }
  };
}
