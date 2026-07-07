import { getTheme } from "@/themes";
import {
  getHomeModules,
  getNavLinks,
  getSiteSettings,
  listPosts
} from "@/lib/db/queries";

export const dynamic = "force-dynamic";

export default function HomePage() {
  const settings = getSiteSettings();
  const theme = getTheme(settings.activeTheme);
  const modules = getHomeModules();
  const recentConfig = modules.find((module) => module.id === "recentPosts")?.config ?? {};
  const projectsConfig = modules.find((module) => module.id === "projects")?.config ?? {};
  const recentLimit = Number(recentConfig.limit ?? 3) || 3;
  const projectLimit = Number(projectsConfig.limit ?? 3) || 3;
  const navLinks = getNavLinks("main");
  const frequentLinks = getNavLinks("frequent");
  const posts = listPosts({ type: "post", status: "published", limit: recentLimit });
  const projects = listPosts({ type: "project", status: "published", limit: projectLimit });

  return (
    <theme.slots.Home
      settings={settings}
      modules={modules}
      navLinks={navLinks}
      frequentLinks={frequentLinks}
      posts={posts}
      projects={projects}
    />
  );
}
