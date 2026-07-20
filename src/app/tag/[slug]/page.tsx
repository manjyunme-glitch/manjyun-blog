import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { ThemeHost } from "@/components/theme/ThemeHost";
import {
  getNavLinks,
  getSiteSettings,
  getTagBySlug,
  listPublishedPostSummaryPage
} from "@/lib/db/queries";
import {
  isCanonicalPublicPageParam,
  normalizePublicPageParam,
  publicCollectionPageHref,
  type PublicPageParam
} from "@/lib/content/public-pagination";
import { createCollectionMetadata } from "@/lib/seo/metadata";
import { presentCollection, tagHref } from "@/lib/themes/presenter";

export const dynamic = "force-dynamic";

type TagPageProps = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ page?: PublicPageParam }>;
};

export async function generateMetadata({
  params,
  searchParams
}: TagPageProps): Promise<Metadata> {
  const { slug } = await params;
  const tag = getTagBySlug(decodeURIComponent(slug));
  if (!tag) return { title: "标签不存在", robots: { index: false, follow: false } };
  const settings = getSiteSettings();
  const page = normalizePublicPageParam((await searchParams).page);
  return createCollectionMetadata(settings, {
    title: page > 1 ? `# ${tag.name} · 第 ${page} 页` : `# ${tag.name}`,
    description: `浏览带有“${tag.name}”标签的公开内容。`,
    href: publicCollectionPageHref(tagHref(tag.slug), page)
  });
}

export default async function TagPage({
  params,
  searchParams
}: TagPageProps) {
  const { slug } = await params;
  const tag = getTagBySlug(decodeURIComponent(slug));
  if (!tag) notFound();

  const rawPage = (await searchParams).page;
  const page = listPublishedPostSummaryPage({
    tagSlug: tag.slug,
    page: normalizePublicPageParam(rawPage)
  });
  if (!isCanonicalPublicPageParam(rawPage, page.page)) {
    redirect(publicCollectionPageHref(tagHref(tag.slug), page.page));
  }

  const settings = getSiteSettings();
  const view = presentCollection({
    settings,
    navLinks: getNavLinks("main"),
    title: `# ${tag.name}`,
    description: "按标签筛选的公开内容。",
    href: tagHref(tag.slug),
    pathLabel: "/posts",
    posts: page.posts,
    pagination: page,
    backLink: { href: "/posts", label: "/posts" }
  });

  return <ThemeHost themeId={settings.activeTheme} view={view} />;
}
