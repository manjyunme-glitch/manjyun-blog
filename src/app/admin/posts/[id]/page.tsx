import { notFound } from "next/navigation";
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

  return (
    <AdminFrame title={post.title} subtitle={`${typeLabels[post.type]} / ${statusLabels[post.status]}`}>
      <AdminEditor post={post} revisions={revisions} />
    </AdminFrame>
  );
}
