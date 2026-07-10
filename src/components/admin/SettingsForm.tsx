"use client";

import { useMemo, useState, useTransition } from "react";
import type { HomeModule, NavLink, SiteSettings } from "@/types/blog";

type EditableLink = Omit<NavLink, "id"> & { localId: string };
type LinkIconState = {
  status: "pending" | "success" | "error";
  message: string;
};

const moduleLabels: Record<string, string> = {
  recentPosts: "Recent Posts",
  now: "Now",
  projects: "Projects",
  frequentLinks: "Frequent Links",
  stack: "Stack"
};

function toEditableLinks(links: NavLink[]): EditableLink[] {
  return links.map((link) => ({
    localId: String(link.id),
    groupName: link.groupName,
    label: link.label,
    url: link.url,
    iconUrl: link.iconUrl ?? "",
    sortOrder: link.sortOrder
  }));
}

function toSaveLinks(links: EditableLink[]) {
  return links
    .map((link, index) => ({
      label: link.label.trim(),
      url: link.url.trim(),
      iconUrl: link.iconUrl?.trim() || null,
      sortOrder: Number(link.sortOrder) || (index + 1) * 10
    }))
    .filter((link) => link.label && link.url);
}

function configText(module: HomeModule, key: string, fallback = "") {
  return String(module.config[key] ?? fallback);
}

function configListText(module: HomeModule, key: string, fallback = "") {
  const value = module.config[key];
  return Array.isArray(value) ? value.map(String).join(", ") : String(value ?? fallback);
}

function splitListInput(value: string) {
  return value
    .split(/[,\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function SettingsForm({
  settings,
  modules,
  mainLinks,
  frequentLinks
}: {
  settings: SiteSettings;
  modules: HomeModule[];
  mainLinks: NavLink[];
  frequentLinks: NavLink[];
}) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState("");
  const [form, setForm] = useState(settings);
  const [homeModules, setHomeModules] = useState(
    [...modules].sort((a, b) => a.sortOrder - b.sortOrder)
  );
  const [mainNav, setMainNav] = useState(toEditableLinks(mainLinks));
  const [frequentNav, setFrequentNav] = useState(toEditableLinks(frequentLinks));
  const [linkIconStates, setLinkIconStates] = useState<Record<string, LinkIconState>>({});

  const enabledModules = useMemo(
    () =>
      [...homeModules]
        .filter((module) => module.enabled)
        .sort((a, b) => a.sortOrder - b.sortOrder),
    [homeModules]
  );

  function update<K extends keyof SiteSettings>(key: K, value: SiteSettings[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function updateModule(id: string, patch: Partial<HomeModule>) {
    setHomeModules((current) =>
      current.map((module) =>
        module.id === id ? { ...module, ...patch } : module
      )
    );
  }

  function updateModuleConfig(id: string, key: string, value: unknown) {
    setHomeModules((current) =>
      current.map((module) =>
        module.id === id
          ? { ...module, config: { ...module.config, [key]: value } }
          : module
      )
    );
  }

  function updateLink(
    group: "main" | "frequent",
    localId: string,
    patch: Partial<EditableLink>
  ) {
    const setter = group === "main" ? setMainNav : setFrequentNav;
    setter((current) =>
      current.map((link) =>
        link.localId === localId ? { ...link, ...patch } : link
      )
    );
  }

  function addLink(group: "main" | "frequent") {
    const setter = group === "main" ? setMainNav : setFrequentNav;
    setter((current) => [
      ...current,
      {
        localId: crypto.randomUUID(),
        groupName: group,
        label: "",
        url: "",
        iconUrl: "",
        sortOrder: (current.length + 1) * 10
      }
    ]);
  }

  function removeLink(group: "main" | "frequent", localId: string) {
    const setter = group === "main" ? setMainNav : setFrequentNav;
    setter((current) => current.filter((link) => link.localId !== localId));
    setLinkIconStates((current) => {
      const next = { ...current };
      delete next[localId];
      return next;
    });
  }

  function updateLinkIconState(localId: string, state: LinkIconState) {
    setLinkIconStates((current) => ({ ...current, [localId]: state }));
  }

  async function fetchLinkIcon(group: "main" | "frequent", localId: string, url: string) {
    setMessage("");
    if (!url || url.startsWith("/")) {
      updateLinkIconState(localId, {
        status: "error",
        message: "站内链接没有可抓取的网页图标"
      });
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 11000);
    updateLinkIconState(localId, {
      status: "pending",
      message: "正在获取网页图标..."
    });

    try {
      const response = await fetch("/api/admin/link-icon", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
        signal: controller.signal
      });
      const data = (await response.json().catch(() => null)) as
        | { ok: true; iconUrl: string; warning?: string }
        | { ok: false; error: string }
        | null;
      if (!response.ok || !data?.ok) {
        updateLinkIconState(localId, {
          status: "error",
          message: data && !data.ok ? data.error : "获取图标失败"
        });
        return;
      }
      updateLink(group, localId, { iconUrl: data.iconUrl });
      updateLinkIconState(localId, {
        status: data.warning ? "error" : "success",
        message: data.warning ?? "已获取网页图标，记得保存设置"
      });
      setMessage(data.warning ?? "已获取网页图标，记得保存设置");
    } catch (error) {
      updateLinkIconState(localId, {
        status: "error",
        message:
          error instanceof DOMException && error.name === "AbortError"
            ? "获取超时，请手动填写图标 URL 或上传图标"
            : "获取图标失败，请稍后重试"
      });
    } finally {
      window.clearTimeout(timer);
    }
  }

  async function uploadLinkIcon(group: "main" | "frequent", localId: string, file: File) {
    setMessage("");
    if (!file.type.startsWith("image/")) {
      setMessage("图标文件需要是图片");
      return;
    }
    const formData = new FormData();
    formData.append("file", file);
    const response = await fetch("/api/admin/media", {
      method: "POST",
      body: formData
    });
    const data = (await response.json()) as
      | { ok: true; media: { url: string } }
      | { ok: false; error: string };
    if (!response.ok || !data.ok) {
      setMessage(data.ok ? "上传图标失败" : data.error);
      return;
    }
    updateLink(group, localId, { iconUrl: data.media.url });
    setMessage("图标已上传，记得保存设置");
  }

  function save() {
    setMessage("");
    startTransition(async () => {
      const settingsResponse = await fetch("/api/admin/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          settings: form,
          modules: homeModules,
          mainLinks: toSaveLinks(mainNav),
          frequentLinks: toSaveLinks(frequentNav)
        })
      });
      if (!settingsResponse.ok) {
        setMessage("保存失败");
        return;
      }
      setMessage("设置已保存");
    });
  }

  return (
    <div className="settings-workbench">
      <div className="settings-stack">
        <section className="settings-card form-grid">
          <div className="settings-section-head">
            <div>
              <h2>站点与页面</h2>
              <p>控制公开页标题、说明、About 内容和基础信息。</p>
            </div>
          </div>
          <div className="settings-two">
            <div className="field">
              <label>站点标题</label>
              <input className="input" value={form.siteTitle} onChange={(event) => update("siteTitle", event.target.value)} />
            </div>
            <div className="field">
              <label>站点 URL</label>
              <input className="input" value={form.baseUrl} onChange={(event) => update("baseUrl", event.target.value)} />
            </div>
          </div>
          <div className="field">
            <label>站点描述</label>
            <input className="input" value={form.siteDescription} onChange={(event) => update("siteDescription", event.target.value)} />
          </div>
          <div className="field">
            <label>首页简介</label>
            <textarea className="textarea compact" value={form.heroBio} onChange={(event) => update("heroBio", event.target.value)} />
          </div>
          <div className="field">
            <label>首页标签，逗号分隔</label>
            <input className="input" value={form.heroTags} onChange={(event) => update("heroTags", event.target.value)} />
          </div>
          <div className="settings-two">
            <div className="field">
              <label>Blog 页面标题</label>
              <input className="input" value={form.blogTitle} onChange={(event) => update("blogTitle", event.target.value)} />
            </div>
            <div className="field">
              <label>Projects 页面标题</label>
              <input className="input" value={form.projectsTitle} onChange={(event) => update("projectsTitle", event.target.value)} />
            </div>
          </div>
          <div className="settings-two">
            <div className="field">
              <label>Blog 页面说明</label>
              <textarea className="textarea compact" value={form.blogDescription} onChange={(event) => update("blogDescription", event.target.value)} />
            </div>
            <div className="field">
              <label>Projects 页面说明</label>
              <textarea className="textarea compact" value={form.projectsDescription} onChange={(event) => update("projectsDescription", event.target.value)} />
            </div>
          </div>
          <div className="field">
            <label>About 页面标题</label>
            <input className="input" value={form.aboutTitle} onChange={(event) => update("aboutTitle", event.target.value)} />
          </div>
          <div className="field">
            <label>About 页面 Markdown</label>
            <textarea className="textarea" value={form.aboutMarkdown} onChange={(event) => update("aboutMarkdown", event.target.value)} />
          </div>
          <div className="field">
            <label>Uptime 起始日期</label>
            <input className="input" value={form.uptimeStart} onChange={(event) => update("uptimeStart", event.target.value)} />
          </div>
        </section>

        <section className="settings-card form-grid">
          <div className="settings-section-head">
            <div>
              <h2>主页模块编排</h2>
              <p>开启、关闭、重排首页模块，并修改模块标题和主要内容。</p>
            </div>
          </div>
          <div className="module-editor-list">
            {homeModules.map((module) => (
              <article
                className={`module-editor ${module.id === "now" ? "module-editor-now" : ""}`}
                key={module.id}
              >
                <label className="switch-line">
                  <input
                    type="checkbox"
                    checked={module.enabled}
                    onChange={(event) =>
                      updateModule(module.id, { enabled: event.target.checked })
                    }
                  />
                  <span>{moduleLabels[module.id] ?? module.id}</span>
                </label>
                <div className="field">
                  <label>排序</label>
                  <input
                    className="input"
                    type="number"
                    value={module.sortOrder}
                    onChange={(event) =>
                      updateModule(module.id, { sortOrder: Number(event.target.value) || 0 })
                    }
                  />
                </div>
                <div className="field">
                  <label>模块标题</label>
                  <input
                    className="input"
                    value={configText(module, "title", moduleLabels[module.id] ?? module.id)}
                    onChange={(event) =>
                      updateModuleConfig(module.id, "title", event.target.value)
                    }
                  />
                </div>
                {module.id === "now" ? (
                  <>
                    <div className="field module-field-now-text">
                      <label>正在折腾</label>
                      <textarea className="textarea compact module-long-text" value={configText(module, "workingOn")} onChange={(event) => updateModuleConfig(module.id, "workingOn", event.target.value)} />
                    </div>
                    <div className="field module-field-now-text">
                      <label>最近在看</label>
                      <textarea className="textarea compact module-long-text" value={configText(module, "reading")} onChange={(event) => updateModuleConfig(module.id, "reading", event.target.value)} />
                    </div>
                    <div className="field">
                      <label>已完成，逗号分隔</label>
                      <textarea
                        className="textarea compact module-comma-list"
                        value={Array.isArray(module.config.completed) ? module.config.completed.join(", ") : ""}
                        onChange={(event) =>
                          updateModuleConfig(
                            module.id,
                            "completed",
                            event.target.value.split(",").map((item) => item.trim()).filter(Boolean)
                          )
                        }
                      />
                    </div>
                  </>
                ) : null}
                {module.id === "recentPosts" || module.id === "projects" ? (
                  <div className="field">
                    <label>显示数量</label>
                    <input
                      className="input"
                      type="number"
                      min={1}
                      max={20}
                      value={Number(module.config.limit ?? 8)}
                      onChange={(event) =>
                        updateModuleConfig(module.id, "limit", Number(event.target.value) || 1)
                      }
                    />
                  </div>
                ) : null}
                {module.id === "stack" ? (
                  <div className="field module-field-wide">
                    <label>Stack 内容，逗号或换行分隔</label>
                    <textarea
                      className="textarea compact module-comma-list"
                      value={configListText(module, "items", form.stackItems)}
                      onChange={(event) =>
                        updateModuleConfig(module.id, "items", splitListInput(event.target.value))
                      }
                    />
                  </div>
                ) : null}
              </article>
            ))}
          </div>
        </section>

        <section className="settings-card form-grid">
          <div className="settings-section-head">
            <div>
              <h2>导航与链接</h2>
              <p>自定义 blog、projects、about 入口，也可以添加常用链接。</p>
            </div>
          </div>
          <EditableLinks
            title="主导航"
            group="main"
            links={mainNav}
            onUpdate={updateLink}
            onAdd={addLink}
            onRemove={removeLink}
            onFetchIcon={fetchLinkIcon}
            onUploadIcon={uploadLinkIcon}
            iconStates={linkIconStates}
          />
          <p className="admin-subtitle">
            自定义站内路径可以指向已有公开路由；页面类型已从编辑器移除，固定页面内容在这里维护。
          </p>
          <EditableLinks
            title="常用链接"
            group="frequent"
            links={frequentNav}
            onUpdate={updateLink}
            onAdd={addLink}
            onRemove={removeLink}
            onFetchIcon={fetchLinkIcon}
            onUploadIcon={uploadLinkIcon}
            iconStates={linkIconStates}
          />
        </section>
      </div>

      <aside className="settings-preview settings-card">
        <div className="settings-section-head">
          <div>
            <h2>主页预览</h2>
            <p>保存后公开首页会按这里的顺序渲染。</p>
          </div>
        </div>
        <div className="mini-browser">
          <div className="mini-top">
            <span>{form.siteTitle}</span>
            <small>{mainNav.map((link) => link.label || "untitled").join(" / ")}</small>
          </div>
          <div className="mini-hero">
            <strong>{form.siteTitle}<span>.</span></strong>
            <p>{form.heroBio}</p>
          </div>
          <div className="mini-modules">
            {enabledModules.map((module) => (
              <div className="mini-module" key={module.id}>
                <span>{module.sortOrder}</span>
                <strong>{configText(module, "title", moduleLabels[module.id] ?? module.id)}</strong>
              </div>
            ))}
          </div>
        </div>
        <div className="btn-row sticky-actions">
          <button className="btn primary" type="button" disabled={pending} onClick={save}>
            保存设置
          </button>
          <span className={message.includes("失败") ? "error-text" : "success-text"}>
            {pending ? "保存中..." : message}
          </span>
        </div>
      </aside>
    </div>
  );
}

function EditableLinks({
  title,
  group,
  links,
  onUpdate,
  onAdd,
  onRemove,
  onFetchIcon,
  onUploadIcon,
  iconStates
}: {
  title: string;
  group: "main" | "frequent";
  links: EditableLink[];
  onUpdate(group: "main" | "frequent", localId: string, patch: Partial<EditableLink>): void;
  onAdd(group: "main" | "frequent"): void;
  onRemove(group: "main" | "frequent", localId: string): void;
  onFetchIcon(group: "main" | "frequent", localId: string, url: string): Promise<void>;
  onUploadIcon(group: "main" | "frequent", localId: string, file: File): Promise<void>;
  iconStates: Record<string, LinkIconState>;
}) {
  return (
    <div className="link-editor">
      <div className="link-editor-head">
        <h3>{title}</h3>
        <button className="btn subtle" type="button" onClick={() => onAdd(group)}>
          添加链接
        </button>
      </div>
      {links.map((link) => (
        <div className="link-edit-unit" key={link.localId}>
          <div className="link-edit-row">
            <input
              className="input"
              placeholder="名称"
              value={link.label}
              onChange={(event) =>
                onUpdate(group, link.localId, { label: event.target.value })
              }
            />
            <input
              className="input"
              placeholder="/archive 或 https://..."
              value={link.url}
              onChange={(event) =>
                onUpdate(group, link.localId, { url: event.target.value })
              }
            />
            <input
              className="input"
              type="number"
              value={link.sortOrder}
              onChange={(event) =>
                onUpdate(group, link.localId, {
                  sortOrder: Number(event.target.value) || 0
                })
              }
            />
            <button
              className="icon-btn danger"
              type="button"
              aria-label="删除链接"
              onClick={() => onRemove(group, link.localId)}
            >
              ×
            </button>
          </div>
          {group === "frequent" ? (
            <div className="link-icon-row">
              <div className="link-icon-preview" aria-hidden="true">
                {link.iconUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={link.iconUrl} alt="" />
                ) : (
                  <span>{(link.label || "?").slice(0, 1)}</span>
                )}
              </div>
              <input
                className="input"
                placeholder="图标 URL，可留空"
                value={link.iconUrl ?? ""}
                onChange={(event) =>
                  onUpdate(group, link.localId, { iconUrl: event.target.value })
                }
              />
              <button
                className="btn subtle"
                type="button"
                disabled={iconStates[link.localId]?.status === "pending"}
                aria-busy={iconStates[link.localId]?.status === "pending"}
                onClick={() => void onFetchIcon(group, link.localId, link.url)}
              >
                {iconStates[link.localId]?.status === "pending" ? "获取中..." : "获取图标"}
              </button>
              <label className="btn subtle file-btn">
                上传图标
                <input
                  className="visually-hidden"
                  type="file"
                  accept="image/jpeg,image/png,image/gif,image/webp,image/avif,image/x-icon"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) void onUploadIcon(group, link.localId, file);
                    event.currentTarget.value = "";
                  }}
                />
              </label>
              {iconStates[link.localId] ? (
                <small className={`link-icon-state ${iconStates[link.localId].status}`}>
                  {iconStates[link.localId].message}
                </small>
              ) : null}
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}
