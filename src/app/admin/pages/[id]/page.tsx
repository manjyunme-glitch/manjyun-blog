import Link from "next/link";
import { notFound } from "next/navigation";
import { AdminEditor } from "@/components/admin/AdminEditor";
import { AdminFrame } from "@/components/admin/AdminFrame";
import { requireAdmin } from "@/lib/auth/session";
import { getPostById, listPostRevisionPage } from "@/lib/db/queries";

export const dynamic = "force-dynamic";

export default async function EditCustomPage({
  params
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAdmin();
  const { id } = await params;
  const page = getPostById(Number(id));
  if (!page || page.type !== "page") notFound();

  return (
    <AdminFrame
      title={page.title}
      subtitle={`独立页面 / ${page.status === "published" ? "已发布" : page.status === "draft" ? "草稿" : "回收站"}`}
      breadcrumbs={[
        { label: "概览", href: "/admin" },
        { label: "独立页面", href: "/admin/pages" },
        { label: page.title }
      ]}
      action={<Link className="btn" href="/admin/pages">返回页面列表</Link>}
    >
      <AdminEditor
        post={page}
        revisionPage={listPostRevisionPage(page.id)}
        backHref="/admin/pages"
        backLabel="返回页面列表"
      />
    </AdminFrame>
  );
}
