import { notFound } from "next/navigation";
import { getTheme } from "@/themes";
import {
  getNavLinks,
  getSiteSettings,
  getTagBySlug,
  listPosts
} from "@/lib/db/queries";

export const dynamic = "force-dynamic";

export default async function TagPage({
  params
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const tag = getTagBySlug(decodeURIComponent(slug));
  if (!tag) notFound();

  const settings = getSiteSettings();
  const theme = getTheme(settings.activeTheme);

  return (
    <theme.slots.Archive
      settings={settings}
      navLinks={getNavLinks("main")}
      title={`# ${tag.name}`}
      description="按标签筛选的公开内容。"
      posts={listPosts({ tagSlug: tag.slug, status: "published" })}
    />
  );
}
