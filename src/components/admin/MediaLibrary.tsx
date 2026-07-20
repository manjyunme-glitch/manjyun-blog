"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { MediaRecord } from "@/types/blog";
import { ConfirmDialog } from "@/components/admin/AdminFeedback";
import {
  createIdempotencyKey,
  requestJson
} from "@/lib/http/client-api";
import type { MediaReconciliationReport } from "@/lib/media/reconcile";

type MediaReference = {
  kind: string;
  id: string;
  label: string;
  field: string;
};

type DeleteConfirmation = {
  item: MediaRecord;
  force: boolean;
  references: MediaReference[];
};

export function MediaLibrary({ media }: { media: MediaRecord[] }) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState("");
  const [messageKind, setMessageKind] = useState<"success" | "error">("success");
  const [query, setQuery] = useState("");
  const [type, setType] = useState<"all" | "image" | "audio" | "document">("all");
  const [uploadRetry, setUploadRetry] = useState<{
    file: File;
    idempotencyKey: string;
  } | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<number | null>(null);
  const [blockedReferences, setBlockedReferences] = useState<
    Record<number, MediaReference[]>
  >({});
  const [deleteConfirmation, setDeleteConfirmation] =
    useState<DeleteConfirmation | null>(null);
  const [reconciliation, setReconciliation] =
    useState<MediaReconciliationReport | null>(null);
  const [reconciling, setReconciling] = useState(false);
  const filteredMedia = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return media.filter((item) => {
      const matchesQuery = !needle || item.originalName.toLocaleLowerCase().includes(needle) || item.mime.toLocaleLowerCase().includes(needle);
      const matchesType = type === "all" || (type === "image" && item.mime.startsWith("image/")) || (type === "audio" && item.mime.startsWith("audio/")) || (type === "document" && !item.mime.startsWith("image/") && !item.mime.startsWith("audio/"));
      return matchesQuery && matchesType;
    });
  }, [media, query, type]);

  async function copyMedia(item: MediaRecord, format: "url" | "markdown") {
    const value = format === "url"
      ? item.url
      : item.mime.startsWith("image/")
        ? `![${item.originalName}](${item.url})`
        : item.mime.startsWith("audio/")
          ? `[audio:${item.originalName}](${item.url})`
          : `[${item.originalName}](${item.url})`;
    try {
      await navigator.clipboard.writeText(value);
      setMessageKind("success");
      setMessage(format === "url" ? `已复制 ${item.originalName} 的 URL` : `已复制 ${item.originalName} 的 Markdown`);
    } catch {
      setMessageKind("error");
      setMessage("复制失败，请检查浏览器剪贴板权限");
    }
  }

  function upload(file: File, idempotencyKey = createIdempotencyKey()) {
    setMessage("");
    startTransition(async () => {
      const formData = new FormData();
      formData.append("file", file);
      const result = await requestJson<{
        ok: true;
        media: MediaRecord;
        replayed: boolean;
      }>(
        "/api/admin/media",
        {
          method: "POST",
          headers: { "Idempotency-Key": idempotencyKey },
          body: formData
        },
        { fallbackMessage: "上传失败" }
      );
      if (!result.ok) {
        setMessageKind("error");
        setMessage(result.message);
        if (
          result.outcome === "unknown" ||
          result.code === "IDEMPOTENCY_IN_PROGRESS"
        ) {
          setUploadRetry({ file, idempotencyKey });
        } else {
          setUploadRetry(null);
        }
        return;
      }
      setUploadRetry(null);
      setMessageKind("success");
      setMessage(result.data.replayed ? "上传请求已安全重放，未创建重复文件" : "上传完成");
      router.refresh();
    });
  }

  async function deleteMedia(confirmation: DeleteConfirmation) {
    const { item, force } = confirmation;
    setDeleteConfirmation(null);
    setPendingDeleteId(item.id);
    setMessage("");
    const result = await requestJson<{
      ok: true;
      id: number;
      fileMissing: boolean;
      cleanupPending: boolean;
      forcedReferenceCount: number;
      warning?: string;
    }>(
      `/api/admin/media/${item.id}${force ? "?force=1" : ""}`,
      { method: "DELETE" },
      { fallbackMessage: "删除失败" }
    );
    setPendingDeleteId(null);

    if (!result.ok) {
      setMessageKind("error");
      if (result.code === "MEDIA_IN_USE") {
        const references = Array.isArray(result.data?.references)
          ? (result.data.references as MediaReference[])
          : [];
        setBlockedReferences((current) => ({
          ...current,
          [item.id]: references
        }));
        setMessage(
          `“${item.originalName}”仍有 ${Number(result.data?.referenceCount ?? references.length)} 处引用，默认未删除。`
        );
      } else {
        setMessage(result.message);
      }
      return;
    }

    setBlockedReferences((current) => {
      const next = { ...current };
      delete next[item.id];
      return next;
    });
    setMessageKind(result.data.cleanupPending ? "error" : "success");
    setMessage(
      result.data.warning ??
        (result.data.fileMissing
          ? "媒体记录已删除；对账确认文件此前已经缺失。"
          : result.data.forcedReferenceCount
            ? `媒体已强制删除；${result.data.forcedReferenceCount} 处现有引用将返回 404。`
            : "媒体已删除。")
    );
    router.refresh();
  }

  async function reconcile() {
    setReconciling(true);
    setMessage("");
    const result = await requestJson<{
      ok: true;
      report: MediaReconciliationReport;
    }>(
      "/api/admin/media/reconcile",
      { method: "GET" },
      { fallbackMessage: "存储对账失败", operation: "read" }
    );
    setReconciling(false);
    if (!result.ok) {
      setMessageKind("error");
      setMessage(result.message);
      return;
    }
    setReconciliation(result.data.report);
    const report = result.data.report;
    setMessageKind(
      report.missingCount || report.orphanedCount || report.transientCount
        ? "error"
        : "success"
    );
    setMessage(
      report.missingCount || report.orphanedCount || report.transientCount
        ? `对账发现：缺失记录 ${report.missingCount}、孤立文件 ${report.orphanedCount}、暂存残留 ${report.transientCount}。`
        : "存储对账完成：数据库记录与媒体文件一致。"
    );
  }

  return (
    <div className="form-grid">
      <section className="settings-card">
        <div className="field">
          <label htmlFor="media-library-upload">上传媒体</label>
          <input
            id="media-library-upload"
            ref={fileInputRef}
            className="visually-hidden"
            type="file"
            disabled={pending}
            accept="image/jpeg,image/png,image/gif,image/webp,image/avif,image/x-icon,audio/mpeg,audio/wav,audio/ogg,audio/flac,audio/mp4,application/pdf"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) upload(file);
              event.currentTarget.value = "";
            }}
          />
          <button className="upload-control" type="button" disabled={pending} onClick={() => fileInputRef.current?.click()}>
            <span>选择媒体文件</span>
            <small>支持常用图片、音频和 PDF；SVG 会被拒绝</small>
          </button>
        </div>
        {uploadRetry ? (
          <button
            className="btn"
            type="button"
            disabled={pending}
            onClick={() =>
              upload(uploadRetry.file, uploadRetry.idempotencyKey)
            }
          >
            用同一幂等键重试上传
          </button>
        ) : null}
        <p className={messageKind === "error" ? "error-text" : "success-text"} role="status" aria-live="polite">
          {pending ? "上传中..." : message}
        </p>
      </section>
      <section className="media-toolbar settings-card">
        <input className="input" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索文件名或 MIME 类型" aria-label="搜索媒体" />
        <div className="segmented" aria-label="媒体类型筛选">
          {(["all", "image", "audio", "document"] as const).map((filter) => (
            <button key={filter} className={`seg-btn ${type === filter ? "is-active" : ""}`} type="button" aria-pressed={type === filter} onClick={() => setType(filter)}>
              {filter === "all" ? "全部" : filter === "image" ? "图片" : filter === "audio" ? "音频" : "文档"}
            </button>
          ))}
        </div>
        <span className="chip">{filteredMedia.length} / {media.length}</span>
        <button className="btn ghost" type="button" disabled={reconciling} onClick={() => void reconcile()}>
          {reconciling ? "正在对账..." : "检查文件一致性"}
        </button>
      </section>
      {reconciliation ? (
        <section className="settings-card form-grid" aria-label="媒体存储对账结果">
          <div className="btn-row">
            <span className="chip">数据库 {reconciliation.databaseRecords}</span>
            <span className="chip">文件 {reconciliation.managedFiles}</span>
            <span className="chip">缺失 {reconciliation.missingCount}</span>
            <span className="chip">孤立 {reconciliation.orphanedCount}</span>
            <span className="chip">暂存 {reconciliation.transientCount}</span>
          </div>
          {reconciliation.missing.length ? (
            <div>
              <strong>数据库有记录但文件缺失</strong>
              <ul>
                {reconciliation.missing.map((item) => (
                  <li key={item.id}>{item.originalName} — {item.filename}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {reconciliation.orphaned.length ? (
            <div>
              <strong>磁盘孤立文件（不会自动删除）</strong>
              <ul>
                {reconciliation.orphaned.map((filename) => (
                  <li key={filename}>{filename}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {reconciliation.transient.length ? (
            <div>
              <strong>失败或中断操作留下的隐藏暂存文件</strong>
              <ul>
                {reconciliation.transient.map((filename) => (
                  <li key={filename}>{filename}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {reconciliation.detailsTruncated ? (
            <p className="field-hint">问题较多，此处只显示每类前 200 项。</p>
          ) : null}
        </section>
      ) : null}
      <section className="media-grid">
        {filteredMedia.map((item) => {
          const references = blockedReferences[item.id] ?? [];
          return (
          <article className="media-card" key={item.id}>
            <div className="media-thumb">
              {item.mime.startsWith("image/") ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={item.url} alt={item.originalName} loading="lazy" />
              ) : (
                <span>{item.mime}</span>
              )}
            </div>
            <div className="media-card-body">
              <strong title={item.originalName}>{item.originalName}</strong>
              <small>{Math.round(item.size / 1024)} KB</small>
              <div className="btn-row media-actions">
                <button className="btn" type="button" onClick={() => void copyMedia(item, "url")}>复制 URL</button>
                <button className="btn ghost" type="button" onClick={() => void copyMedia(item, "markdown")}>复制 Markdown</button>
                <button
                  className="btn danger"
                  type="button"
                  disabled={pendingDeleteId === item.id}
                  onClick={() =>
                    setDeleteConfirmation({
                      item,
                      force: references.length > 0,
                      references
                    })
                  }
                >
                  {pendingDeleteId === item.id
                    ? "删除中..."
                    : references.length
                      ? "强制删除..."
                      : "删除"}
                </button>
              </div>
              {references.length ? (
                <small className="error-text">
                  仍被引用：{references.slice(0, 3).map((reference) => `${reference.label} / ${reference.field}`).join("；")}
                  {references.length > 3 ? ` 等 ${references.length} 处` : ""}
                </small>
              ) : null}
            </div>
          </article>
          );
        })}
        {!filteredMedia.length ? <p className="empty-state media-empty">没有符合当前筛选的媒体。</p> : null}
      </section>
      <ConfirmDialog
        open={Boolean(deleteConfirmation)}
        title={
          deleteConfirmation?.force
            ? `强制删除“${deleteConfirmation.item.originalName}”？`
            : `删除“${deleteConfirmation?.item.originalName ?? ""}”？`
        }
        description={
          deleteConfirmation?.force
            ? `该文件仍有 ${deleteConfirmation.references.length} 处引用。强制删除后，这些封面、正文链接、导航图标或历史版本将返回 404。`
            : "系统会再次检查文章封面、Markdown、导航图标、设置和历史版本；仍被引用时默认拒绝删除。"
        }
        confirmLabel={deleteConfirmation?.force ? "仍要强制删除" : "删除未引用媒体"}
        danger
        pending={pendingDeleteId !== null}
        onCancel={() => setDeleteConfirmation(null)}
        onConfirm={() => {
          if (deleteConfirmation) void deleteMedia(deleteConfirmation);
        }}
      />
    </div>
  );
}
