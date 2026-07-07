import { getTheme } from "@/themes";
import { getNavLinks, getSiteSettings, listPosts } from "@/lib/db/queries";

export const dynamic = "force-dynamic";

export default function ProjectsPage() {
  const settings = getSiteSettings();
  const theme = getTheme(settings.activeTheme);
  const projects = listPosts({ type: "project", status: "published" });

  return (
    <theme.slots.Archive
      settings={settings}
      navLinks={getNavLinks("main")}
      title={settings.projectsTitle}
      description={settings.projectsDescription}
      posts={projects}
    />
  );
}
