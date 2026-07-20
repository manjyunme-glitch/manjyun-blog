import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { StructuredData } from "@/components/seo/StructuredData";
import { ThemeHost } from "@/components/theme/ThemeHost";
import { getNavLinks, getPageBySlug, getSiteSettings } from "@/lib/db/queries";
import {
  createEntryMetadata,
  createEntryStructuredData
} from "@/lib/seo/metadata";
import { presentPage } from "@/lib/themes/presenter";

export const dynamic = "force-dynamic";

export function generateMetadata(): Metadata {
  const settings = getSiteSettings();
  const page = getPageBySlug("about");
  if (!page) {
    return { title: "页面不存在", robots: { index: false, follow: false } };
  }
  return createEntryMetadata(settings, page);
}

export default function AboutPage() {
  const settings = getSiteSettings();
  const page = getPageBySlug("about");
  if (!page) notFound();
  const view = presentPage({
    settings,
    navLinks: getNavLinks("main"),
    title: page.title,
    href: "/about",
    markdown: page.markdown
  });

  return (
    <>
      <StructuredData data={createEntryStructuredData(settings, page)} />
      <ThemeHost themeId={settings.activeTheme} view={view} />
    </>
  );
}
