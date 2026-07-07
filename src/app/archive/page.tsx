import { getTheme } from "@/themes";
import { getNavLinks, getSiteSettings, listPosts } from "@/lib/db/queries";

export const dynamic = "force-dynamic";

export default function ArchivePage() {
  const settings = getSiteSettings();
  const theme = getTheme(settings.activeTheme);
  const posts = listPosts({ type: "post", status: "published" });

  return (
    <theme.slots.Archive
      settings={settings}
      navLinks={getNavLinks("main")}
      title={settings.blogTitle}
      description={settings.blogDescription}
      posts={posts}
    />
  );
}
