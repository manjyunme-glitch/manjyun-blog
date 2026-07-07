"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { formatDate } from "@/lib/content/format";
import type { PostRecord, PostStatus } from "@/types/blog";

type ContentFilter = "all" | PostStatus;
type BulkAction = "publish" | "unpublish" | "trash" | "restore" | "delete";

type StatusCounts = {
  all: number;
  published: number;
  draft: number;
  trashed: number;
};

const filters: Array<{ id: ContentFilter; label: string; countKey: keyof StatusCounts }> = [
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

const typeLabels = {
  post: "文章",
  project: "项目",
  page: "页面"
} as const;

const normalBulkActions: Array<{ action: BulkAction; label: string; danger?: boolean }> = [
  { action: "publish", label: "发布" },
  { action: "unpublish", label: "取消发布" },
  { action: "trash", label: "移到回收站", danger: true }
];

const trashBulkActions: Array<{ action: BulkAction; label: string; danger?: boolean }> = [
  { action: "restore", label: "恢复" },
  { action: "delete", label: "永久删除", danger: true }
];

function filterHref(filter: ContentFilter) {
  return filter === "all" ? "/admin/posts" : `/admin/posts?status=${filter}`;
}

export function AdminContentTable({
  posts,
  counts,
  currentFilter
}: {
  posts: PostRecord[];
  counts: StatusCounts;
  currentFilter: ContentFilter;
}) {
  const router = useRouter();
  const [pendingId, setPendingId] = useState<number | null>(null);
  const [bulkPending, setBulkPending] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(() => new Set());
  const visibleIds = useMemo(() => posts.map((post) => post.id), [posts]);
  const visibleKey = visibleIds.join(",");
  const allVisibleSelected =
    visibleIds.length > 0 && visibleIds.every((id) => selectedIds.has(id));
  const bulkActions = currentFilter === "trashed" ? trashBulkActions : normalBulkActions;

  useEffect(() => {
    setSelectedIds(new Set());
  }, [currentFilter, visibleKey]);

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
          ? "确定取消发布？文章会回到草稿。"
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
      <div className="content-toolbar">
        <div className="segmented" aria-label="内容状态筛选">
          {filters.map((filter) => (
            <Link
              key={filter.id}
              className={`seg-btn ${currentFilter === filter.id ? "is-active" : ""}`}
              href={filterHref(filter.id)}
            >
              {filter.label}
              <span>{counts[filter.countKey]}</span>
            </Link>
          ))}
        </div>
        <span className="chip">显示 {posts.length} 项</span>
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
                  <span className="type-pill">{typeLabels[post.type]}</span>
                </td>
                <td>{formatDate(post.updatedAt)}</td>
                <td>
                  <code className="path-code">
                    /{post.type === "project" ? "projects" : "posts"}/{post.slug}
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
    </section>
  );
}
