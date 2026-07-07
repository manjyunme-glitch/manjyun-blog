import { getTheme } from "@/themes";
import { getNavLinks, getPageBySlug, getSiteSettings } from "@/lib/db/queries";
import { renderMarkdown } from "@/lib/content/markdown";

export const dynamic = "force-dynamic";

export default function AboutPage() {
  const settings = getSiteSettings();
  const theme = getTheme(settings.activeTheme);
  const page = getPageBySlug("about");
  const markdown = page?.markdown || settings.aboutMarkdown || settings.heroBio;

  return (
    <theme.slots.Page
      settings={settings}
      navLinks={getNavLinks("main")}
      title={page?.title || settings.aboutTitle}
      rendered={renderMarkdown(markdown)}
    />
  );
}
