"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { formatDate } from "@/lib/content/format";
import {
  adminContentListHref,
  type AdminContentStatusFilter,
  type AdminContentTypeFilter
} from "@/lib/admin/content-list";
import {
  ADMIN_CONTENT_TYPE_DEFINITIONS,
  CONTENT_TYPE_DEFINITIONS,
  contentHref
} from "@/lib/content/content-types";
import type { PostStatus, PostSummary } from "@/types/blog";

type BulkAction = "publish" | "unpublish" | "trash" | "restore" | "delete";

type StatusCounts = {
  all: number;
  published: number;
  draft: number;
  trashed: number;
};

type TypeCounts = {
  all: number;
  post: number;
  project: number;
};

const statusFilters: Array<{ id: AdminContentStatusFilter; label: string; countKey: keyof StatusCounts }> = [
  { id: "all", label: "全部", countKey: "all" },
  { id: "published", label: "已发布", countKey: "published" },
  { id: "draft", label: "草稿", countKey: "draft" },
  { id: "trashed", label: "回收站", countKey: "trashed" }
];

const statusLabels: Record<PostStatus, string> = {
  published: "已发布",
  draft: "草稿",
  trashed: "回收站"
};

const normalBulkActions: Array<{ action: BulkAction; label: string; danger?: boolean }> = [
  { action: "publish", label: "发布" },
  { action: "unpublish", label: "取消发布" },
  { action: "trash", label: "移到回收站", danger: true }
];

const trashBulkActions: Array<{ action: BulkAction; label: string; danger?: boolean }> = [
  { action: "restore", label: "恢复" },
  { action: "delete", label: "永久删除", danger: true }
];

const typeFilters: Array<{ id: AdminContentTypeFilter; label: string; countKey: keyof TypeCounts }> = [
  { id: "all", label: "全部", countKey: "all" },
  ...ADMIN_CONTENT_TYPE_DEFINITIONS.map((definition) => ({
    id: definition.id,
    label: definition.label,
    countKey: definition.id
  }))
];

export function AdminContentTable({
  posts,
  statusCounts,
  typeCounts,
  currentStatus,
  currentType,
  currentQuery,
  currentPage,
  totalPages,
  total
}: {
  posts: PostSummary[];
  statusCounts: StatusCounts;
  typeCounts: TypeCounts;
  currentStatus: AdminContentStatusFilter;
  currentType: AdminContentTypeFilter;
  currentQuery: string;
  currentPage: number;
  totalPages: number;
  total: number;
}) {
  const router = useRouter();
  const [pendingId, setPendingId] = useState<number | null>(null);
  const [bulkPending, setBulkPending] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(() => new Set());
  const visibleIds = useMemo(() => posts.map((post) => post.id), [posts]);
  const visibleKey = visibleIds.join(",");
  const allVisibleSelected =
    visibleIds.length > 0 && visibleIds.every((id) => selectedIds.has(id));
  const bulkActions = currentStatus === "trashed" ? trashBulkActions : normalBulkActions;

  useEffect(() => {
    setSelectedIds(new Set());
  }, [currentPage, currentQuery, currentStatus, currentType, visibleKey]);

  function toggleSelected(id: number, checked: boolean) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (checked) {
        next.add(id);
      } else {
        next.delete(id);
      }
      return next;
    });
  }

  function toggleAll(checked: boolean) {
    setSelectedIds(checked ? new Set(visibleIds) : new Set());
  }

  async function runAction(id: number, action: "publish" | "unpublish" | "trash" | "restore") {
    const confirmMessage =
      action === "trash"
        ? "确定移到回收站？公开页面会立即隐藏。"
        : action === "unpublish"
          ? "确定取消发布？内容会回到草稿。"
          : "";
    if (confirmMessage && !window.confirm(confirmMessage)) return;

    setPendingId(id);
    try {
      const response = await fetch(`/api/admin/posts/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action })
      });
      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as { error?: string } | null;
        window.alert(data?.error ?? "操作失败");
        return;
      }
      router.refresh();
    } finally {
      setPendingId(null);
    }
  }

  async function deletePermanently(id: number) {
    if (!window.confirm("确定永久删除？这个操作不能撤销。")) return;
    setPendingId(id);
    try {
      const response = await fetch(`/api/admin/posts/${id}?permanent=1`, {
        method: "DELETE"
      });
      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as { error?: string } | null;
        window.alert(data?.error ?? "删除失败");
        return;
      }
      router.refresh();
    } finally {
      setPendingId(null);
    }
  }

  async function runBulkAction(action: BulkAction) {
    const ids = Array.from(selectedIds);
    if (!ids.length) return;
    const confirmMessage =
      action === "delete"
        ? `确定永久删除选中的 ${ids.length} 项？这个操作不能撤销。`
        : action === "trash"
          ? `确定把选中的 ${ids.length} 项移到回收站？公开页面会立即隐藏。`
          : action === "unpublish"
            ? `确定取消发布选中的 ${ids.length} 项？`
            : "";
    if (confirmMessage && !window.confirm(confirmMessage)) return;

    setBulkPending(true);
    try {
      const response = await fetch("/api/admin/posts", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids, action })
      });
      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as { error?: string } | null;
        window.alert(data?.error ?? "批量操作失败");
        return;
      }
      setSelectedIds(new Set());
      router.refresh();
    } finally {
      setBulkPending(false);
    }
  }

  return (
    <section className="content-workbench">
      <form className="content-toolbar" action="/admin/posts" method="get" role="search">
        {currentType !== "all" ? <input type="hidden" name="type" value={currentType} /> : null}
        {currentStatus !== "all" ? <input type="hidden" name="status" value={currentStatus} /> : null}
        <input
          key={currentQuery}
          className="input"
          type="search"
          name="q"
          defaultValue={currentQuery}
          aria-label="搜索内容"
          placeholder="搜索标题、Slug、摘要、正文或标签"
        />
        <div className="btn-row">
          <button className="btn primary" type="submit">搜索</button>
          {currentQuery ? (
            <Link
              className="btn ghost"
              href={adminContentListHref({ type: currentType, status: currentStatus })}
            >
              清空
            </Link>
          ) : null}
        </div>
      </form>
      <div className="content-toolbar">
        <div className="segmented" aria-label="内容状态筛选">
          {statusFilters.map((filter) => (
            <Link
              key={filter.id}
              className={`seg-btn ${currentStatus === filter.id ? "is-active" : ""}`}
              href={adminContentListHref({
                type: currentType,
                status: filter.id,
                q: currentQuery
              })}
            >
              {filter.label}
              <span>{statusCounts[filter.countKey]}</span>
            </Link>
          ))}
        </div>
        <div className="segmented" aria-label="内容类型筛选">
          {typeFilters.map((filter) => (
            <Link
              key={filter.id}
              className={`seg-btn ${currentType === filter.id ? "is-active" : ""}`}
              href={adminContentListHref({
                type: filter.id,
                status: currentStatus,
                q: currentQuery
              })}
            >
              {filter.label}
              <span>{typeCounts[filter.countKey]}</span>
            </Link>
          ))}
        </div>
        <span className="chip">本页 {posts.length} 项 / 共 {total} 项</span>
      </div>

      <div className={`bulk-bar ${selectedIds.size ? "" : "is-empty"}`}>
        <span>{selectedIds.size ? `已选择 ${selectedIds.size} 项` : "选择条目后可批量处理"}</span>
        <div className="bulk-actions">
          {bulkActions.map((item) => (
            <button
              key={item.action}
              className={`row-action ${item.danger ? "danger-action" : "primary-action"}`}
              type="button"
              disabled={!selectedIds.size || bulkPending}
              onClick={() => void runBulkAction(item.action)}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      <div className="content-table-wrap">
        <table className="content-table">
          <thead>
            <tr>
              <th className="check-cell">
                <input
                  type="checkbox"
                  aria-label="选择当前列表"
                  checked={allVisibleSelected}
                  disabled={!posts.length || bulkPending}
                  onChange={(event) => toggleAll(event.currentTarget.checked)}
                />
              </th>
              <th>标题</th>
              <th>状态</th>
              <th>类型</th>
              <th>标签</th>
              <th>更新</th>
              <th>路径</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {posts.map((post) => (
              <tr key={post.id} className={selectedIds.has(post.id) ? "is-selected" : ""}>
                <td className="check-cell">
                  <input
                    type="checkbox"
                    aria-label={`选择 ${post.title}`}
                    checked={selectedIds.has(post.id)}
                    disabled={bulkPending}
                    onChange={(event) => toggleSelected(post.id, event.currentTarget.checked)}
                  />
                </td>
                <td>
                  <Link className="content-title" href={`/admin/posts/${post.id}`}>
                    <strong>{post.title}</strong>
                    <span>{post.excerpt || "暂无摘要"}</span>
                  </Link>
                </td>
                <td>
                  <span className={`status-pill ${post.status}`}>{statusLabels[post.status]}</span>
                </td>
                <td>
                  <span className="type-pill">{CONTENT_TYPE_DEFINITIONS[post.type].label}</span>
                </td>
                <td>
                  {post.tags?.length ? (
                    <div className="content-tags">
                      {post.tags.map((tag) => (
                        <Link key={tag.id} href={`/tag/${tag.slug}`} target="_blank" rel="noreferrer">
                          {tag.name}
                        </Link>
                      ))}
                    </div>
                  ) : (
                    <span className="muted-cell">-</span>
                  )}
                </td>
                <td>{formatDate(post.updatedAt)}</td>
                <td>
                  <code className="path-code">
                    {contentHref(post.type, post.slug)}
                  </code>
                </td>
                <td>
                  <div className="row-actions">
                    {post.status !== "trashed" ? (
                      <Link className="row-action" href={`/admin/posts/${post.id}`}>
                        编辑
                      </Link>
                    ) : null}
                    {post.status === "published" ? (
                      <>
                        <button
                          className="row-action primary-action"
                          type="button"
                          disabled={pendingId === post.id}
                          onClick={() => void runAction(post.id, "unpublish")}
                        >
                          取消发布
                        </button>
                        <button
                          className="row-action danger-action"
                          type="button"
                          disabled={pendingId === post.id}
                          onClick={() => void runAction(post.id, "trash")}
                        >
                          移到回收站
                        </button>
                      </>
                    ) : null}
                    {post.status === "draft" ? (
                      <>
                        <button
                          className="row-action primary-action"
                          type="button"
                          disabled={pendingId === post.id}
                          onClick={() => void runAction(post.id, "publish")}
                        >
                          发布
                        </button>
                        <button
                          className="row-action danger-action"
                          type="button"
                          disabled={pendingId === post.id}
                          onClick={() => void runAction(post.id, "trash")}
                        >
                          移到回收站
                        </button>
                      </>
                    ) : null}
                    {post.status === "trashed" ? (
                      <>
                        <button
                          className="row-action primary-action"
                          type="button"
                          disabled={pendingId === post.id}
                          onClick={() => void runAction(post.id, "restore")}
                        >
                          恢复
                        </button>
                        <button
                          className="row-action danger-action"
                          type="button"
                          disabled={pendingId === post.id}
                          onClick={() => void deletePermanently(post.id)}
                        >
                          永久删除
                        </button>
                      </>
                    ) : null}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!posts.length ? <p className="empty-state">当前筛选下没有内容。</p> : null}
      </div>
      <nav className="content-toolbar" aria-label="内容分页">
        {currentPage > 1 ? (
          <Link
            className="btn"
            href={adminContentListHref({
              type: currentType,
              status: currentStatus,
              q: currentQuery,
              page: currentPage - 1
            })}
          >
            上一页
          </Link>
        ) : (
          <span className="btn ghost" aria-disabled="true">上一页</span>
        )}
        <span className="chip">第 {currentPage} / {totalPages} 页</span>
        {currentPage < totalPages ? (
          <Link
            className="btn"
            href={adminContentListHref({
              type: currentType,
              status: currentStatus,
              q: currentQuery,
              page: currentPage + 1
            })}
          >
            下一页
          </Link>
        ) : (
          <span className="btn ghost" aria-disabled="true">下一页</span>
        )}
      </nav>
    </section>
  );
}
