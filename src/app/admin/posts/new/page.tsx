import { AdminFrame } from "@/components/admin/AdminFrame";
import { AdminEditor } from "@/components/admin/AdminEditor";
import { requireAdmin } from "@/lib/auth/session";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function NewPostPage() {
  await requireAdmin();
  return (
    <AdminFrame
      title="新建内容"
      subtitle="Markdown 是正文唯一源格式。"
      breadcrumbs={[
        { label: "概览", href: "/admin" },
        { label: "内容", href: "/admin/posts" },
        { label: "新建内容" }
      ]}
      action={<Link className="btn" href="/admin/posts?status=draft">返回草稿列表</Link>}
    >
      <AdminEditor post={null} backHref="/admin/posts?status=draft" backLabel="返回草稿列表" />
    </AdminFrame>
  );
}
