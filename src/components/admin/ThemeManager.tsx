"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ThemeInstallRecord } from "@/types/blog";
import type { ThemeDefinition } from "@/themes/types";

type CompiledTheme = ThemeDefinition["meta"] &
  Pick<ThemeDefinition, "apiVersion" | "capabilities">;

export function ThemeManager({
  activeTheme,
  previousTheme,
  themes,
  imports
}: {
  activeTheme: string;
  previousTheme: { id: string; name: string } | null;
  themes: CompiledTheme[];
  imports: ThemeInstallRecord[];
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [pending, startTransition] = useTransition();
  const [pendingTarget, setPendingTarget] = useState("");
  const [message, setMessage] = useState("");
  const [messageKind, setMessageKind] = useState<"success" | "error">("success");
  const [issues, setIssues] = useState<string[]>([]);
  const currentTheme = themes.find((theme) => theme.id === activeTheme);

  function resetFeedback() {
    setMessage("");
    setIssues([]);
  }

  function reviewManifest(file: File) {
    resetFeedback();
    setPendingTarget("manifest");
    startTransition(async () => {
      try {
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
          setMessageKind("error");
          setMessage(data.error ?? "Manifest 审查失败");
          setIssues(data.audit?.issues ?? []);
          router.refresh();
          return;
        }
        setMessageKind("success");
        setMessage("Manifest 兼容性审查通过，已记录审查结果；这不会安装或执行主题代码。");
        router.refresh();
      } catch {
        setMessageKind("error");
        setMessage("Manifest 审查请求失败，请稍后重试。");
      } finally {
        setPendingTarget("");
      }
    });
  }

  function changeTheme(action: "activate" | "rollback", themeId?: string) {
    resetFeedback();
    setPendingTarget(action === "rollback" ? "rollback" : themeId ?? "activate");
    startTransition(async () => {
      try {
        const response = await fetch("/api/admin/themes", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action, themeId })
        });
        const data = (await response.json()) as {
          ok?: boolean;
          error?: string;
          activeTheme?: string;
        };
        if (!response.ok || !data.ok) {
          setMessageKind("error");
          setMessage(data.error ?? "主题切换失败");
          return;
        }
        setMessageKind("success");
        setMessage(
          action === "rollback"
            ? `已回退到 ${data.activeTheme ?? "上一个主题"}。`
            : `已激活 ${data.activeTheme ?? themeId ?? "所选主题"}。`
        );
        router.refresh();
      } catch {
        setMessageKind("error");
        setMessage("主题切换请求失败，请稍后重试。");
      } finally {
        setPendingTarget("");
      }
    });
  }

  return (
    <div className="theme-workbench" aria-busy={pending}>
      <section className="theme-toolbar settings-card">
        <div>
          <h2>编译主题库</h2>
          <p>
            当前：{currentTheme?.name ?? activeTheme}。只有已编译并通过当前 Theme API
            契约的主题可以激活。
          </p>
        </div>
        <div className="theme-toolbar-actions">
          {previousTheme ? (
            <button
              className="btn"
              type="button"
              disabled={pending}
              onClick={() => changeTheme("rollback")}
            >
              {pending && pendingTarget === "rollback"
                ? "回退中..."
                : `回退到 ${previousTheme.name}`}
            </button>
          ) : null}
          <input
            ref={inputRef}
            className="visually-hidden"
            type="file"
            accept="application/json,.json"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) reviewManifest(file);
              event.currentTarget.value = "";
            }}
          />
          <button
            className="btn primary"
            type="button"
            disabled={pending}
            onClick={() => inputRef.current?.click()}
          >
            {pending && pendingTarget === "manifest" ? "审查中..." : "审查 manifest"}
          </button>
        </div>
      </section>

      {message ? (
        <section
          className={`settings-card ${messageKind === "error" ? "theme-error" : "theme-success"}`}
          role={messageKind === "error" ? "alert" : "status"}
          aria-live={messageKind === "error" ? "assertive" : "polite"}
        >
          <strong>{message}</strong>
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
        {themes.map((theme) => {
          const isActive = activeTheme === theme.id;
          const previewHref = `/theme-preview/${encodeURIComponent(theme.id)}`;
          return (
            <article className="theme-card" key={theme.id}>
              <div className="theme-preview">
                <iframe
                  src={previewHref}
                  title={`${theme.name} 真实首页预览`}
                  loading={isActive ? "eager" : "lazy"}
                  tabIndex={-1}
                />
              </div>
              <div className="theme-card-body">
                <div className="theme-card-copy">
                  <h2>{theme.name}</h2>
                  <small>
                    v{theme.version} · Theme API {theme.apiVersion}
                  </small>
                  <p>{theme.description}</p>
                </div>
                <div className="theme-card-actions">
                  <span className={`status-pill ${isActive ? "published" : ""}`}>
                    {isActive ? "当前" : "可用"}
                  </span>
                  <a className="btn" href={previewHref} target="_blank" rel="noopener noreferrer">
                    展开预览
                  </a>
                  {!isActive ? (
                    <button
                      className="btn primary"
                      type="button"
                      disabled={pending}
                      onClick={() => changeTheme("activate", theme.id)}
                    >
                      {pending && pendingTarget === theme.id ? "激活中..." : "激活"}
                    </button>
                  ) : null}
                </div>
              </div>
            </article>
          );
        })}
      </section>

      <section className="settings-card form-grid">
        <div className="settings-section-head">
          <div>
            <h2>Manifest 审查记录</h2>
            <p>兼容只代表 manifest 通过接口审查，不代表主题代码已经安装或可激活。</p>
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
          <p className="empty-state">还没有 manifest 审查记录。</p>
        )}
      </section>
    </div>
  );
}
