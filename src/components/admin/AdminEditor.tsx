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
import type { PostRevision, PostStatus, PostType, PostWithTags } from "@/types/blog";

type RevisionFilter = "all" | Extract<PostStatus, "published" | "draft">;

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
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [preview, setPreview] = useState("");
  const [helpOpen, setHelpOpen] = useState(false);
  const [revisionOpen, setRevisionOpen] = useState(false);
  const [draft, setDraft] = useState<Draft>(() => draftFromPost(post));
  const [isDirty, setIsDirty] = useState(false);
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
    const timer = window.setTimeout(async () => {
      const response = await fetch("/api/admin/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ markdown: draft.markdown })
      });
      if (response.ok) {
        const data = (await response.json()) as { html: string };
        setPreview(data.html);
      }
    }, 220);
    return () => window.clearTimeout(timer);
  }, [draft.markdown]);

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

  function confirmLeave() {
    return !dirtyRef.current || window.confirm("还有未保存的修改，确定离开编辑器？");
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
      setMessage(successMessage ?? (status === "published" ? "已发布" : "已保存草稿"));
      if (wasNew) {
        window.location.assign(`/admin/posts/${data.id}`);
      } else {
        router.refresh();
      }
    });
  }

  async function deletePost() {
    if (!draft.id || !window.confirm("确定永久删除？这个操作不能撤销。")) return;
    await runPending("删除失败", async () => {
      const response = await fetch(`${endpoint}?permanent=1`, { method: "DELETE" });
      if (!response.ok) {
        setMessage("删除失败");
        return;
      }
      dirtyRef.current = false;
      setIsDirty(false);
      router.push("/admin/posts?status=trashed");
    });
  }

  async function patchStatus(action: "trash" | "restore") {
    if (!draft.id) return;
    const confirmMessage =
      action === "trash"
        ? dirtyRef.current
          ? "还有未保存的修改；移到回收站会放弃这些修改并立即隐藏公开页面，确定继续？"
          : "确定移到回收站？公开页面会立即隐藏。"
        : "";
    if (confirmMessage && !window.confirm(confirmMessage)) return;

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
    if (
      dirtyRef.current &&
      !window.confirm("回退版本会覆盖当前未保存的修改，确定继续？")
    ) {
      return;
    }
    if (
      targetRevision.status !== draft.status &&
      !window.confirm(
        `这会把当前内容回退为“${statusText(targetRevision.status, false)}”状态，确定继续？`
      )
    ) {
      return;
    }

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

  return (
    <div className="editor-layout">
      <div className="editor-main">
        <div className="editor-toolbar">
          <div className="editor-statusbar">
            <span className={`status-pill ${draft.status}`}>{statusText(draft.status, !draft.id)}</span>
            <span className="type-pill">{typeText(draft.type)}</span>
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
            <Link
              className="btn ghost"
              href={backHref}
              onClick={(event) => {
                if (!confirmLeave()) event.preventDefault();
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

        <div className="editor-panel">
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

        <div className="editor-panel">
          <div className="editor-panel-head">
            <span>Live Preview</span>
            <span>server rendered</span>
          </div>
          <div
            className="preview-pane gh-content"
            dangerouslySetInnerHTML={{ __html: preview }}
          />
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
            <label>标题</label>
            <input className="input" value={draft.title} disabled={draft.status === "trashed"} onChange={(event) => update("title", event.target.value)} />
          </div>
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
