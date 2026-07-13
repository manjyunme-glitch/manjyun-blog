"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { formatDate, formatDateTime } from "@/lib/content/format";
import {
  CONTENT_TYPE_DEFINITIONS,
  getContentTypeDefinition
} from "@/lib/content/content-types";
import { COMMON_POST_TAGS, hasTag, toggleTag } from "@/lib/admin/tags";
import {
  classifyEditorDraft,
  clearEditorDraft,
  createEditorDraftSnapshot,
  editorDraftStorageKey,
  readEditorDraft,
  writeEditorDraft,
  type DraftRecoveryKind,
  type EditorDraftSnapshot
} from "@/lib/admin/editor-draft";
import type { PostRevision, PostStatus, PostType, PostWithTags } from "@/types/blog";
import { ConfirmDialog } from "@/components/admin/AdminFeedback";

type RevisionFilter = "all" | Extract<PostStatus, "published" | "draft">;
type EditorViewMode = "write" | "split" | "preview";

type Draft = {
  id?: number;
  type: PostType;
  title: string;
  slug: string;
  excerpt: string;
  cover: string;
  markdown: string;
  status: PostStatus;
  tags: string;
  seoTitle: string;
  seoDescription: string;
};

const emptyRevisions: PostRevision[] = [];

const revisionFilters: Array<{ id: RevisionFilter; label: string }> = [
  { id: "all", label: "全部" },
  { id: "published", label: "已发布" },
  { id: "draft", label: "草稿" }
];

const starterMarkdown = `标题字段会作为公开页面唯一的一级标题；正文从段落或二级标题开始即可。

## 小标题

::callout 备注
这里是一段自定义 callout。
::
`;

function draftFromPost(post: PostWithTags | null): Draft {
  return {
    id: post?.id,
    type: post?.type ?? "post",
    title: post?.title ?? "",
    slug: post?.slug ?? "",
    excerpt: post?.excerpt ?? "",
    cover: post?.cover ?? "",
    markdown: post?.markdown ?? starterMarkdown,
    status: post?.status ?? "draft",
    tags: post?.tags.map((tag) => tag.name).join(", ") ?? "",
    seoTitle: post?.seoTitle ?? "",
    seoDescription: post?.seoDescription ?? ""
  };
}

export function AdminEditor({
  post,
  revisions = emptyRevisions,
  backHref = "/admin/posts",
  backLabel = "返回内容列表"
}: {
  post: PostWithTags | null;
  revisions?: PostRevision[];
  backHref?: string;
  backLabel?: string;
}) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const pendingRef = useRef(false);
  const dirtyRef = useRef(false);
  const serverDraftRef = useRef<Draft>(draftFromPost(post));
  const confirmResolverRef = useRef<((confirmed: boolean) => void) | null>(null);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [preview, setPreview] = useState("");
  const [previewState, setPreviewState] = useState<"loading" | "ready" | "error">("loading");
  const [helpOpen, setHelpOpen] = useState(false);
  const [revisionOpen, setRevisionOpen] = useState(false);
  const [draft, setDraft] = useState<Draft>(() => draftFromPost(post));
  const [isDirty, setIsDirty] = useState(false);
  const [viewMode, setViewMode] = useState<EditorViewMode>("split");
  const [recovery, setRecovery] = useState<{
    kind: Exclude<DraftRecoveryKind, "none">;
    snapshot: EditorDraftSnapshot<Draft>;
  } | null>(null);
  const [confirmation, setConfirmation] = useState<{
    title: string;
    description: string;
    confirmLabel: string;
    danger: boolean;
  } | null>(null);
  const [revisionItems, setRevisionItems] = useState<PostRevision[]>(revisions);
  const [revisionFilter, setRevisionFilter] = useState<RevisionFilter>("all");
  const [selectedRevisionId, setSelectedRevisionId] = useState<number | null>(
    revisions[0]?.id ?? null
  );

  const endpoint = useMemo(
    () => (draft.id ? `/api/admin/posts/${draft.id}` : "/api/admin/posts"),
    [draft.id]
  );

  useEffect(() => {
    const controller = new AbortController();
    setPreviewState("loading");
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch("/api/admin/preview", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ markdown: draft.markdown }),
          signal: controller.signal
        });
        if (!response.ok) {
          setPreviewState("error");
          return;
        }
        const data = (await response.json()) as { html: string };
        setPreview(data.html);
        setPreviewState("ready");
      } catch (error) {
        if ((error as Error).name !== "AbortError") setPreviewState("error");
      }
    }, 220);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [draft.markdown]);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem("manjyun:admin-editor:view-mode");
      if (stored === "write" || stored === "split" || stored === "preview") {
        setViewMode(stored);
        return;
      }
    } catch {
      // Local preferences and recovery are optional enhancements.
    }
    if (window.matchMedia("(max-width: 860px)").matches) {
      setViewMode("write");
    }
  }, []);

  useEffect(() => {
    const snapshot = readEditorDraft<Draft>(
      window.localStorage,
      editorDraftStorageKey(post?.id)
    );
    const kind = classifyEditorDraft(
      snapshot,
      serverDraftRef.current,
      post?.updatedAt ?? null
    );
    if (snapshot && kind !== "none") setRecovery({ kind, snapshot });
  }, [post?.id, post?.updatedAt]);

  useEffect(() => {
    if (!isDirty) return;
    const timer = window.setTimeout(() => {
      writeEditorDraft(
        window.localStorage,
        editorDraftStorageKey(draft.id ?? post?.id),
        createEditorDraftSnapshot({
          draft,
          postId: draft.id ?? post?.id ?? null,
          sourceUpdatedAt: post?.updatedAt ?? null
        })
      );
    }, 600);
    return () => window.clearTimeout(timer);
  }, [draft, isDirty, post?.id, post?.updatedAt]);

  useEffect(() => {
    setRevisionItems(revisions);
    setSelectedRevisionId((current) => {
      if (current && revisions.some((revision) => revision.id === current)) {
        return current;
      }
      return revisions[0]?.id ?? null;
    });
  }, [revisions]);

  useEffect(() => {
    if (!isDirty) return;
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!dirtyRef.current) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warnBeforeUnload);
    return () => window.removeEventListener("beforeunload", warnBeforeUnload);
  }, [isDirty]);

  const revisionCounts = useMemo(
    () => ({
      all: revisionItems.length,
      published: revisionItems.filter((revision) => revision.status === "published").length,
      draft: revisionItems.filter((revision) => revision.status === "draft").length
    }),
    [revisionItems]
  );

  const visibleRevisions = useMemo(
    () =>
      revisionFilter === "all"
        ? revisionItems
        : revisionItems.filter((revision) => revision.status === revisionFilter),
    [revisionFilter, revisionItems]
  );

  const selectedRevision = useMemo(
    () => visibleRevisions.find((revision) => revision.id === selectedRevisionId) ?? null,
    [selectedRevisionId, visibleRevisions]
  );

  useEffect(() => {
    setSelectedRevisionId((current) => {
      if (current && visibleRevisions.some((revision) => revision.id === current)) {
        return current;
      }
      return visibleRevisions[0]?.id ?? null;
    });
  }, [visibleRevisions]);

  function update<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
    dirtyRef.current = true;
    setIsDirty(true);
  }

  function requestConfirmation(input: {
    title: string;
    description: string;
    confirmLabel: string;
    danger?: boolean;
  }) {
    return new Promise<boolean>((resolve) => {
      confirmResolverRef.current = resolve;
      setConfirmation({ ...input, danger: Boolean(input.danger) });
    });
  }

  function finishConfirmation(confirmed: boolean) {
    confirmResolverRef.current?.(confirmed);
    confirmResolverRef.current = null;
    setConfirmation(null);
  }

  function confirmLeaveAndNavigate() {
    if (!dirtyRef.current) {
      router.push(backHref);
      return;
    }
    void requestConfirmation({
      title: "放弃未保存的修改？",
      description: "当前修改已保存在浏览器本地，离开后可回来恢复，但尚未写入服务器。",
      confirmLabel: "离开编辑器",
      danger: true
    }).then((confirmed) => {
      if (confirmed) router.push(backHref);
    });
  }

  function changeViewMode(mode: EditorViewMode) {
    setViewMode(mode);
    try {
      window.localStorage.setItem("manjyun:admin-editor:view-mode", mode);
    } catch {
      // View preference is optional.
    }
  }

  function recoverLocalDraft() {
    if (!recovery) return;
    setDraft(recovery.snapshot.draft);
    dirtyRef.current = true;
    setIsDirty(true);
    setMessage(
      recovery.kind === "stale"
        ? "已载入基于旧服务器版本的本地草稿，请检查后再保存。"
        : "已恢复本地草稿。"
    );
    setRecovery(null);
  }

  function discardLocalDraft() {
    clearEditorDraft(
      window.localStorage,
      editorDraftStorageKey(draft.id ?? post?.id)
    );
    setRecovery(null);
  }

  async function runPending(fallbackMessage: string, task: () => Promise<void>) {
    if (pendingRef.current) return;

    pendingRef.current = true;
    setPending(true);
    try {
      await task();
    } catch (issue) {
      setMessage(issue instanceof Error ? issue.message : fallbackMessage);
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  }

  async function save(status: PostStatus, successMessage?: string) {
    setMessage("");
    const wasNew = !draft.id;
    const targetEndpoint = endpoint;
    const payload = { ...draft, status };

    await runPending("保存失败", async () => {
      const response = await fetch(targetEndpoint, {
        method: payload.id ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const data = (await response.json().catch(() => null)) as
        | { ok: true; id: number; slug: string }
        | { ok: false; error: string }
        | null;
      if (!response.ok || !data?.ok) {
        setMessage(data && !data.ok ? data.error : "保存失败");
        return;
      }
      setDraft((current) => ({ ...current, id: data.id, slug: data.slug || current.slug, status }));
      dirtyRef.current = false;
      setIsDirty(false);
      clearEditorDraft(window.localStorage, editorDraftStorageKey(draft.id ?? post?.id));
      if (wasNew) clearEditorDraft(window.localStorage, editorDraftStorageKey(null));
      setMessage(successMessage ?? (status === "published" ? "已发布" : "已保存草稿"));
      if (wasNew) {
        window.location.assign(`/admin/posts/${data.id}`);
      } else {
        router.refresh();
      }
    });
  }

  async function deletePost() {
    if (!draft.id) return;
    const confirmed = await requestConfirmation({
      title: `永久删除“${draft.title}”？`,
      description: "正文、标签关系和版本历史都会被永久删除，这个操作不能撤销。",
      confirmLabel: "永久删除",
      danger: true
    });
    if (!confirmed) return;
    await runPending("删除失败", async () => {
      const response = await fetch(`${endpoint}?permanent=1`, { method: "DELETE" });
      if (!response.ok) {
        setMessage("删除失败");
        return;
      }
      dirtyRef.current = false;
      setIsDirty(false);
      clearEditorDraft(window.localStorage, editorDraftStorageKey(draft.id));
      router.push("/admin/posts?status=trashed");
    });
  }

  async function patchStatus(action: "trash" | "restore") {
    if (!draft.id) return;
    if (action === "trash") {
      const confirmed = await requestConfirmation({
        title: `把“${draft.title}”移到回收站？`,
        description: dirtyRef.current
          ? "公开页面会立即隐藏；未保存修改只保留在浏览器本地，不会写入服务器。"
          : "公开页面会立即隐藏，之后仍可从回收站恢复。",
        confirmLabel: "移到回收站",
        danger: true
      });
      if (!confirmed) return;
    }

    setMessage("");
    await runPending("操作失败", async () => {
      const response = await fetch(endpoint, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action })
      });
      const data = (await response.json().catch(() => null)) as
        | { ok: true; status: PostStatus }
        | { ok: false; error: string }
        | null;
      if (!response.ok || !data?.ok) {
        setMessage(data && !data.ok ? data.error : "操作失败");
        return;
      }

      setDraft((current) => ({ ...current, status: data.status }));
      dirtyRef.current = false;
      setIsDirty(false);
      setMessage(action === "trash" ? "已移到回收站" : "已恢复为草稿");
      if (action === "trash") {
        router.push("/admin/posts?status=trashed");
      } else {
        router.refresh();
      }
    });
  }

  async function restoreRevision(revisionId: number) {
    if (!draft.id) return;
    const targetRevision = revisionItems.find((revision) => revision.id === revisionId);
    if (!targetRevision) return;
    const confirmed = await requestConfirmation({
      title: `回退到${statusText(targetRevision.status, false)}版本？`,
      description: `${dirtyRef.current ? "当前未保存修改会被覆盖；" : ""}正文、元数据和标签将恢复到所选版本${targetRevision.status !== draft.status ? `，内容状态也会变为“${statusText(targetRevision.status, false)}”` : ""}。`,
      confirmLabel: "回退版本",
      danger: dirtyRef.current || targetRevision.status !== draft.status
    });
    if (!confirmed) return;

    setMessage("");
    await runPending("回退失败", async () => {
      const response = await fetch(`${endpoint}/revisions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ revisionId })
      });
      const data = (await response.json().catch(() => null)) as
        | {
            ok: true;
            post: PostWithTags;
            revisions: PostRevision[];
          }
        | { ok: false; error: string }
        | null;
      if (!response.ok || !data?.ok) {
        setMessage(data && !data.ok ? data.error : "回退失败");
        return;
      }

      setDraft(draftFromPost(data.post));
      dirtyRef.current = false;
      setIsDirty(false);
      setRevisionItems(data.revisions);
      setSelectedRevisionId(data.revisions[0]?.id ?? null);
      setMessage(`已回退为${statusText(data.post.status, false)}`);
      router.refresh();
    });
  }

  async function upload(file: File) {
    const formData = new FormData();
    formData.append("file", file);
    const response = await fetch("/api/admin/media", {
      method: "POST",
      body: formData
    });
    const data = (await response.json()) as
      | { ok: true; media: { url: string; mime: string; originalName: string } }
      | { ok: false; error: string };
    if (!response.ok || !data.ok) {
      setMessage(data.ok ? "上传失败" : data.error);
      return;
    }
    const url = data.media.url;
    if (data.media.mime.startsWith("image/")) {
      update("cover", draft.cover || url);
      update("markdown", `${draft.markdown}\n\n![${data.media.originalName}](${url})\n`);
    } else if (data.media.mime.startsWith("audio/")) {
      update(
        "markdown",
        `${draft.markdown}\n\n[audio:${data.media.originalName}](${url})\n`
      );
    } else {
      update("markdown", `${draft.markdown}\n\n[${data.media.originalName}](${url})\n`);
    }
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "s") return;
      event.preventDefault();
      if (pendingRef.current || draft.status === "trashed") return;
      void save(draft.id ? draft.status : "draft");
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  return (
    <div className={`editor-layout editor-view-${viewMode}`}>
      <div className="editor-main">
        {recovery ? (
          <section className={`admin-notice ${recovery.kind === "stale" ? "error" : "info"}`} role="status">
            <strong>{recovery.kind === "stale" ? "检测到基于旧服务器版本的本地草稿" : "检测到未提交的本地草稿"}</strong>
            <span>{recovery.kind === "stale" ? "服务器内容已发生变化，恢复后请逐项检查。" : "可以恢复上次未保存的编辑。"}</span>
            <div className="btn-row">
              <button className="btn primary" type="button" onClick={recoverLocalDraft}>恢复草稿</button>
              <button className="btn ghost" type="button" onClick={discardLocalDraft}>放弃本地副本</button>
            </div>
          </section>
        ) : null}
        <div className="editor-toolbar">
          <div className="editor-statusbar">
            <span className={`status-pill ${draft.status}`}>{statusText(draft.status, !draft.id)}</span>
            <span className="type-pill">{typeText(draft.type)}</span>
            <span className={`chip ${isDirty ? "is-dirty" : ""}`}>{isDirty ? "有未保存修改" : "已保存"}</span>
            {post ? (
              <div className="editor-dates" aria-label="内容时间">
                <span>
                  <b>创建</b>
                  {formatDate(post.createdAt)}
                </span>
                <span>
                  <b>首发</b>
                  {post.publishedAt ? formatDate(post.publishedAt) : "未发布"}
                </span>
                <span>
                  <b>更新</b>
                  {formatDate(post.updatedAt)}
                </span>
              </div>
            ) : (
              <span className="chip">新建</span>
            )}
          </div>
          <div className="btn-row">
            <div className="segmented editor-view-switch" aria-label="编辑器视图">
              {(["write", "split", "preview"] as const).map((mode) => (
                <button
                  key={mode}
                  className={`seg-btn ${viewMode === mode ? "is-active" : ""}`}
                  type="button"
                  aria-pressed={viewMode === mode}
                  onClick={() => changeViewMode(mode)}
                >
                  {mode === "write" ? "写作" : mode === "split" ? "分栏" : "预览"}
                </button>
              ))}
            </div>
            <Link
              className="btn ghost"
              href={backHref}
              onClick={(event) => {
                event.preventDefault();
                confirmLeaveAndNavigate();
              }}
            >
              {backLabel}
            </Link>
            {draft.status === "trashed" ? (
              <>
                <button className="btn primary" type="button" disabled={pending} onClick={() => void patchStatus("restore")}>
                  恢复为草稿
                </button>
                <button className="btn danger" type="button" disabled={pending} onClick={deletePost}>
                  永久删除
                </button>
              </>
            ) : draft.status === "published" ? (
              <>
                <button className="btn" type="button" disabled={pending} onClick={() => void save("published", "已保存更改")}>
                  保存更改
                </button>
                <button className="btn primary" type="button" disabled={pending} onClick={() => void save("draft", "已取消发布")}>
                  取消发布
                </button>
                <button className="btn danger" type="button" disabled={pending || !draft.id} onClick={() => void patchStatus("trash")}>
                  移到回收站
                </button>
              </>
            ) : (
              <>
                <button className="btn" type="button" disabled={pending} onClick={() => void save("draft")}>
                  保存草稿
                </button>
                <button className="btn primary" type="button" disabled={pending} onClick={() => void save("published")}>
                  发布
                </button>
                {draft.id ? (
                  <button className="btn danger" type="button" disabled={pending} onClick={() => void patchStatus("trash")}>
                    移到回收站
                  </button>
                ) : null}
              </>
            )}
            <button className="btn ghost" type="button" onClick={() => setHelpOpen((open) => !open)}>
              写作帮助
            </button>
          </div>
          <span
            className={message.includes("失败") ? "error-text" : "success-text"}
            aria-live="polite"
          >
            {pending ? "保存中..." : message || (isDirty ? "有未保存的修改" : "")}
          </span>
        </div>

        {helpOpen ? <WritingHelp /> : null}

        <div className="editor-title-field">
          <label htmlFor="editor-title">标题</label>
          <input
            id="editor-title"
            className="editor-title-input"
            value={draft.title}
            disabled={draft.status === "trashed"}
            onChange={(event) => update("title", event.target.value)}
            placeholder="输入内容标题"
          />
        </div>

        <div className="editor-workspace">
        <div className="editor-panel editor-write-panel">
          <div className="editor-panel-head">
            <span>Markdown</span>
            <span>{draft.markdown.length} chars</span>
          </div>
          <textarea
            className="markdown-editor input"
            value={draft.markdown}
            onChange={(event) => update("markdown", event.target.value)}
            disabled={draft.status === "trashed"}
            spellCheck={false}
          />
        </div>

        <div className="editor-panel editor-preview-panel">
          <div className="editor-panel-head">
            <span>Live Preview</span>
            <span className={`chip preview-${previewState}`}>
              {previewState === "loading" ? "渲染中" : previewState === "error" ? "渲染失败" : "已消毒 HTML"}
            </span>
          </div>
          {previewState === "error" ? (
            <p className="empty-state">预览暂时无法生成，正文不会丢失。</p>
          ) : (
            <div className="preview-pane gh-content" dangerouslySetInnerHTML={{ __html: preview }} />
          )}
        </div>
        </div>
      </div>

      <aside className="editor-side">
        {draft.id ? (
          <section className={`settings-card revision-card ${revisionOpen ? "is-open" : "is-collapsed"}`}>
            <div className="settings-section-head revision-head">
              <div>
                <h2>版本历史</h2>
              </div>
              <button
                className="revision-toggle"
                type="button"
                aria-expanded={revisionOpen}
                aria-controls="revision-history-content"
                onClick={() => setRevisionOpen((open) => !open)}
              >
                <span className="chip">{revisionItems.length}</span>
                <span>{revisionOpen ? "收起" : "展开"}</span>
                <svg viewBox="0 0 16 16" aria-hidden="true">
                  <path d="m4 6 4 4 4-4" />
                </svg>
              </button>
            </div>
            <div
              id="revision-history-content"
              className="revision-collapse"
              aria-hidden={!revisionOpen}
            >
              <div className="revision-collapse-inner">
                {revisionItems.length ? (
                  <>
                    <div className="revision-tabs" role="tablist" aria-label="版本状态筛选">
                      {revisionFilters.map((filter) => (
                        <button
                          key={filter.id}
                          className={`seg-btn ${revisionFilter === filter.id ? "is-active" : ""}`}
                          type="button"
                          role="tab"
                          aria-selected={revisionFilter === filter.id}
                          onClick={() => setRevisionFilter(filter.id)}
                        >
                          {filter.label}
                          <span>{revisionCounts[filter.id]}</span>
                        </button>
                      ))}
                    </div>
                    <div className="revision-list">
                      {visibleRevisions.map((revision, index) => (
                        <button
                          key={revision.id}
                          className={`revision-item ${selectedRevisionId === revision.id ? "is-active" : ""}`}
                          type="button"
                          aria-pressed={selectedRevisionId === revision.id}
                          onClick={() => setSelectedRevisionId(revision.id)}
                        >
                          <span>
                            <strong>{revisionVersionLabel(revision, index, visibleRevisions.length)}</strong>
                            <small>{formatRevisionTime(revision.createdAt)}</small>
                          </span>
                          <span className={`status-pill ${revision.status}`}>
                            {statusText(revision.status, false)}
                          </span>
                        </button>
                      ))}
                    </div>
                    {selectedRevision ? (
                      <div className="revision-preview">
                        <div className="revision-preview-head">
                          <strong>{selectedRevision.title}</strong>
                          <small>
                            {revisionReasonText(selectedRevision.reason)} · {formatRevisionTime(selectedRevision.createdAt)}
                          </small>
                          <code>{selectedRevision.slug}</code>
                        </div>
                        <pre>{selectedRevision.markdown.slice(0, 680) || "空内容"}</pre>
                        <button
                          className="btn primary"
                          type="button"
                          disabled={pending}
                          onClick={() => void restoreRevision(selectedRevision.id)}
                        >
                          回退为{statusText(selectedRevision.status, false)}版本
                        </button>
                      </div>
                    ) : visibleRevisions.length ? null : (
                      <p className="empty-state">这个状态下暂无历史版本。</p>
                    )}
                  </>
                ) : (
                  <p className="empty-state">暂无历史版本。</p>
                )}
              </div>
            </div>
          </section>
        ) : null}

        <section className="settings-card form-grid">
          <div className="field">
            <label>Slug</label>
            <input className="input" value={draft.slug} disabled={draft.status === "trashed"} onChange={(event) => update("slug", event.target.value)} placeholder={`留空自动生成 ${getContentTypeDefinition(draft.type).slugPrefix}-001`} />
          </div>
          <div className="field">
            <label>类型</label>
            <select className="select" value={draft.type} disabled={draft.status === "trashed" || draft.type === "page"} onChange={(event) => update("type", event.target.value as PostType)}>
              {draft.type === "page" ? (
                <option value="page">页面（系统）</option>
              ) : (
                <>
                  <option value="post">随笔</option>
                  <option value="project">项目</option>
                </>
              )}
            </select>
            <p className="field-hint">
              {draft.type === "page"
                ? "这是兼容旧数据的隐藏系统类型；可以编辑内容，但不能改成其他类型。"
                : "系统页面不在常规内容列表与新建选项中显示。"}
            </p>
          </div>
          <div className="field tag-picker-field">
            <label htmlFor="post-tags">标签</label>
            <input
              id="post-tags"
              className="input"
              value={draft.tags}
              disabled={draft.status === "trashed"}
              aria-describedby="post-tags-hint"
              placeholder="输入标签，用逗号分隔"
              onChange={(event) => update("tags", event.target.value)}
            />
            <div className="tag-suggestions" role="group" aria-label="常用标签快捷选择">
              {COMMON_POST_TAGS.map((tag) => {
                const selected = hasTag(draft.tags, tag);
                return (
                  <button
                    key={tag}
                    className={`tag-suggestion ${selected ? "is-selected" : ""}`}
                    type="button"
                    aria-pressed={selected}
                    aria-label={`${selected ? "移除" : "添加"}标签“${tag}”`}
                    disabled={draft.status === "trashed"}
                    onClick={() => update("tags", toggleTag(draft.tags, tag))}
                  >
                    {tag}
                  </button>
                );
              })}
            </div>
            <p id="post-tags-hint" className="field-hint">
              点选常用标签可添加或移除；也可以手工输入，用中文或英文逗号分隔。
            </p>
          </div>
          <div className="field">
            <label>摘要</label>
            <textarea className="textarea" value={draft.excerpt} disabled={draft.status === "trashed"} onChange={(event) => update("excerpt", event.target.value)} />
          </div>
          <div className="field">
            <label>封面 URL</label>
            <input className="input" value={draft.cover} disabled={draft.status === "trashed"} onChange={(event) => update("cover", event.target.value)} />
          </div>
        </section>

        <section className="settings-card form-grid">
          <div className="field">
            <label>上传图片/音频/文件</label>
            <input
              ref={fileInputRef}
              className="visually-hidden"
              type="file"
              accept="image/jpeg,image/png,image/gif,image/webp,image/avif,image/x-icon,audio/mpeg,audio/wav,audio/ogg,audio/flac,audio/mp4,application/pdf"
              disabled={draft.status === "trashed"}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void upload(file);
                event.currentTarget.value = "";
              }}
            />
            <button className="upload-control" type="button" disabled={draft.status === "trashed"} onClick={() => fileInputRef.current?.click()}>
              <span>选择媒体文件</span>
              <small>图片插入 Markdown，音频插入 audio 卡片；支持 PDF</small>
            </button>
          </div>
          <p className="admin-subtitle">
            图片会插入 Markdown；音频会插入 <code>[audio:title](url)</code> 卡片语法。
          </p>
        </section>

        <section className="settings-card form-grid">
          <div className="field">
            <label>SEO 标题</label>
            <input className="input" value={draft.seoTitle} disabled={draft.status === "trashed"} onChange={(event) => update("seoTitle", event.target.value)} />
          </div>
          <div className="field">
            <label>SEO 描述</label>
            <textarea className="textarea" value={draft.seoDescription} disabled={draft.status === "trashed"} onChange={(event) => update("seoDescription", event.target.value)} />
          </div>
        </section>
      </aside>
      <ConfirmDialog
        open={Boolean(confirmation)}
        title={confirmation?.title ?? ""}
        description={confirmation?.description ?? ""}
        confirmLabel={confirmation?.confirmLabel ?? "确认"}
        danger={confirmation?.danger}
        pending={pending}
        onCancel={() => finishConfirmation(false)}
        onConfirm={() => finishConfirmation(true)}
      />
    </div>
  );
}

function statusText(status: PostStatus, isNew: boolean) {
  if (isNew) return "新草稿";
  if (status === "published") return "已发布";
  if (status === "trashed") return "回收站";
  return "草稿";
}

function typeText(type: PostType) {
  return CONTENT_TYPE_DEFINITIONS[type].label;
}

function revisionReasonText(reason: string) {
  const labels: Record<string, string> = {
    publish: "发布前版本",
    unpublish: "取消发布前版本",
    trash: "移入回收站前",
    restore: "恢复记录",
    "restore-before": "恢复前版本",
    status: "状态变更前",
    "save-content": "正文修改前",
    "save-title": "标题修改前",
    "save-meta": "信息修改前",
    "save-content-meta": "正文和信息修改前",
    save: "保存前版本"
  };
  return labels[reason] ?? "保存前版本";
}

function revisionVersionLabel(revision: PostRevision, index: number, total: number) {
  const versionNumber = Math.max(1, total - index);
  return `${statusText(revision.status, false)}版本 ${versionNumber} · ${revisionReasonText(revision.reason)}`;
}

function formatRevisionTime(input: string) {
  return `${formatDateTime(input)} 北京时间`;
}

function WritingHelp() {
  return (
    <section className="editor-help settings-card">
      <div className="settings-section-head">
        <div>
          <h2>Markdown 写作速查</h2>
          <p>这些语法会在公开内容页按当前主题渲染。</p>
        </div>
      </div>
      <div className="help-grid">
        <HelpItem title="正文标题" code={"## 二级标题\n### 三级标题\n\n页面的一级标题使用右侧“标题”字段。"} />
        <HelpItem title="列表" code={"- 无序列表\n1. 有序列表\n- [ ] 待办\n- [x] 完成"} />
        <HelpItem title="引用与强调" code={"> 引用内容\n**加粗**\n*斜体*"} />
        <HelpItem title="代码" code={"`inline code`\n\n```ts\nconst port = 4482;\n```"} />
        <HelpItem title="兼容代码块" code={'[code:json]\n{ "blog": "www.manjyun.top" }\n[/code]'} />
        <HelpItem title="链接与图片" code={"[链接文字](https://example.com)\n![图片说明](/uploads/image.png)"} />
        <HelpItem title="音频卡片" code={'[audio:曲名](/uploads/song.mp3 "可选说明")'} />
        <HelpItem title="书签卡片" code={'[bookmark:标题](https://example.com "可选摘要")'} />
        <HelpItem title="提示卡片" code={"::callout 标题\n这里写提示内容。\n::"} />
      </div>
    </section>
  );
}

function HelpItem({ title, code }: { title: string; code: string }) {
  return (
    <article className="help-item">
      <strong>{title}</strong>
      <pre>{code}</pre>
    </article>
  );
}
