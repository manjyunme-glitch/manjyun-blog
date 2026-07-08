import { AdminFrame } from "@/components/admin/AdminFrame";
import { ThemeManager } from "@/components/admin/ThemeManager";
import { requireAdmin } from "@/lib/auth/session";
import { getSiteSettings, listThemeInstalls } from "@/lib/db/queries";
import { getThemes } from "@/themes";

export const dynamic = "force-dynamic";

export default async function AdminThemesPage() {
  await requireAdmin();
  const settings = getSiteSettings();
  const themes = getThemes();

  return (
    <AdminFrame
      title="主题"
      subtitle="v1 以代码主题包扩展，后台负责切换和查看元信息。"
      activeNav="/admin/themes"
      breadcrumbs={[
        { label: "概览", href: "/admin" },
        { label: "主题" }
      ]}
    >
      <ThemeManager
        activeTheme={settings.activeTheme}
        themes={themes.map((theme) => ({ ...theme.meta, tokens: theme.tokens }))}
        imports={listThemeInstalls()}
      />
    </AdminFrame>
  );
}
