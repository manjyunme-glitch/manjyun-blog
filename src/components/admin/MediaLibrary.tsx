"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { MediaRecord } from "@/types/blog";

export function MediaLibrary({ media }: { media: MediaRecord[] }) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState("");

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
        <p className={message.includes("失败") ? "error-text" : "success-text"}>
          {pending ? "上传中..." : message}
        </p>
      </section>
      <section className="media-grid">
        {media.map((item) => (
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
              <button
                className="btn"
                type="button"
                onClick={() => void navigator.clipboard.writeText(item.url)}
              >
                复制 URL
              </button>
            </div>
          </article>
        ))}
      </section>
    </div>
  );
}
