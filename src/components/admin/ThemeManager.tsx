"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ThemeInstallRecord } from "@/types/blog";
import type { ThemeDefinition } from "@/themes/types";

export function ThemeManager({
  activeTheme,
  themes,
  imports
}: {
  activeTheme: string;
  themes: Array<ThemeDefinition["meta"] & { tokens: ThemeDefinition["tokens"] }>;
  imports: ThemeInstallRecord[];
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState("");
  const [issues, setIssues] = useState<string[]>([]);

  function importTheme(file: File) {
    setMessage("");
    setIssues([]);
    startTransition(async () => {
      const formData = new FormData();
      formData.append("file", file);
      const response = await fetch("/api/admin/themes/import", {
        method: "POST",
        body: formData
      });
      const data = (await response.json()) as {
        ok?: boolean;
        error?: string;
        audit?: { issues?: string[] };
      };
      if (!response.ok || !data.ok) {
        setMessage(data.error ?? "导入失败");
        setIssues(data.audit?.issues ?? []);
        router.refresh();
        return;
      }
      setMessage("主题兼容性审查通过，已记录导入结果。");
      router.refresh();
    });
  }

  return (
    <div className="theme-workbench">
      <section className="theme-toolbar settings-card">
        <div>
          <h2>主题库</h2>
          <p>代码主题负责结构，导入器负责审查 manifest 是否符合主题接口。</p>
        </div>
        <input
          ref={inputRef}
          className="visually-hidden"
          type="file"
          accept="application/json,.json"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) importTheme(file);
            event.currentTarget.value = "";
          }}
        />
        <button className="btn primary" type="button" disabled={pending} onClick={() => inputRef.current?.click()}>
          导入主题
        </button>
      </section>

      {message ? (
        <section className={`settings-card ${issues.length ? "theme-error" : "theme-success"}`}>
          <strong>{pending ? "审查中..." : message}</strong>
          {issues.length ? (
            <ul>
              {issues.map((issue) => (
                <li key={issue}>{issue}</li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}

      <section className="theme-grid">
        {themes.map((theme) => (
          <article className="theme-card" key={theme.id}>
            <ThemePreview tokens={theme.tokens} />
            <div className="theme-card-body">
              <div>
                <h2>{theme.name}</h2>
                <p>{theme.description}</p>
              </div>
              <span className={`status-pill ${activeTheme === theme.id ? "published" : ""}`}>
                {activeTheme === theme.id ? "active" : "available"}
              </span>
            </div>
          </article>
        ))}
      </section>

      <section className="settings-card form-grid">
        <div className="settings-section-head">
          <div>
            <h2>导入记录</h2>
            <p>兼容表示 manifest 通过接口审查；不兼容会列出缺失项。</p>
          </div>
        </div>
        {imports.length ? (
          <div className="import-list">
            {imports.map((item) => (
              <article className="import-row" key={item.id}>
                <div>
                  <strong>{item.name}</strong>
                  <small>{item.themeId} / {item.version}</small>
                  <p>{item.description}</p>
                  {item.issues.length ? (
                    <ul>
                      {item.issues.map((issue) => (
                        <li key={issue}>{issue}</li>
                      ))}
                    </ul>
                  ) : null}
                </div>
                <span className={`status-pill ${item.status === "compatible" ? "published" : ""}`}>
                  {item.status}
                </span>
              </article>
            ))}
          </div>
        ) : (
          <p className="empty-state">还没有导入记录。导入 JSON manifest 后会显示审查结果。</p>
        )}
      </section>
    </div>
  );
}

function ThemePreview({ tokens }: { tokens: Record<string, string> }) {
  return (
    <div
      className="theme-preview"
      style={{
        "--preview-bg": tokens.bg,
        "--preview-surface": tokens.surface,
        "--preview-text": tokens.text,
        "--preview-accent": tokens.accent
      } as React.CSSProperties}
    >
      <div className="preview-nav">
        <span />
        <span />
        <span />
      </div>
      <div className="preview-title" />
      <div className="preview-line long" />
      <div className="preview-line" />
      <div className="preview-card">
        <span />
        <strong />
      </div>
    </div>
  );
}
