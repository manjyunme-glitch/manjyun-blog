import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ThemeHost } from "@/components/theme/ThemeHost";
import {
  getNavLinks,
  getSiteSettings,
  listPublishedPostSummaryPage
} from "@/lib/db/queries";
import {
  isCanonicalPublicPageParam,
  normalizePublicPageParam,
  publicCollectionPageHref,
  type PublicPageParam
} from "@/lib/content/public-pagination";
import { createCollectionMetadata } from "@/lib/seo/metadata";
import { presentCollection } from "@/lib/themes/presenter";

export const dynamic = "force-dynamic";

type ProjectsPageProps = {
  searchParams: Promise<{ page?: PublicPageParam }>;
};

export async function generateMetadata({
  searchParams
}: ProjectsPageProps): Promise<Metadata> {
  const settings = getSiteSettings();
  const page = normalizePublicPageParam((await searchParams).page);
  return createCollectionMetadata(settings, {
    title:
      page > 1
        ? `${settings.projectsTitle} · 第 ${page} 页`
        : settings.projectsTitle,
    description: settings.projectsDescription,
    href: publicCollectionPageHref("/projects", page)
  });
}

export default async function ProjectsPage({
  searchParams
}: ProjectsPageProps) {
  const rawPage = (await searchParams).page;
  const page = listPublishedPostSummaryPage({
    type: "project",
    page: normalizePublicPageParam(rawPage)
  });
  if (!isCanonicalPublicPageParam(rawPage, page.page)) {
    redirect(publicCollectionPageHref("/projects", page.page));
  }

  const settings = getSiteSettings();
  const view = presentCollection({
    settings,
    navLinks: getNavLinks("main"),
    title: settings.projectsTitle,
    description: settings.projectsDescription,
    href: "/projects",
    posts: page.posts,
    pagination: page
  });

  return <ThemeHost themeId={settings.activeTheme} view={view} />;
}
