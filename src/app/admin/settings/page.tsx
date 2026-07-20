import { AdminFrame } from "@/components/admin/AdminFrame";
import { SettingsForm } from "@/components/admin/SettingsForm";
import { requireAdmin } from "@/lib/auth/session";
import { getSiteConfiguration } from "@/lib/db/queries";

export const dynamic = "force-dynamic";

export default async function AdminSettingsPage() {
  await requireAdmin();
  const configuration = getSiteConfiguration();
  return (
    <AdminFrame
      title="站点设置"
      subtitle="配置站点信息、首页模块和导航链接。"
      breadcrumbs={[
        { label: "概览", href: "/admin" },
        { label: "站点设置" }
      ]}
    >
      <SettingsForm
        settings={configuration.settings}
        modules={configuration.modules}
        mainLinks={configuration.mainLinks}
        frequentLinks={configuration.frequentLinks}
        configVersion={configuration.version}
      />
    </AdminFrame>
  );
}
