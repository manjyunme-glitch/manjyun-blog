import { AdminFrame } from "@/components/admin/AdminFrame";
import { SettingsForm } from "@/components/admin/SettingsForm";
import { requireAdmin } from "@/lib/auth/session";
import {
  getHomeModules,
  getNavLinks,
  getSiteSettings
} from "@/lib/db/queries";

export const dynamic = "force-dynamic";

export default async function AdminSettingsPage() {
  await requireAdmin();
  return (
    <AdminFrame
      title="站点设置"
      subtitle="配置站点信息、首页模块和导航链接。"
      activeNav="/admin/settings"
      breadcrumbs={[
        { label: "概览", href: "/admin" },
        { label: "站点设置" }
      ]}
    >
      <SettingsForm
        settings={getSiteSettings()}
        modules={getHomeModules()}
        mainLinks={getNavLinks("main")}
        frequentLinks={getNavLinks("frequent")}
      />
    </AdminFrame>
  );
}
