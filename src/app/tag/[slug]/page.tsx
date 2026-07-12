import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ThemeHost } from "@/components/theme/ThemeHost";
import {
  getNavLinks,
  getSiteSettings,
  getTagBySlug,
  listPosts
} from "@/lib/db/queries";
import { createCollectionMetadata } from "@/lib/seo/metadata";
import { presentCollection, tagHref } from "@/lib/themes/presenter";

export const dynamic = "force-dynamic";

type TagPageProps = {
  params: Promise<{ slug: string }>;
};

export async function generateMetadata({ params }: TagPageProps): Promise<Metadata> {
  const { slug } = await params;
  const tag = getTagBySlug(decodeURIComponent(slug));
  if (!tag) return { title: "标签不存在", robots: { index: false, follow: false } };
  const settings = getSiteSettings();
  return createCollectionMetadata(settings, {
    title: `# ${tag.name}`,
    description: `浏览带有“${tag.name}”标签的公开内容。`,
    href: tagHref(tag.slug)
  });
}

export default async function TagPage({
  params
}: TagPageProps) {
  const { slug } = await params;
  const tag = getTagBySlug(decodeURIComponent(slug));
  if (!tag) notFound();

  const settings = getSiteSettings();
  const view = presentCollection({
    settings,
    navLinks: getNavLinks("main"),
    title: `# ${tag.name}`,
    description: "按标签筛选的公开内容。",
    href: tagHref(tag.slug),
    pathLabel: "/posts",
    posts: listPosts({ tagSlug: tag.slug, status: "published" }),
    backLink: { href: "/posts", label: "/posts" }
  });

  return <ThemeHost themeId={settings.activeTheme} view={view} />;
}
