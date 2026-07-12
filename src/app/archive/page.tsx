import type { Metadata } from "next";
import { ThemeHost } from "@/components/theme/ThemeHost";
import { getNavLinks, getSiteSettings, listPosts } from "@/lib/db/queries";
import { createCollectionMetadata } from "@/lib/seo/metadata";
import { presentCollection } from "@/lib/themes/presenter";

export const dynamic = "force-dynamic";

export function generateMetadata(): Metadata {
  const settings = getSiteSettings();
  return createCollectionMetadata(settings, {
    title: settings.blogTitle,
    description: settings.blogDescription,
    href: "/posts"
  });
}

export default function ArchivePage() {
  const settings = getSiteSettings();
  const view = presentCollection({
    settings,
    navLinks: getNavLinks("main"),
    title: settings.blogTitle,
    description: settings.blogDescription,
    href: "/archive",
    pathLabel: "/posts",
    posts: listPosts({ type: "post", status: "published" })
  });

  return <ThemeHost themeId={settings.activeTheme} view={view} />;
}
