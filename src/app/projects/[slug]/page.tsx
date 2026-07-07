import { notFound } from "next/navigation";
import { getTheme } from "@/themes";
import {
  getAdjacentPosts,
  getNavLinks,
  getPostBySlug,
  getSiteSettings
} from "@/lib/db/queries";
import { renderMarkdown } from "@/lib/content/markdown";
import { readingTime } from "@/lib/content/reading-time";

export const dynamic = "force-dynamic";

export default async function ProjectPage({
  params
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const post = getPostBySlug("project", decodeURIComponent(slug));
  if (!post) notFound();

  const settings = getSiteSettings();
  const theme = getTheme(settings.activeTheme);
  const adjacent = getAdjacentPosts(post);

  return (
    <theme.slots.Post
      settings={settings}
      navLinks={getNavLinks("main")}
      post={post}
      rendered={renderMarkdown(post.markdown)}
      readingTime={readingTime(post.markdown)}
      previous={adjacent.prev}
      next={adjacent.next}
    />
  );
}
