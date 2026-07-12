import { AdminFrame } from "@/components/admin/AdminFrame";
import { ThemeManager } from "@/components/admin/ThemeManager";
import { requireAdmin } from "@/lib/auth/session";
import {
  getPreviousTheme,
  getSiteSettings,
  listThemeInstalls
} from "@/lib/db/queries";
import { getThemes } from "@/themes";

export const dynamic = "force-dynamic";

export default async function AdminThemesPage() {
  await requireAdmin();
  const settings = getSiteSettings();
  const themes = getThemes();
  const previousThemeId = getPreviousTheme();
  const previousTheme = themes.find(
    (theme) => theme.meta.id === previousThemeId && theme.meta.id !== settings.activeTheme
  );

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
        previousTheme={previousTheme ? {
          id: previousTheme.meta.id,
          name: previousTheme.meta.name
        } : null}
        themes={themes.map((theme) => ({
          ...theme.meta,
          apiVersion: theme.apiVersion,
          capabilities: theme.capabilities
        }))}
        imports={listThemeInstalls()}
      />
    </AdminFrame>
  );
}
