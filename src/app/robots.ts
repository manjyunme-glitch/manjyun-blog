import type { MetadataRoute } from "next";
import { getSiteSettings } from "@/lib/db/queries";
import { absoluteSiteUrl } from "@/lib/seo/metadata";

export const dynamic = "force-dynamic";

export default function robots(): MetadataRoute.Robots {
  const settings = getSiteSettings();
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: [
        "/admin",
        "/admin/",
        "/api/admin",
        "/api/admin/",
        "/theme-preview/"
      ]
    },
    sitemap: absoluteSiteUrl(settings, "/sitemap.xml")
  };
}
