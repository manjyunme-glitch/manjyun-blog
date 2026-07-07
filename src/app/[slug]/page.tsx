import { notFound } from "next/navigation";
import { renderMarkdown } from "@/lib/content/markdown";
import { getNavLinks, getPageBySlug, getSiteSettings } from "@/lib/db/queries";
import { getTheme } from "@/themes";

export const dynamic = "force-dynamic";

export default async function CustomPage({
  params
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug: rawSlug } = await params;
  const slug = decodeURIComponent(rawSlug);
  const page = getPageBySlug(slug);
  if (!page) notFound();

  const settings = getSiteSettings();
  const theme = getTheme(settings.activeTheme);

  return (
    <theme.slots.Page
      settings={settings}
      navLinks={getNavLinks("main")}
      title={page.title}
      rendered={renderMarkdown(page.markdown)}
    />
  );
}
