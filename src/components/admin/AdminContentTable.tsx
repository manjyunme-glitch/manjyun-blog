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
import { AdminNotice, ConfirmDialog } from "@/components/admin/AdminFeedback";

type BulkAction = "publish" | "unpublish" | "trash" | "restore" | "delete";

type Confirmation = {
  title: string;
  description: string;
  confirmLabel: string;
  danger: boolean;
  run(): Promise<void>;
};

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
  const [message, setMessage] = useState("");
  const [messageKind, setMessageKind] = useState<"success" | "error">("success");
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
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

  async function executeAction(id: number, action: "publish" | "unpublish" | "trash" | "restore") {
    setMessage("");
    setPendingId(id);
    try {
      const response = await fetch(`/api/admin/posts/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action })
      });
      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as { error?: string } | null;
        setMessageKind("error");
        setMessage(data?.error ?? "操作失败");
        return;
      }
      setMessageKind("success");
      setMessage(action === "publish" ? "内容已发布。" : action === "restore" ? "内容已恢复为草稿。" : action === "trash" ? "内容已移到回收站。" : "内容已取消发布。");
      router.refresh();
    } finally {
      setPendingId(null);
    }
  }

  function runAction(id: number, title: string, action: "publish" | "unpublish" | "trash" | "restore") {
    if (action === "trash" || action === "unpublish") {
      setConfirmation({
        title: action === "trash" ? `把“${title}”移到回收站？` : `取消发布“${title}”？`,
        description: action === "trash" ? "公开页面会立即隐藏，之后仍可从回收站恢复。" : "公开页面会立即隐藏，内容将回到草稿状态。",
        confirmLabel: action === "trash" ? "移到回收站" : "取消发布",
        danger: action === "trash",
        run: () => executeAction(id, action)
      });
      return;
    }
    void executeAction(id, action);
  }

  async function executePermanentDelete(id: number) {
    setMessage("");
    setPendingId(id);
    try {
      const response = await fetch(`/api/admin/posts/${id}?permanent=1`, {
        method: "DELETE"
      });
      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as { error?: string } | null;
        setMessageKind("error");
        setMessage(data?.error ?? "删除失败");
        return;
      }
      setMessageKind("success");
      setMessage("内容已永久删除。");
      router.refresh();
    } finally {
      setPendingId(null);
    }
  }

  function deletePermanently(id: number, title: string) {
    setConfirmation({
      title: `永久删除“${title}”？`,
      description: "正文、标签关系和版本历史都会被永久删除，这个操作不能撤销。",
      confirmLabel: "永久删除",
      danger: true,
      run: () => executePermanentDelete(id)
    });
  }

  async function runBulkAction(action: BulkAction) {
    const ids = Array.from(selectedIds);
    if (!ids.length) return;
    if (["delete", "trash", "unpublish"].includes(action)) {
      setConfirmation({
        title: action === "delete" ? `永久删除 ${ids.length} 项内容？` : action === "trash" ? `把 ${ids.length} 项内容移到回收站？` : `取消发布 ${ids.length} 项内容？`,
        description: action === "delete" ? "所选内容及版本历史都会永久删除，无法撤销。" : "所选公开内容会立即隐藏。",
        confirmLabel: action === "delete" ? "永久删除" : action === "trash" ? "移到回收站" : "取消发布",
        danger: action === "delete" || action === "trash",
        run: () => executeBulkAction(action, ids)
      });
      return;
    }
    await executeBulkAction(action, ids);
  }

  async function executeBulkAction(action: BulkAction, ids: number[]) {
    setMessage("");
    setBulkPending(true);
    try {
      const response = await fetch("/api/admin/posts", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids, action })
      });
      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as { error?: string } | null;
        setMessageKind("error");
        setMessage(data?.error ?? "批量操作失败");
        return;
      }
      setSelectedIds(new Set());
      setMessageKind("success");
      setMessage(`已处理 ${ids.length} 项内容。`);
      router.refresh();
    } finally {
      setBulkPending(false);
    }
  }

  return (
    <section className="content-workbench">
      <AdminNotice message={message} kind={messageKind} />
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
                <td className="check-cell" data-label="选择">
                  <input
                    type="checkbox"
                    aria-label={`选择 ${post.title}`}
                    checked={selectedIds.has(post.id)}
                    disabled={bulkPending}
                    onChange={(event) => toggleSelected(post.id, event.currentTarget.checked)}
                  />
                </td>
                <td data-label="标题">
                  <Link className="content-title" href={`/admin/posts/${post.id}`}>
                    <strong>{post.title}</strong>
                    <span>{post.excerpt || "暂无摘要"}</span>
                  </Link>
                </td>
                <td data-label="状态">
                  <span className={`status-pill ${post.status}`}>{statusLabels[post.status]}</span>
                </td>
                <td data-label="类型">
                  <span className="type-pill">{CONTENT_TYPE_DEFINITIONS[post.type].label}</span>
                </td>
                <td data-label="标签">
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
                <td data-label="更新">{formatDate(post.updatedAt)}</td>
                <td data-label="路径">
                  <Link className="path-code" href={contentHref(post.type, post.slug)} target="_blank" rel="noreferrer">
                    {contentHref(post.type, post.slug)}
                  </Link>
                </td>
                <td data-label="操作">
                  <div className="row-actions">
                    {post.status !== "trashed" ? (
                      <Link className="row-action" href={`/admin/posts/${post.id}`}>
                        编辑
                      </Link>
                    ) : null}
                    {post.status === "published" ? (
                      <Link className="row-action" href={contentHref(post.type, post.slug)} target="_blank" rel="noreferrer">查看</Link>
                    ) : null}
                    {post.status === "published" ? (
                      <>
                        <button
                          className="row-action primary-action"
                          type="button"
                          disabled={pendingId === post.id}
                          onClick={() => runAction(post.id, post.title, "unpublish")}
                        >
                          取消发布
                        </button>
                        <button
                          className="row-action danger-action"
                          type="button"
                          disabled={pendingId === post.id}
                          onClick={() => runAction(post.id, post.title, "trash")}
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
                          onClick={() => runAction(post.id, post.title, "publish")}
                        >
                          发布
                        </button>
                        <button
                          className="row-action danger-action"
                          type="button"
                          disabled={pendingId === post.id}
                          onClick={() => runAction(post.id, post.title, "trash")}
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
                          onClick={() => runAction(post.id, post.title, "restore")}
                        >
                          恢复
                        </button>
                        <button
                          className="row-action danger-action"
                          type="button"
                          disabled={pendingId === post.id}
                          onClick={() => deletePermanently(post.id, post.title)}
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
      <ConfirmDialog
        open={Boolean(confirmation)}
        title={confirmation?.title ?? ""}
        description={confirmation?.description ?? ""}
        confirmLabel={confirmation?.confirmLabel ?? "确认"}
        danger={confirmation?.danger}
        pending={bulkPending || pendingId !== null}
        onCancel={() => setConfirmation(null)}
        onConfirm={() => {
          const request = confirmation;
          if (!request) return;
          void request.run().finally(() => setConfirmation(null));
        }}
      />
    </section>
  );
}
