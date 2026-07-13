"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { MediaRecord } from "@/types/blog";

export function MediaLibrary({ media }: { media: MediaRecord[] }) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState("");
  const [query, setQuery] = useState("");
  const [type, setType] = useState<"all" | "image" | "audio" | "document">("all");
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
      setMessage(format === "url" ? `已复制 ${item.originalName} 的 URL` : `已复制 ${item.originalName} 的 Markdown`);
    } catch {
      setMessage("复制失败，请检查浏览器剪贴板权限");
    }
  }

  function upload(file: File) {
    setMessage("");
    startTransition(async () => {
      const formData = new FormData();
      formData.append("file", file);
      const response = await fetch("/api/admin/media", {
        method: "POST",
        body: formData
      });
      if (!response.ok) {
        const data = (await response.json()) as { error?: string };
        setMessage(data.error ?? "上传失败");
        return;
      }
      setMessage("上传完成");
      router.refresh();
    });
  }

  return (
    <div className="form-grid">
      <section className="settings-card">
        <div className="field">
          <label>上传媒体</label>
          <input
            ref={fileInputRef}
            className="visually-hidden"
            type="file"
            accept="image/jpeg,image/png,image/gif,image/webp,image/avif,image/x-icon,audio/mpeg,audio/wav,audio/ogg,audio/flac,audio/mp4,application/pdf"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) upload(file);
              event.currentTarget.value = "";
            }}
          />
          <button className="upload-control" type="button" onClick={() => fileInputRef.current?.click()}>
            <span>选择媒体文件</span>
            <small>支持常用图片、音频和 PDF；SVG 会被拒绝</small>
          </button>
        </div>
        <p className={message.includes("失败") ? "error-text" : "success-text"} role="status" aria-live="polite">
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
      </section>
      <section className="media-grid">
        {filteredMedia.map((item) => (
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
              </div>
            </div>
          </article>
        ))}
        {!filteredMedia.length ? <p className="empty-state media-empty">没有符合当前筛选的媒体。</p> : null}
      </section>
    </div>
  );
}
