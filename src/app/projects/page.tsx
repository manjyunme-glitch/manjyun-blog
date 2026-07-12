import type { Metadata } from "next";
import { ThemeHost } from "@/components/theme/ThemeHost";
import { getNavLinks, getSiteSettings, listPosts } from "@/lib/db/queries";
import { createCollectionMetadata } from "@/lib/seo/metadata";
import { presentCollection } from "@/lib/themes/presenter";

export const dynamic = "force-dynamic";

export function generateMetadata(): Metadata {
  const settings = getSiteSettings();
  return createCollectionMetadata(settings, {
    title: settings.projectsTitle,
    description: settings.projectsDescription,
    href: "/projects"
  });
}

export default function ProjectsPage() {
  const settings = getSiteSettings();
  const view = presentCollection({
    settings,
    navLinks: getNavLinks("main"),
    title: settings.projectsTitle,
    description: settings.projectsDescription,
    href: "/projects",
    posts: listPosts({ type: "project", status: "published" })
  });

  return <ThemeHost themeId={settings.activeTheme} view={view} />;
}
