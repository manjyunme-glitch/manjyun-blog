import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { StructuredData } from "@/components/seo/StructuredData";
import { ThemeHost } from "@/components/theme/ThemeHost";
import {
  getAdjacentPosts,
  getNavLinks,
  getPostBySlug,
  getSiteSettings
} from "@/lib/db/queries";
import {
  createEntryMetadata,
  createEntryStructuredData
} from "@/lib/seo/metadata";
import { presentEntry } from "@/lib/themes/presenter";

export const dynamic = "force-dynamic";

type PostPageProps = {
  params: Promise<{ slug: string }>;
};

export async function generateMetadata({ params }: PostPageProps): Promise<Metadata> {
  const { slug } = await params;
  const post = getPostBySlug("post", decodeURIComponent(slug));
  if (!post) return { title: "随笔不存在", robots: { index: false, follow: false } };
  return createEntryMetadata(getSiteSettings(), post);
}

export default async function PostPage({
  params
}: PostPageProps) {
  const { slug } = await params;
  const post = getPostBySlug("post", decodeURIComponent(slug));
  if (!post) notFound();

  const settings = getSiteSettings();
  const adjacent = getAdjacentPosts(post);
  const view = presentEntry({
    settings,
    navLinks: getNavLinks("main"),
    post,
    previous: adjacent.prev,
    next: adjacent.next
  });

  return (
    <>
      <StructuredData data={createEntryStructuredData(settings, post)} />
      <ThemeHost themeId={settings.activeTheme} view={view} />
    </>
  );
}
