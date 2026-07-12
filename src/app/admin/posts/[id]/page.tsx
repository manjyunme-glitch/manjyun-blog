import { notFound } from "next/navigation";
import Link from "next/link";
import { AdminFrame } from "@/components/admin/AdminFrame";
import { AdminEditor } from "@/components/admin/AdminEditor";
import { requireAdmin } from "@/lib/auth/session";
import { getPostById, listPostRevisions } from "@/lib/db/queries";
import { CONTENT_TYPE_DEFINITIONS, type AdminContentType } from "@/lib/content/content-types";

export const dynamic = "force-dynamic";

const statusLabels = {
  published: "已发布",
  draft: "草稿",
  trashed: "回收站"
} as const;

function statusHref(status: keyof typeof statusLabels, type?: AdminContentType) {
  const params = new URLSearchParams();
  if (type) params.set("type", type);
  params.set("status", status);
  return `/admin/posts?${params.toString()}`;
}

export default async function EditPostPage({
  params
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAdmin();
  const { id } = await params;
  const post = getPostById(Number(id));
  if (!post) notFound();
  const revisions = listPostRevisions(post.id);
  const returnHref = statusHref(post.status, post.type === "page" ? undefined : post.type);
  const returnLabel = `返回${statusLabels[post.status]}列表`;

  return (
    <AdminFrame
      title={post.title}
      subtitle={`${CONTENT_TYPE_DEFINITIONS[post.type].label} / ${statusLabels[post.status]}`}
      breadcrumbs={[
        { label: "概览", href: "/admin" },
        { label: "内容", href: "/admin/posts" },
        { label: statusLabels[post.status], href: returnHref },
        { label: post.title }
      ]}
      activeNav={returnHref}
      action={
        <div className="btn-row">
          <Link className="btn" href={returnHref}>{returnLabel}</Link>
          <Link className="btn ghost" href="/admin/posts">全部内容</Link>
        </div>
      }
    >
      <AdminEditor post={post} revisions={revisions} backHref={returnHref} backLabel={returnLabel} />
    </AdminFrame>
  );
}
