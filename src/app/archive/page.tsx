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

type ArchivePageProps = {
  searchParams: Promise<{ page?: PublicPageParam }>;
};

export async function generateMetadata({
  searchParams
}: ArchivePageProps): Promise<Metadata> {
  const settings = getSiteSettings();
  const page = normalizePublicPageParam((await searchParams).page);
  return createCollectionMetadata(settings, {
    title: page > 1 ? `${settings.blogTitle} · 第 ${page} 页` : settings.blogTitle,
    description: settings.blogDescription,
    href: publicCollectionPageHref("/archive", page)
  });
}

export default async function ArchivePage({
  searchParams
}: ArchivePageProps) {
  const rawPage = (await searchParams).page;
  const page = listPublishedPostSummaryPage({
    type: "post",
    page: normalizePublicPageParam(rawPage)
  });
  if (!isCanonicalPublicPageParam(rawPage, page.page)) {
    redirect(publicCollectionPageHref("/archive", page.page));
  }

  const settings = getSiteSettings();
  const view = presentCollection({
    settings,
    navLinks: getNavLinks("main"),
    title: settings.blogTitle,
    description: settings.blogDescription,
    href: "/archive",
    pathLabel: "/posts",
    posts: page.posts,
    pagination: page
  });

  return <ThemeHost themeId={settings.activeTheme} view={view} />;
}
