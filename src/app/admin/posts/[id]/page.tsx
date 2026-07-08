import { notFound } from "next/navigation";
import Link from "next/link";
import { AdminFrame } from "@/components/admin/AdminFrame";
import { AdminEditor } from "@/components/admin/AdminEditor";
import { requireAdmin } from "@/lib/auth/session";
import { getPostById, listPostRevisions } from "@/lib/db/queries";

export const dynamic = "force-dynamic";

const typeLabels = {
  post: "文章",
  page: "页面",
  project: "项目"
} as const;

const statusLabels = {
  published: "已发布",
  draft: "草稿",
  trashed: "回收站"
} as const;

function statusHref(status: keyof typeof statusLabels) {
  return `/admin/posts?status=${status}`;
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
  const returnHref = statusHref(post.status);
  const returnLabel = `返回${statusLabels[post.status]}列表`;

  return (
    <AdminFrame
      title={post.title}
      subtitle={`${typeLabels[post.type]} / ${statusLabels[post.status]}`}
      breadcrumbs={[
        { label: "概览", href: "/admin" },
        { label: "文章", href: "/admin/posts" },
        { label: statusLabels[post.status], href: returnHref },
        { label: post.title }
      ]}
      activeNav={returnHref}
      action={
        <div className="btn-row">
          <Link className="btn" href={returnHref}>{returnLabel}</Link>
          <Link className="btn ghost" href="/admin/posts">全部文章</Link>
        </div>
      }
    >
      <AdminEditor post={post} revisions={revisions} backHref={returnHref} backLabel={returnLabel} />
    </AdminFrame>
  );
}
