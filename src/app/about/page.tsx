import type { Metadata } from "next";
import { ThemeHost } from "@/components/theme/ThemeHost";
import { renderMarkdown } from "@/lib/content/markdown";
import { getNavLinks, getPageBySlug, getSiteSettings } from "@/lib/db/queries";
import { createEntryMetadata, createPageMetadata } from "@/lib/seo/metadata";
import { presentPage } from "@/lib/themes/presenter";

export const dynamic = "force-dynamic";

export function generateMetadata(): Metadata {
  const settings = getSiteSettings();
  const page = getPageBySlug("about");
  if (page) return createEntryMetadata(settings, page);
  const markdown = settings.aboutMarkdown || settings.heroBio;
  return createPageMetadata(settings, {
    title: settings.aboutTitle,
    description: renderMarkdown(markdown).text.slice(0, 180),
    href: "/about"
  });
}

export default function AboutPage() {
  const settings = getSiteSettings();
  const page = getPageBySlug("about");
  const markdown = page?.markdown || settings.aboutMarkdown || settings.heroBio;
  const view = presentPage({
    settings,
    navLinks: getNavLinks("main"),
    title: page?.title || settings.aboutTitle,
    href: "/about",
    markdown
  });

  return <ThemeHost themeId={settings.activeTheme} view={view} />;
}
