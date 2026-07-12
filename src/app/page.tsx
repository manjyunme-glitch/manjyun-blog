import { ThemeHost } from "@/components/theme/ThemeHost";
import { loadHomeThemeView } from "@/lib/themes/public-view-data";

export const dynamic = "force-dynamic";

export default function HomePage() {
  const { settings, view } = loadHomeThemeView();
  return <ThemeHost themeId={settings.activeTheme} view={view} />;
}
