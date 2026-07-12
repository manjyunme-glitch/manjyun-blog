import type { Metadata } from "next";
import { ThemeHost } from "@/components/theme/ThemeHost";
import { getNavLinks, getSiteSettings } from "@/lib/db/queries";
import { presentNotFound } from "@/lib/themes/presenter";

export const metadata: Metadata = {
  title: "页面不存在",
  robots: { index: false, follow: false }
};

export const dynamic = "force-dynamic";

export default function NotFound() {
  const settings = getSiteSettings();
  const view = presentNotFound({
    settings,
    navLinks: getNavLinks("main")
  });

  return <ThemeHost themeId={settings.activeTheme} view={view} />;
}
