import type { Metadata } from "next";
import { adminThemeTokenStyle } from "@/admin/themes/types";
import { resolveAdminTheme } from "@/admin/themes/registry";
import { getSiteSettings } from "@/lib/db/queries";
import "./admin.css";
import "@/admin/themes/console.css";
import "@/admin/themes/paper-atlas.css";
import "@/admin/themes/neon-rift.css";

export const metadata: Metadata = {
  title: "管理后台",
  robots: { index: false, follow: false }
};

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const selected = resolveAdminTheme(getSiteSettings().activeTheme);
  return (
    <div
      data-admin-root
      data-admin-theme={selected.theme.meta.id}
      data-admin-theme-requested={selected.requestedId}
      data-admin-theme-fallback={selected.isFallback ? "true" : undefined}
      style={adminThemeTokenStyle(selected.theme.tokens)}
    >
      {children}
    </div>
  );
}
