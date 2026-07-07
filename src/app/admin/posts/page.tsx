import Link from "next/link";
import { AdminContentTable } from "@/components/admin/AdminContentTable";
import { AdminFrame } from "@/components/admin/AdminFrame";
import { requireAdmin } from "@/lib/auth/session";
import { contentStatusCounts, listPosts } from "@/lib/db/queries";
import type { PostStatus } from "@/types/blog";

export const dynamic = "force-dynamic";

type ContentFilter = "all" | PostStatus;

function normalizeFilter(value: string | undefined): ContentFilter {
  if (value === "published" || value === "draft" || value === "trashed") return value;
  if (value === "trash") return "trashed";
  return "all";
}

export default async function AdminPostsPage({
  searchParams
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  await requireAdmin();
  const params = await searchParams;
  const currentFilter = normalizeFilter(params.status);
  const posts = listPosts({
    status: currentFilter === "all" ? undefined : currentFilter,
    includeTrashed: currentFilter === "trashed"
  });
  const counts = contentStatusCounts();

  return (
    <AdminFrame
      title="文章"
      subtitle="完整内容工作台：筛选、状态、类型、更新时间和行级操作都在这里完成。"
      action={<Link className="btn primary" href="/admin/posts/new">新建文章</Link>}
    >
      <AdminContentTable posts={posts} counts={counts} currentFilter={currentFilter} />
    </AdminFrame>
  );
}
