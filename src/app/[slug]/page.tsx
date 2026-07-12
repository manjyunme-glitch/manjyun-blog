import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { StructuredData } from "@/components/seo/StructuredData";
import { ThemeHost } from "@/components/theme/ThemeHost";
import { contentHref } from "@/lib/content/content-types";
import { getNavLinks, getPageBySlug, getSiteSettings } from "@/lib/db/queries";
import {
  createEntryMetadata,
  createEntryStructuredData
} from "@/lib/seo/metadata";
import { presentPage } from "@/lib/themes/presenter";

export const dynamic = "force-dynamic";

type CustomPageProps = {
  params: Promise<{ slug: string }>;
};

export async function generateMetadata({ params }: CustomPageProps): Promise<Metadata> {
  const { slug } = await params;
  const page = getPageBySlug(decodeURIComponent(slug));
  if (!page) return { title: "页面不存在", robots: { index: false, follow: false } };
  return createEntryMetadata(getSiteSettings(), page);
}

export default async function CustomPage({
  params
}: CustomPageProps) {
  const { slug: rawSlug } = await params;
  const slug = decodeURIComponent(rawSlug);
  const page = getPageBySlug(slug);
  if (!page) notFound();

  const settings = getSiteSettings();
  const view = presentPage({
    settings,
    navLinks: getNavLinks("main"),
    title: page.title,
    href: contentHref(page.type, page.slug),
    markdown: page.markdown
  });

  return (
    <>
      <StructuredData data={createEntryStructuredData(settings, page)} />
      <ThemeHost themeId={settings.activeTheme} view={view} />
    </>
  );
}
