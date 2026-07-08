"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { formatDate } from "@/lib/content/format";
import type { PostRevision, PostStatus, PostType, PostWithTags } from "@/types/blog";

type EditablePostType = Extract<PostType, "post" | "project">;

type Draft = {
  id?: number;
  type: EditablePostType;
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

const starterMarkdown = `这里写 Markdown 正文。标题请填写在右侧“标题”字段中，正文从这里开始。

## 小标题

::callout 备注
这里是一段自定义 callout。
::
`;

function draftFromPost(post: PostWithTags | null): Draft {
  return {
    id: post?.id,
    type: post?.type === "project" ? "project" : "post",
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
  revisions = []
}: {
  post: PostWithTags | null;
  revisions?: PostRevision[];
}) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const pendingRef = useRef(false);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [preview, setPreview] = useState("");
  const [helpOpen, setHelpOpen] = useState(false);
  const [draft, setDraft] = useState<Draft>(() => draftFromPost(post));
  const [revisionItems, setRevisionItems] = useState<PostRevision[]>(revisions);
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

  const selectedRevision = useMemo(
    () => revisionItems.find((revision) => revision.id === selectedRevisionId) ?? null,
    [revisionItems, selectedRevisionId]
  );

  function update<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
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
      setMessage(successMessage ?? (status === "published" ? "已发布" : "已保存草稿"));
      if (wasNew) {
        router.push(`/admin/posts/${data.id}`);
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
      router.push("/admin/posts?status=trash");
    });
  }

  async function patchStatus(action: "trash" | "restore") {
    if (!draft.id) return;
    const confirmMessage =
      action === "trash" ? "确定移到回收站？公开页面会立即隐藏。" : "";
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
      setMessage(action === "trash" ? "已移到回收站" : "已恢复为草稿");
      if (action === "trash") {
        router.push("/admin/posts?status=trash");
      } else {
        router.refresh();
      }
    });
  }

  async function restoreRevision(revisionId: number) {
    if (!draft.id) return;
    setMessage("");
    await runPending("恢复失败", async () => {
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
        setMessage(data && !data.ok ? data.error : "恢复失败");
        return;
      }

      setDraft(draftFromPost(data.post));
      setRevisionItems(data.revisions);
      setSelectedRevisionId(data.revisions[0]?.id ?? null);
      setMessage("已恢复为草稿");
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
              <div className="editor-dates" aria-label="文章时间">
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
                <button className="btn" type="button" disabled={pending} onClick={() => save("published", "已保存更改")}>
                  保存更改
                </button>
                <button className="btn primary" type="button" disabled={pending} onClick={() => save("draft", "已取消发布")}>
                  取消发布
                </button>
                <button className="btn danger" type="button" disabled={pending || !draft.id} onClick={() => void patchStatus("trash")}>
                  移到回收站
                </button>
              </>
            ) : (
              <>
                <button className="btn" type="button" disabled={pending} onClick={() => save("draft")}>
                  保存草稿
                </button>
                <button className="btn primary" type="button" disabled={pending} onClick={() => save("published")}>
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
          <span className={message.includes("失败") ? "error-text" : "success-text"}>
            {pending ? "保存中..." : message}
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
          <section className="settings-card revision-card">
            <div className="settings-section-head revision-head">
              <div>
                <h2>版本历史</h2>
              </div>
              <span className="chip">{revisionItems.length}</span>
            </div>
            {revisionItems.length ? (
              <>
                <div className="revision-list">
                  {revisionItems.map((revision) => (
                    <button
                      key={revision.id}
                      className={`revision-item ${selectedRevisionId === revision.id ? "is-active" : ""}`}
                      type="button"
                      aria-pressed={selectedRevisionId === revision.id}
                      onClick={() => setSelectedRevisionId(revision.id)}
                    >
                      <span>
                        <strong>{revisionReasonText(revision.reason)}</strong>
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
                      <code>{selectedRevision.slug}</code>
                    </div>
                    <pre>{selectedRevision.markdown.slice(0, 680) || "空内容"}</pre>
                    <button
                      className="btn primary"
                      type="button"
                      disabled={pending}
                      onClick={() => void restoreRevision(selectedRevision.id)}
                    >
                      恢复为草稿
                    </button>
                  </div>
                ) : null}
              </>
            ) : (
              <p className="empty-state">暂无历史版本。</p>
            )}
          </section>
        ) : null}

        <section className="settings-card form-grid">
          <div className="field">
            <label>标题</label>
            <input className="input" value={draft.title} disabled={draft.status === "trashed"} onChange={(event) => update("title", event.target.value)} />
          </div>
          <div className="field">
            <label>Slug</label>
            <input className="input" value={draft.slug} disabled={draft.status === "trashed"} onChange={(event) => update("slug", event.target.value)} placeholder="自动生成" />
          </div>
          <div className="field">
            <label>类型</label>
            <select className="select" value={draft.type} disabled={draft.status === "trashed"} onChange={(event) => update("type", event.target.value as EditablePostType)}>
              <option value="post">文章</option>
              <option value="project">项目</option>
            </select>
            <p className="field-hint">页面类型已移除，固定页面内容改在站点设置里维护。</p>
          </div>
          <div className="field">
            <label>标签，逗号分隔</label>
            <input className="input" value={draft.tags} disabled={draft.status === "trashed"} onChange={(event) => update("tags", event.target.value)} />
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
              disabled={draft.status === "trashed"}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void upload(file);
                event.currentTarget.value = "";
              }}
            />
            <button className="upload-control" type="button" disabled={draft.status === "trashed"} onClick={() => fileInputRef.current?.click()}>
              <span>选择媒体文件</span>
              <small>图片插入 Markdown，音频插入 audio 卡片</small>
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

function typeText(type: EditablePostType) {
  return type === "project" ? "项目" : "文章";
}

function revisionReasonText(reason: string) {
  const labels: Record<string, string> = {
    publish: "发布前",
    unpublish: "取消发布前",
    trash: "移入回收站前",
    restore: "恢复版本",
    "restore-before": "恢复前",
    status: "状态变更前",
    save: "保存前"
  };
  return labels[reason] ?? "保存前";
}

function formatRevisionTime(input: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(input));
}

function WritingHelp() {
  return (
    <section className="editor-help settings-card">
      <div className="settings-section-head">
        <div>
          <h2>Markdown 写作速查</h2>
          <p>这些语法会在公开文章页按当前主题渲染。</p>
        </div>
      </div>
      <div className="help-grid">
        <HelpItem title="标题" code={"# 一级标题\n## 二级标题\n### 三级标题"} />
        <HelpItem title="列表" code={"- 无序列表\n1. 有序列表\n- [ ] 待办\n- [x] 完成"} />
        <HelpItem title="引用与强调" code={"> 引用内容\n**加粗**\n*斜体*"} />
        <HelpItem title="代码" code={"`inline code`\n\n```ts\nconst port = 4482;\n```"} />
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
