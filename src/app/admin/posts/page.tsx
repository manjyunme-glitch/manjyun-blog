import Link from "next/link";
import { redirect } from "next/navigation";
import { AdminContentTable } from "@/components/admin/AdminContentTable";
import { AdminFrame } from "@/components/admin/AdminFrame";
import { requireAdmin } from "@/lib/auth/session";
import {
  contentStatusCounts,
  contentTypeCounts,
  listAdminPostSummaries
} from "@/lib/db/queries";
import {
  ADMIN_CONTENT_PAGE_SIZE,
  adminContentListHref,
  normalizeAdminContentPage,
  normalizeAdminContentQuery,
  normalizeAdminContentStatus,
  normalizeAdminContentType,
  type AdminContentStatusFilter,
  type AdminContentTypeFilter
} from "@/lib/admin/content-list";
import { CONTENT_TYPE_DEFINITIONS } from "@/lib/content/content-types";

export const dynamic = "force-dynamic";

const statusLabels: Record<AdminContentStatusFilter, string> = {
  all: "全部内容",
  published: "已发布",
  draft: "草稿",
  trashed: "回收站"
};

const statusNav: Record<AdminContentStatusFilter, string> = {
  all: "/admin/posts",
  published: "/admin/posts?status=published",
  draft: "/admin/posts?status=draft",
  trashed: "/admin/posts?status=trashed"
};

function filterTitle(type: AdminContentTypeFilter, status: AdminContentStatusFilter) {
  if (type === "all") return statusLabels[status];
  const typeLabel = CONTENT_TYPE_DEFINITIONS[type].label;
  return status === "all" ? `全部${typeLabel}` : `${typeLabel} · ${statusLabels[status]}`;
}

export default async function AdminPostsPage({
  searchParams
}: {
  searchParams: Promise<{ status?: string; type?: string; q?: string; page?: string }>;
}) {
  await requireAdmin();
  const params = await searchParams;
  const currentStatus = normalizeAdminContentStatus(params.status);
  const currentType = normalizeAdminContentType(params.type);
  const currentQuery = normalizeAdminContentQuery(params.q);
  const requestedPage = normalizeAdminContentPage(params.page);
  const result = listAdminPostSummaries({
    type: currentType === "all" ? undefined : currentType,
    status: currentStatus === "all" ? undefined : currentStatus,
    q: currentQuery,
    limit: ADMIN_CONTENT_PAGE_SIZE,
    offset: (requestedPage - 1) * ADMIN_CONTENT_PAGE_SIZE
  });
  const currentPage = Math.floor(result.offset / result.limit) + 1;
  const totalPages = Math.max(1, Math.ceil(result.total / result.limit));
  const canonicalHref = adminContentListHref({
    type: currentType,
    status: currentStatus,
    q: currentQuery,
    page: currentPage
  });
  const requestedHref = adminContentListHref({
    type: currentType,
    status: currentStatus,
    q: currentQuery,
    page: requestedPage
  });
  if (
    params.page &&
    (canonicalHref !== requestedHref ||
      params.page !== String(requestedPage) ||
      requestedPage === 1)
  ) {
    redirect(canonicalHref);
  }
  const statusCounts = contentStatusCounts(
    currentType === "all" ? undefined : currentType,
    currentQuery
  );
  const typeCounts = contentTypeCounts(
    currentStatus === "all" ? undefined : currentStatus,
    currentQuery
  );
  const title = filterTitle(currentType, currentStatus);

  return (
    <AdminFrame
      title={title}
      subtitle="完整内容工作台：筛选、状态、类型、更新时间和行级操作都在这里完成。"
      breadcrumbs={[
        { label: "概览", href: "/admin" },
        { label: "内容", href: "/admin/posts" },
        { label: title }
      ]}
      activeNav={statusNav[currentStatus]}
      action={<Link className="btn primary" href="/admin/posts/new">新建内容</Link>}
    >
      <AdminContentTable
        posts={result.posts}
        statusCounts={statusCounts}
        typeCounts={typeCounts}
        currentStatus={currentStatus}
        currentType={currentType}
        currentQuery={currentQuery}
        currentPage={currentPage}
        totalPages={totalPages}
        total={result.total}
      />
    </AdminFrame>
  );
}
