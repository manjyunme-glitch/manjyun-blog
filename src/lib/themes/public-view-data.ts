import {
  getHomeModules,
  getNavLinks,
  getSiteSettings,
  listPosts
} from "@/lib/db/queries";
import { presentHome } from "@/lib/themes/presenter";

export function loadHomeThemeView() {
  const settings = getSiteSettings();
  const modules = getHomeModules();
  const recentConfig = modules.find((module) => module.id === "recentPosts")?.config ?? {};
  const projectsConfig = modules.find((module) => module.id === "projects")?.config ?? {};
  const recentLimit = Number(recentConfig.limit ?? 3) || 3;
  const projectLimit = Number(projectsConfig.limit ?? 3) || 3;

  return {
    settings,
    view: presentHome({
      settings,
      modules,
      navLinks: getNavLinks("main"),
      frequentLinks: getNavLinks("frequent"),
      posts: listPosts({ type: "post", status: "published", limit: recentLimit }),
      projects: listPosts({
        type: "project",
        status: "published",
        limit: projectLimit
      })
    })
  };
}
