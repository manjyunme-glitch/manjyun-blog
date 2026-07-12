import {
  contentHref,
  getContentTypeDefinition
} from "@/lib/content/content-types";
import { formatDate, hostFromUrl, uptimeFrom } from "@/lib/content/format";
import { renderEntryMarkdown, renderMarkdown } from "@/lib/content/markdown";
import { readingTime } from "@/lib/content/reading-time";
import { splitCommaList } from "@/lib/content/slug";
import type {
  HomeModule,
  NavLink,
  PostRecord,
  PostWithTags,
  SiteSettings
} from "@/types/blog";
import type {
  ThemeCollectionViewModel,
  ThemeEntrySummaryViewModel,
  ThemeEntryViewModel,
  ThemeHomeModuleViewModel,
  ThemeHomeViewModel,
  ThemeLinkViewModel,
  ThemeNavigationItemViewModel,
  ThemeNavigationViewModel,
  ThemeNotFoundViewModel,
  ThemePageContextViewModel,
  ThemePageViewModel,
  ThemeRenderedContentViewModel,
  ThemeSiteViewModel
} from "@/themes/types";

function isExternalUrl(url: string) {
  return /^https?:\/\//i.test(url);
}

function toLink(label: string, href: string): ThemeLinkViewModel {
  return { label, href, isExternal: isExternalUrl(href) };
}

function pathnameFromHref(href: string) {
  try {
    return new URL(href, "http://theme.local").pathname;
  } catch {
    return href.split(/[?#]/, 1)[0] || "/";
  }
}

function isCurrentHref(href: string, currentPath: string) {
  if (isExternalUrl(href)) return false;
  const hrefPath = pathnameFromHref(href).replace(/\/$/, "") || "/";
  const activePath = pathnameFromHref(currentPath).replace(/\/$/, "") || "/";
  if (hrefPath === "/") return activePath === "/";
  return activePath === hrefPath || activePath.startsWith(`${hrefPath}/`);
}

function presentNavItem(
  link: NavLink,
  currentPath: string
): ThemeNavigationItemViewModel {
  return {
    id: String(link.id),
    label: link.label,
    href: link.url,
    iconUrl: link.iconUrl,
    isExternal: isExternalUrl(link.url),
    isCurrent: isCurrentHref(link.url, currentPath)
  };
}

export function presentSite(
  settings: SiteSettings,
  now: Date = new Date()
): ThemeSiteViewModel {
  return {
    title: settings.siteTitle,
    description: settings.siteDescription,
    homeHref: "/",
    footer: {
      copyrightLabel: `© ${now.getFullYear()} ${settings.siteTitle}`,
      uptimeLabel: `运行始于 ${formatDate(settings.uptimeStart)} · ${uptimeFrom(settings.uptimeStart)}`,
      hostingLabel: "hosted on my own infra"
    }
  };
}

export function presentNavigation(
  navLinks: NavLink[],
  currentPath: string
): ThemeNavigationViewModel {
  return {
    label: "主导航",
    items: navLinks.map((link) => presentNavItem(link, currentPath))
  };
}

function presentContext(
  settings: SiteSettings,
  navLinks: NavLink[],
  currentPath: string
): ThemePageContextViewModel {
  return {
    site: presentSite(settings),
    navigation: presentNavigation(navLinks, currentPath)
  };
}

export function tagHref(slug: string) {
  return `/tag/${slug}`;
}

export function presentEntrySummary(
  post: PostRecord
): ThemeEntrySummaryViewModel {
  const type = getContentTypeDefinition(post.type);
  const publishedAt = post.publishedAt ?? post.createdAt;
  return {
    id: String(post.id),
    typeId: type.id,
    typeLabel: type.label,
    title: post.title,
    href: contentHref(post.type, post.slug),
    excerpt: post.excerpt,
    cover: post.cover ? { src: post.cover, alt: post.title } : null,
    published: {
      iso: publishedAt,
      label: formatDate(publishedAt)
    },
    tags: (post.tags ?? []).map((tag) => ({
      id: String(tag.id),
      label: tag.name,
      href: tagHref(tag.slug)
    }))
  };
}

function configList(
  config: Record<string, unknown>,
  key: string,
  fallback: string
) {
  const value = config[key];
  if (Array.isArray(value)) {
    return value.map(String).map((item) => item.trim()).filter(Boolean);
  }
  if (typeof value === "string") return splitCommaList(value);
  return splitCommaList(fallback);
}

function presentHomeModule(
  module: HomeModule,
  input: {
    settings: SiteSettings;
    frequentLinks: NavLink[];
    posts: PostRecord[];
    projects: PostRecord[];
  }
): ThemeHomeModuleViewModel | null {
  const config = module.config ?? {};
  const title = (fallback: string) => String(config.title ?? fallback);

  switch (module.id) {
    case "recentPosts":
      return {
        id: module.id,
        kind: "entries",
        title: title("Recent Posts"),
        entries: input.posts.map(presentEntrySummary),
        moreLink: toLink("all", "/posts"),
        emptyMessage: "还没有发布随笔。登录后台写第一篇。"
      };
    case "projects":
      return {
        id: module.id,
        kind: "entries",
        title: title("Projects"),
        entries: input.projects.map(presentEntrySummary),
        moreLink: toLink("all", "/projects"),
        emptyMessage: "还没有发布项目记录。"
      };
    case "now":
      return {
        id: module.id,
        kind: "now",
        title: title("Now"),
        statusLabel: "current note",
        facts: [
          { label: "正在折腾：", value: String(config.workingOn ?? "暂无记录") },
          { label: "最近在看：", value: String(config.reading ?? "暂无记录") }
        ],
        completed: Array.isArray(config.completed)
          ? config.completed.map(String)
          : []
      };
    case "frequentLinks":
      return {
        id: module.id,
        kind: "links",
        title: title("Frequent"),
        links: input.frequentLinks.map((link) => ({
          ...presentNavItem(link, "/"),
          hostLabel: hostFromUrl(link.url)
        })),
        emptyMessage: "后台设置常用链接后会显示在这里。"
      };
    case "stack":
      return {
        id: module.id,
        kind: "stack",
        title: title("Stack"),
        items: configList(config, "items", input.settings.stackItems)
      };
    default:
      return null;
  }
}

export function presentHome(input: {
  settings: SiteSettings;
  navLinks: NavLink[];
  frequentLinks: NavLink[];
  modules: HomeModule[];
  posts: PostRecord[];
  projects: PostRecord[];
}): ThemeHomeViewModel {
  const modules = [...input.modules]
    .filter((module) => module.enabled)
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((module) => presentHomeModule(module, input))
    .filter((module): module is ThemeHomeModuleViewModel => module !== null);

  return {
    view: "home",
    ...presentContext(input.settings, input.navLinks, "/"),
    hero: {
      title: input.settings.siteTitle,
      bio: input.settings.heroBio,
      tags: splitCommaList(input.settings.heroTags)
    },
    modules
  };
}

export function presentCollection(input: {
  settings: SiteSettings;
  navLinks: NavLink[];
  title: string;
  description: string;
  href: string;
  pathLabel?: string;
  posts: PostRecord[];
  backLink?: { href: string; label: string };
}): ThemeCollectionViewModel {
  const entries = input.posts.map(presentEntrySummary);
  return {
    view: "collection",
    ...presentContext(input.settings, input.navLinks, input.href),
    title: input.title,
    description: input.description,
    href: input.href,
    pathLabel: input.pathLabel ?? input.href,
    countLabel: `${entries.length} ${entries.length === 1 ? "entry" : "entries"}`,
    sortLabel: "sorted by published date",
    entries,
    emptyMessage: "这里还没有内容。",
    backLink: input.backLink
      ? toLink(input.backLink.label, input.backLink.href)
      : null
  };
}

function presentRenderedContent(
  rendered: ReturnType<typeof renderMarkdown>
): ThemeRenderedContentViewModel {
  return {
    html: rendered.html,
    text: rendered.text,
    toc: rendered.toc.map((item) => ({ ...item }))
  };
}

function presentAdjacent(
  post: PostRecord | null,
  label: string
) {
  return post
    ? {
        title: post.title,
        href: contentHref(post.type, post.slug),
        label
      }
    : null;
}

export function presentEntry(input: {
  settings: SiteSettings;
  navLinks: NavLink[];
  post: PostWithTags;
  previous: PostRecord | null;
  next: PostRecord | null;
}): ThemeEntryViewModel {
  const summary = presentEntrySummary(input.post);
  const type = getContentTypeDefinition(input.post.type);
  return {
    view: "entry",
    ...presentContext(input.settings, input.navLinks, summary.href),
    ...summary,
    readingTimeLabel: readingTime(input.post.markdown),
    content: presentRenderedContent(
      renderEntryMarkdown(input.post.markdown, input.post.title)
    ),
    backLink: toLink(type.routePrefix || "/", type.routePrefix || "/"),
    adjacent: {
      previous: presentAdjacent(input.previous, "上一篇"),
      next: presentAdjacent(input.next, "下一篇")
    }
  };
}

export function presentPage(input: {
  settings: SiteSettings;
  navLinks: NavLink[];
  title: string;
  href: string;
  markdown: string;
}): ThemePageViewModel {
  return {
    view: "page",
    ...presentContext(input.settings, input.navLinks, input.href),
    title: input.title,
    href: input.href,
    content: presentRenderedContent(
      renderEntryMarkdown(input.markdown, input.title)
    )
  };
}

export function presentNotFound(input: {
  settings: SiteSettings;
  navLinks: NavLink[];
}): ThemeNotFoundViewModel {
  return {
    view: "not-found",
    ...presentContext(input.settings, input.navLinks, "/404"),
    statusCode: 404,
    title: "页面不存在",
    description: "这个路径没有找到可以展示的内容。",
    homeLink: toLink("返回首页", "/")
  };
}
