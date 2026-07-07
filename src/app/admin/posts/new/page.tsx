import { AdminFrame } from "@/components/admin/AdminFrame";
import { AdminEditor } from "@/components/admin/AdminEditor";
import { requireAdmin } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export default async function NewPostPage() {
  await requireAdmin();
  return (
    <AdminFrame title="新建内容" subtitle="Markdown 是正文唯一源格式。">
      <AdminEditor post={null} />
    </AdminFrame>
  );
}
