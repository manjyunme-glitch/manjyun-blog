import { AdminFrame } from "@/components/admin/AdminFrame";
import { MediaLibrary } from "@/components/admin/MediaLibrary";
import { requireAdmin } from "@/lib/auth/session";
import { listMedia } from "@/lib/db/queries";

export const dynamic = "force-dynamic";

export default async function AdminMediaPage() {
  await requireAdmin();
  return (
    <AdminFrame
      title="媒体库"
      subtitle="图片、音频和附件都会写入 uploads volume。"
      activeNav="/admin/media"
      breadcrumbs={[
        { label: "概览", href: "/admin" },
        { label: "媒体库" }
      ]}
    >
      <MediaLibrary media={listMedia()} />
    </AdminFrame>
  );
}
