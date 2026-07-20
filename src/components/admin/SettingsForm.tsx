"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import type {
  HomeModule,
  NavLink,
  SiteConfiguration,
  SiteSettings
} from "@/types/blog";
import {
  editableSiteSettingKeys,
  moveOrderedItem,
  normalizeOrder
} from "@/lib/admin/settings-validation";
import type { FieldErrors } from "@/lib/admin/settings-validation";
import {
  classifySettingsDraft,
  clearSettingsDraft,
  createSettingsDraftSnapshot,
  handleSettingsHistoryBack,
  readSettingsDraft,
  writeSettingsDraft,
  type SettingsDraftRecoveryKind,
  type SettingsDraftSnapshot
} from "@/lib/admin/settings-draft";
import {
  clearPersistentOperationKey,
  persistentOperationKey,
  requestJson,
  type JsonRequestResult
} from "@/lib/http/client-api";

type EditableLink = Omit<NavLink, "id"> & { localId: string };
type LinkIconState = {
  status: "pending" | "success" | "error";
  message: string;
};
type SettingsDraft = {
  form: SiteSettings;
  homeModules: HomeModule[];
  mainNav: EditableLink[];
  frequentNav: EditableLink[];
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
  return links.map((link, index) => ({
    label: link.label.trim(),
    url: link.url.trim(),
    iconUrl: link.iconUrl?.trim() || null,
    sortOrder: (index + 1) * 10
  }));
}

function settingsSignature(
  form: SiteSettings,
  modules: HomeModule[],
  mainNav: EditableLink[],
  frequentNav: EditableLink[]
) {
  return JSON.stringify({ form, modules, mainNav, frequentNav });
}

function settingsDraft(
  form: SiteSettings,
  homeModules: HomeModule[],
  mainNav: EditableLink[],
  frequentNav: EditableLink[]
): SettingsDraft {
  return { form, homeModules, mainNav, frequentNav };
}

function isSettingsDraft(value: unknown): value is SettingsDraft {
  if (!value || typeof value !== "object") return false;
  const draft = value as Partial<SettingsDraft>;
  return (
    Boolean(draft.form && typeof draft.form === "object") &&
    Array.isArray(draft.homeModules) &&
    Array.isArray(draft.mainNav) &&
    Array.isArray(draft.frequentNav)
  );
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

function settingsRequestMessage<T>(
  result: Extract<JsonRequestResult<T>, { ok: false }>,
  fallback: string
) {
  if (result.status === 401) {
    return "登录状态已失效，请先重新登录；当前修改仍保存在本浏览器。";
  }
  return result.message || fallback;
}

export function SettingsForm({
  settings,
  modules,
  mainLinks,
  frequentLinks,
  configVersion
}: {
  settings: SiteSettings;
  modules: HomeModule[];
  mainLinks: NavLink[];
  frequentLinks: NavLink[];
  configVersion: number;
}) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState("");
  const [messageKind, setMessageKind] = useState<"success" | "error">("success");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [version, setVersion] = useState(configVersion);
  const [conflict, setConflict] = useState<SiteConfiguration | null>(null);
  const [form, setForm] = useState(settings);
  const [homeModules, setHomeModules] = useState(
    [...modules].sort((a, b) => a.sortOrder - b.sortOrder)
  );
  const [mainNav, setMainNav] = useState(toEditableLinks(mainLinks));
  const [frequentNav, setFrequentNav] = useState(toEditableLinks(frequentLinks));
  const [savedSignature, setSavedSignature] = useState(() =>
    settingsSignature(
      settings,
      [...modules].sort((a, b) => a.sortOrder - b.sortOrder),
      toEditableLinks(mainLinks),
      toEditableLinks(frequentLinks)
    )
  );
  const [linkIconStates, setLinkIconStates] = useState<Record<string, LinkIconState>>({});
  const [recovery, setRecovery] = useState<{
    kind: Exclude<SettingsDraftRecoveryKind, "none">;
    snapshot: SettingsDraftSnapshot<SettingsDraft>;
  } | null>(null);
  const dirtyRef = useRef(false);
  const allowNavigationRef = useRef(false);
  const versionRef = useRef(version);
  const savedStateRef = useRef<SettingsDraft & { version: number }>({
    ...settingsDraft(
      settings,
      [...modules].sort((a, b) => a.sortOrder - b.sortOrder),
      toEditableLinks(mainLinks),
      toEditableLinks(frequentLinks)
    ),
    version: configVersion
  });

  const enabledModules = useMemo(
    () =>
      [...homeModules]
        .filter((module) => module.enabled)
        .sort((a, b) => a.sortOrder - b.sortOrder),
    [homeModules]
  );
  const currentSignature = useMemo(
    () => settingsSignature(form, homeModules, mainNav, frequentNav),
    [form, frequentNav, homeModules, mainNav]
  );
  const isDirty = currentSignature !== savedSignature;
  const currentDraft = useMemo(
    () => settingsDraft(form, homeModules, mainNav, frequentNav),
    [form, frequentNav, homeModules, mainNav]
  );
  const currentDraftRef = useRef(currentDraft);
  currentDraftRef.current = currentDraft;
  dirtyRef.current = isDirty;
  versionRef.current = version;

  useEffect(() => {
    const snapshot = readSettingsDraft<SettingsDraft>(window.localStorage);
    if (snapshot && !isSettingsDraft(snapshot.draft)) {
      clearSettingsDraft(window.localStorage);
      return;
    }
    const serverDraft = savedStateRef.current;
    const kind = classifySettingsDraft(
      snapshot,
      settingsDraft(
        serverDraft.form,
        serverDraft.homeModules,
        serverDraft.mainNav,
        serverDraft.frequentNav
      ),
      serverDraft.version
    );
    if (snapshot && kind !== "none") {
      setRecovery({ kind, snapshot });
    }
  }, []);

  useEffect(() => {
    if (!isDirty) return;
    const timer = window.setTimeout(() => {
      writeSettingsDraft(
        window.localStorage,
        createSettingsDraftSnapshot({
          sourceVersion: versionRef.current,
          draft: currentDraftRef.current
        })
      );
    }, 500);
    return () => window.clearTimeout(timer);
  }, [currentSignature, isDirty, version]);

  useEffect(() => {
    function persistDraft() {
      if (!dirtyRef.current) return;
      writeSettingsDraft(
        window.localStorage,
        createSettingsDraftSnapshot({
          sourceVersion: versionRef.current,
          draft: currentDraftRef.current
        })
      );
    }

    function warnBeforeUnload(event: BeforeUnloadEvent) {
      if (!dirtyRef.current || allowNavigationRef.current) return;
      persistDraft();
      event.preventDefault();
      event.returnValue = "";
    }

    function guardClientNavigation(event: MouseEvent) {
      if (
        !dirtyRef.current ||
        allowNavigationRef.current ||
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      ) {
        return;
      }
      const source = event.target;
      const anchor =
        source instanceof Element ? source.closest<HTMLAnchorElement>("a[href]") : null;
      if (!anchor || anchor.target === "_blank" || anchor.hasAttribute("download")) {
        return;
      }
      const target = new URL(anchor.href, window.location.href);
      const sameDocument =
        target.origin === window.location.origin &&
        target.pathname === window.location.pathname &&
        target.search === window.location.search;
      if (sameDocument) return;

      event.preventDefault();
      if (!window.confirm("当前设置尚未保存。要保留本地草稿并离开此页吗？")) {
        return;
      }
      persistDraft();
      dirtyRef.current = false;
      allowNavigationRef.current = true;
      window.location.assign(target.href);
    }

    function persistWhenHidden() {
      if (document.visibilityState === "hidden") persistDraft();
    }

    window.addEventListener("beforeunload", warnBeforeUnload);
    document.addEventListener("click", guardClientNavigation, true);
    document.addEventListener("visibilitychange", persistWhenHidden);
    return () => {
      window.removeEventListener("beforeunload", warnBeforeUnload);
      document.removeEventListener("click", guardClientNavigation, true);
      document.removeEventListener("visibilitychange", persistWhenHidden);
    };
  }, []);

  useEffect(() => {
    const locationKey = `${window.location.pathname}${window.location.search}`;
    const currentState =
      window.history.state && typeof window.history.state === "object"
        ? window.history.state as Record<string, unknown>
        : {};
    if (currentState.__manjyunSettingsGuard !== locationKey) {
      window.history.replaceState(
        { ...currentState, __manjyunSettingsBase: locationKey },
        "",
        window.location.href
      );
      window.history.pushState(
        {
          ...currentState,
          __manjyunSettingsGuard: locationKey
        },
        "",
        window.location.href
      );
    }

    function persistCurrentDraft() {
      if (!dirtyRef.current) return;
      writeSettingsDraft(
        window.localStorage,
        createSettingsDraftSnapshot({
          sourceVersion: versionRef.current,
          draft: currentDraftRef.current
        })
      );
    }

    function guardHistoryBack(event: PopStateEvent) {
      if (allowNavigationRef.current) return;
      const state =
        event.state && typeof event.state === "object"
          ? event.state as Record<string, unknown>
          : {};
      handleSettingsHistoryBack({
        isBaseEntry: state.__manjyunSettingsBase === locationKey,
        isDirty: dirtyRef.current,
        persist: persistCurrentDraft,
        confirmLeave: () =>
          window.confirm("当前设置尚未保存。要保留本地草稿并返回上一页吗？"),
        allowNavigation: () => {
          dirtyRef.current = false;
          allowNavigationRef.current = true;
        },
        back: () => window.history.back(),
        forward: () => window.history.forward()
      });
    }

    window.addEventListener("popstate", guardHistoryBack);
    return () => window.removeEventListener("popstate", guardHistoryBack);
  }, []);

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

  function moveModule(index: number, direction: -1 | 1) {
    setHomeModules((current) =>
      normalizeOrder(moveOrderedItem(current, index, direction))
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

  function moveLink(group: "main" | "frequent", index: number, direction: -1 | 1) {
    const setter = group === "main" ? setMainNav : setFrequentNav;
    setter((current) => normalizeOrder(moveOrderedItem(current, index, direction)));
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
      const result = await requestJson<
        { ok: true; iconUrl: string; warning?: string }
      >("/api/admin/link-icon", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
        signal: controller.signal
      }, {
        operation: "read",
        fallbackMessage: "获取图标失败"
      });
      if (!result.ok) {
        updateLinkIconState(localId, {
          status: "error",
          message: controller.signal.aborted
            ? "获取超时，请手动填写图标 URL 或上传图标"
            : settingsRequestMessage(result, "获取图标失败，请稍后重试")
        });
        return;
      }
      const data = result.data;
      updateLink(group, localId, { iconUrl: data.iconUrl });
      updateLinkIconState(localId, {
        status: data.warning ? "error" : "success",
        message: data.warning ?? "已获取网页图标，记得保存设置"
      });
      setMessage(data.warning ?? "已获取网页图标，记得保存设置");
    } catch {
      updateLinkIconState(localId, {
        status: "error",
        message: "获取图标失败，请稍后重试"
      });
    } finally {
      window.clearTimeout(timer);
    }
  }

  async function uploadLinkIcon(group: "main" | "frequent", localId: string, file: File) {
    setMessage("");
    setMessageKind("success");
    if (!file.type.startsWith("image/")) {
      setMessageKind("error");
      setMessage("图标文件需要是图片");
      return;
    }
    const formData = new FormData();
    formData.append("file", file);
    const operationStorageKey = `manjyun:admin-settings:icon-upload:${localId}`;
    const operationPayload = JSON.stringify({
      name: file.name,
      size: file.size,
      type: file.type,
      lastModified: file.lastModified
    });
    const idempotencyKey = persistentOperationKey(
      window.localStorage,
      operationStorageKey,
      operationPayload
    );
    try {
      const result = await requestJson<{
        ok: true;
        media: { url: string };
      }>("/api/admin/media", {
        method: "POST",
        headers: { "Idempotency-Key": idempotencyKey },
        body: formData
      }, {
        operation: "write",
        fallbackMessage: "上传图标失败"
      });
      if (!result.ok) {
        setMessageKind("error");
        if (result.outcome !== "unknown") {
          clearPersistentOperationKey(window.localStorage, operationStorageKey);
        }
        setMessage(
          result.outcome === "unknown"
            ? `${settingsRequestMessage(result, "上传图标结果未知。")} 重新选择同一文件会安全重试，不会重复创建。`
            : settingsRequestMessage(result, "上传图标失败，请稍后重试。")
        );
        return;
      }
      const data = result.data;
      clearPersistentOperationKey(window.localStorage, operationStorageKey);
      updateLink(group, localId, { iconUrl: data.media.url });
      setMessage("图标已上传，记得保存设置");
    } catch {
      setMessageKind("error");
      setMessage("上传图标失败；重新选择同一文件会使用同一请求标识安全重试。");
    }
  }

  function save() {
    setMessage("");
    setMessageKind("success");
    setFieldErrors({});
    setConflict(null);
    startTransition(async () => {
      try {
        const editableSettings = editableSiteSettingKeys.reduce(
          (result, key) => ({ ...result, [key]: form[key] }),
          {} as Record<(typeof editableSiteSettingKeys)[number], string>
        );
        const payload = {
          expectedVersion: version,
          settings: editableSettings,
          modules: normalizeOrder(homeModules),
          mainLinks: toSaveLinks(mainNav),
          frequentLinks: toSaveLinks(frequentNav)
        };
        const result = await requestJson<{
          ok: true;
          configuration: SiteConfiguration;
        }>("/api/admin/settings", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        }, {
          operation: "write",
          fallbackMessage: "保存设置失败"
        });
        if (!result.ok) {
          setMessageKind("error");
          const failure = result.data as {
            fieldErrors?: FieldErrors;
            current?: SiteConfiguration;
          } | null;
          setFieldErrors(failure?.fieldErrors ?? {});
          if (
            result.status === 409 &&
            result.code === "VERSION_CONFLICT" &&
            failure?.current
          ) {
            setConflict(failure.current);
            setMessage("保存冲突：其他标签页已更新设置。当前修改仍保留在本页和浏览器草稿中，尚未写入服务器。");
          } else {
            setMessage(
              `保存失败：${settingsRequestMessage(result, "请稍后重试。")}`
            );
          }
          writeSettingsDraft(
            window.localStorage,
            createSettingsDraftSnapshot({
              sourceVersion: versionRef.current,
              draft: currentDraftRef.current
            })
          );
          return;
        }

        const data = result.data;
        const canonical = data.configuration;
        const canonicalModules = [...canonical.modules].sort(
          (a, b) => a.sortOrder - b.sortOrder
        );
        const canonicalMain = toEditableLinks(canonical.mainLinks);
        const canonicalFrequent = toEditableLinks(canonical.frequentLinks);
        setForm(canonical.settings);
        setHomeModules(canonicalModules);
        setMainNav(canonicalMain);
        setFrequentNav(canonicalFrequent);
        setLinkIconStates({});
        setVersion(canonical.version);
        savedStateRef.current = {
          ...settingsDraft(
            canonical.settings,
            canonicalModules,
            canonicalMain,
            canonicalFrequent
          ),
          version: canonical.version
        };
        dirtyRef.current = false;
        allowNavigationRef.current = false;
        clearSettingsDraft(window.localStorage);
        setRecovery(null);
        setSavedSignature(
          settingsSignature(
            canonical.settings,
            canonicalModules,
            canonicalMain,
            canonicalFrequent
          )
        );
        setMessageKind("success");
        setMessage("设置已保存");
      } catch {
        setMessageKind("error");
        writeSettingsDraft(
          window.localStorage,
          createSettingsDraftSnapshot({
            sourceVersion: versionRef.current,
            draft: currentDraftRef.current
          })
        );
        setMessage("保存失败：客户端处理响应时发生异常；当前草稿仍保存在本浏览器。");
      }
    });
  }

  function loadCurrentConfiguration() {
    if (!conflict) return;
    const nextModules = [...conflict.modules].sort(
      (a, b) => a.sortOrder - b.sortOrder
    );
    const nextMain = toEditableLinks(conflict.mainLinks);
    const nextFrequent = toEditableLinks(conflict.frequentLinks);
    setForm(conflict.settings);
    setHomeModules(nextModules);
    setMainNav(nextMain);
    setFrequentNav(nextFrequent);
    setLinkIconStates({});
    setVersion(conflict.version);
    savedStateRef.current = {
      ...settingsDraft(
        conflict.settings,
        nextModules,
        nextMain,
        nextFrequent
      ),
      version: conflict.version
    };
    dirtyRef.current = false;
    allowNavigationRef.current = false;
    clearSettingsDraft(window.localStorage);
    setRecovery(null);
    setSavedSignature(
      settingsSignature(
        conflict.settings,
        nextModules,
        nextMain,
        nextFrequent
      )
    );
    setConflict(null);
    setFieldErrors({});
    setMessageKind("success");
    setMessage("已载入服务器上的最新设置");
  }

  function recoverLocalSettings() {
    if (!recovery || !isSettingsDraft(recovery.snapshot.draft)) return;
    const draft = recovery.snapshot.draft;
    setForm(draft.form);
    setHomeModules(draft.homeModules);
    setMainNav(draft.mainNav);
    setFrequentNav(draft.frequentNav);
    setVersion(recovery.snapshot.sourceVersion);
    setLinkIconStates({});
    setFieldErrors({});
    setConflict(null);
    setRecovery(null);
    setMessageKind("success");
    setMessage(
      recovery.kind === "stale"
        ? "已恢复旧版本上的本地草稿；保存时会先进行版本冲突检查。"
        : "已恢复本地草稿，尚未写入服务器。"
    );
  }

  function discardRecoveredDraft() {
    clearSettingsDraft(window.localStorage);
    setRecovery(null);
    setMessageKind("success");
    setMessage("已放弃浏览器中的旧设置草稿。");
  }

  function resetUnsavedChanges() {
    const saved = savedStateRef.current;
    setForm(saved.form);
    setHomeModules(saved.homeModules);
    setMainNav(saved.mainNav);
    setFrequentNav(saved.frequentNav);
    setVersion(saved.version);
    setLinkIconStates({});
    setFieldErrors({});
    setConflict(null);
    setRecovery(null);
    dirtyRef.current = false;
    allowNavigationRef.current = false;
    clearSettingsDraft(window.localStorage);
    setSavedSignature(
      settingsSignature(
        saved.form,
        saved.homeModules,
        saved.mainNav,
        saved.frequentNav
      )
    );
    setMessageKind("success");
    setMessage("已清除本地草稿并还原为最近一次保存的设置。");
  }

  return (
    <div className="settings-workbench">
      <div className="settings-stack">
        {recovery ? (
          <section
            className={`admin-notice ${recovery.kind === "stale" ? "error" : "info"}`}
            role="status"
          >
            <strong>
              {recovery.kind === "stale"
                ? "检测到基于旧服务器版本的设置草稿"
                : "检测到未保存的设置草稿"}
            </strong>
            <span>
              {recovery.kind === "stale"
                ? "服务器设置已变化；恢复后保存会触发版本检查，不会静默覆盖新设置。"
                : "可以恢复上次离开前保存在此浏览器中的修改。"}
            </span>
            <div className="btn-row">
              <button className="btn primary" type="button" onClick={recoverLocalSettings}>
                恢复草稿
              </button>
              <button className="btn ghost" type="button" onClick={discardRecoveredDraft}>
                放弃本地副本
              </button>
            </div>
          </section>
        ) : null}
        <nav className="settings-section-nav settings-card" aria-label="设置分区">
          <a href="#settings-general">基础信息</a>
          <a href="#settings-pages">页面文案</a>
          <a href="#settings-home">首页编排</a>
          <a href="#settings-navigation">导航链接</a>
        </nav>
        <section className="settings-card form-grid settings-anchor-section" id="settings-general">
          <div className="settings-section-head">
            <div>
              <h2>基础信息</h2>
              <p>站点身份、公开地址和运行起始时间。</p>
            </div>
          </div>
          <div className="settings-two">
            <div className="field">
              <label htmlFor="settings-site-title">站点标题</label>
              <input id="settings-site-title" className="input" value={form.siteTitle} onChange={(event) => update("siteTitle", event.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="settings-base-url">站点 URL</label>
              <input id="settings-base-url" className="input" value={form.baseUrl} onChange={(event) => update("baseUrl", event.target.value)} />
            </div>
          </div>
          <div className="field">
            <label htmlFor="settings-site-description">站点描述</label>
            <input id="settings-site-description" className="input" value={form.siteDescription} onChange={(event) => update("siteDescription", event.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="settings-uptime-start">Uptime 起始日期</label>
            <input id="settings-uptime-start" className="input" type="date" value={form.uptimeStart} onChange={(event) => update("uptimeStart", event.target.value)} />
          </div>
        </section>

        <section className="settings-card form-grid settings-anchor-section" id="settings-pages">
          <div className="settings-section-head">
            <div>
              <h2>页面文案</h2>
              <p>维护随笔与项目列表页文案；About 和其他独立页面使用统一页面编辑器。</p>
            </div>
            <a className="btn subtle" href="/admin/pages">管理独立页面</a>
          </div>
          <div className="settings-two">
            <div className="field">
              <label htmlFor="settings-blog-title">Blog 页面标题</label>
              <input id="settings-blog-title" className="input" value={form.blogTitle} onChange={(event) => update("blogTitle", event.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="settings-projects-title">Projects 页面标题</label>
              <input id="settings-projects-title" className="input" value={form.projectsTitle} onChange={(event) => update("projectsTitle", event.target.value)} />
            </div>
          </div>
          <div className="settings-two">
            <div className="field">
              <label htmlFor="settings-blog-description">Blog 页面说明</label>
              <textarea id="settings-blog-description" className="textarea compact" value={form.blogDescription} onChange={(event) => update("blogDescription", event.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="settings-projects-description">Projects 页面说明</label>
              <textarea id="settings-projects-description" className="textarea compact" value={form.projectsDescription} onChange={(event) => update("projectsDescription", event.target.value)} />
            </div>
          </div>
        </section>

        <section className="settings-card form-grid settings-anchor-section" id="settings-home">
          <div className="settings-section-head">
            <div>
              <h2>主页模块编排</h2>
              <p>
                开启、关闭、重排首页模块；该顺序用于 DOM、读屏与移动端，宽屏主题可按主栏和侧栏布局。
              </p>
            </div>
          </div>
          <div className="field">
            <label htmlFor="settings-hero-bio">首页简介</label>
            <textarea id="settings-hero-bio" className="textarea compact" value={form.heroBio} onChange={(event) => update("heroBio", event.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="settings-hero-tags">首页标签，逗号分隔</label>
            <input id="settings-hero-tags" className="input" value={form.heroTags} onChange={(event) => update("heroTags", event.target.value)} />
          </div>
          <div className="module-editor-list">
            {homeModules.map((module, index) => (
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
                  <span className="field-label">顺序</span>
                  <div className="order-controls">
                    <button className="icon-btn" type="button" disabled={index === 0} aria-label={`上移 ${moduleLabels[module.id] ?? module.id}`} onClick={() => moveModule(index, -1)}>↑</button>
                    <button className="icon-btn" type="button" disabled={index === homeModules.length - 1} aria-label={`下移 ${moduleLabels[module.id] ?? module.id}`} onClick={() => moveModule(index, 1)}>↓</button>
                  </div>
                </div>
                <div className="field">
                  <label htmlFor={`settings-module-${module.id}-title`}>模块标题</label>
                  <input
                    id={`settings-module-${module.id}-title`}
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
                      <label htmlFor={`settings-module-${module.id}-working-on`}>正在折腾</label>
                      <textarea id={`settings-module-${module.id}-working-on`} className="textarea compact module-long-text" value={configText(module, "workingOn")} onChange={(event) => updateModuleConfig(module.id, "workingOn", event.target.value)} />
                    </div>
                    <div className="field module-field-now-text">
                      <label htmlFor={`settings-module-${module.id}-reading`}>最近在看</label>
                      <textarea id={`settings-module-${module.id}-reading`} className="textarea compact module-long-text" value={configText(module, "reading")} onChange={(event) => updateModuleConfig(module.id, "reading", event.target.value)} />
                    </div>
                    <div className="field">
                      <label htmlFor={`settings-module-${module.id}-completed`}>已完成，逗号分隔</label>
                      <textarea
                        id={`settings-module-${module.id}-completed`}
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
                    <label htmlFor={`settings-module-${module.id}-limit`}>显示数量</label>
                    <input
                      id={`settings-module-${module.id}-limit`}
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
                    <label htmlFor={`settings-module-${module.id}-items`}>Stack 内容，逗号或换行分隔</label>
                    <textarea
                      id={`settings-module-${module.id}-items`}
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

        <section className="settings-card form-grid settings-anchor-section" id="settings-navigation">
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
            onMove={moveLink}
            onFetchIcon={fetchLinkIcon}
            onUploadIcon={uploadLinkIcon}
            iconStates={linkIconStates}
            fieldErrors={fieldErrors}
          />
          <p className="admin-subtitle">
            自定义站内路径可以指向已有公开路由；About 与其他独立页面在“页面”工作台维护。
          </p>
          <EditableLinks
            title="常用链接"
            group="frequent"
            links={frequentNav}
            onUpdate={updateLink}
            onAdd={addLink}
            onRemove={removeLink}
            onMove={moveLink}
            onFetchIcon={fetchLinkIcon}
            onUploadIcon={uploadLinkIcon}
            iconStates={linkIconStates}
            fieldErrors={fieldErrors}
          />
        </section>
      </div>

      <aside className="settings-preview settings-card">
        <div className="settings-section-head">
          <div>
            <h2>主页预览</h2>
            <p>这里显示 DOM、读屏与移动端顺序；宽屏位置由当前主题的主栏/侧栏布局决定。</p>
          </div>
        </div>
        <div className={`mini-browser mini-browser-${form.activeTheme}`} data-preview-theme={form.activeTheme}>
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
        {conflict ? (
          <div className="admin-notice error" role="alert">
            <strong>检测到设置保存冲突</strong>
            <span>
              当前表单保留了你的修改。载入服务器版本会放弃这些修改；需要保留的内容请先复制。
            </span>
            <div className="btn-row">
              <button
                className="btn primary"
                type="button"
                onClick={loadCurrentConfiguration}
              >
                载入服务器最新设置
              </button>
            </div>
          </div>
        ) : null}
        {Object.keys(fieldErrors).length ? (
          <div className="admin-notice error" role="alert">
            <strong>请修正标出的设置</strong>
            <span>{Object.values(fieldErrors).flat().join(" ")}</span>
          </div>
        ) : null}
        <div className="btn-row sticky-actions">
          <button className="btn primary" type="button" disabled={pending || !isDirty} onClick={save}>
            {isDirty ? "保存设置" : "已保存"}
          </button>
          <button
            className="btn ghost"
            type="button"
            disabled={pending || !isDirty}
            onClick={resetUnsavedChanges}
          >
            清除草稿并还原
          </button>
          <span className={messageKind === "error" ? "error-text" : "success-text"}>
            {pending ? "保存中..." : message || (isDirty ? "有未保存修改" : "")}
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
  onMove,
  onFetchIcon,
  onUploadIcon,
  iconStates,
  fieldErrors
}: {
  title: string;
  group: "main" | "frequent";
  links: EditableLink[];
  onUpdate(group: "main" | "frequent", localId: string, patch: Partial<EditableLink>): void;
  onAdd(group: "main" | "frequent"): void;
  onRemove(group: "main" | "frequent", localId: string): void;
  onMove(group: "main" | "frequent", index: number, direction: -1 | 1): void;
  onFetchIcon(group: "main" | "frequent", localId: string, url: string): Promise<void>;
  onUploadIcon(group: "main" | "frequent", localId: string, file: File): Promise<void>;
  iconStates: Record<string, LinkIconState>;
  fieldErrors: FieldErrors;
}) {
  const fieldPrefix = group === "main" ? "mainLinks" : "frequentLinks";
  return (
    <div className="link-editor">
      <div className="link-editor-head">
        <h3>{title}</h3>
        <button className="btn subtle" type="button" onClick={() => onAdd(group)}>
          添加链接
        </button>
      </div>
      {links.map((link, index) => (
        <div className="link-edit-unit" key={link.localId}>
          <div className="link-edit-row">
            <input
              className="input"
              placeholder="名称"
              aria-label={`${title}第 ${index + 1} 项名称`}
              value={link.label}
              aria-invalid={Boolean(fieldErrors[`${fieldPrefix}.${index}.label`])}
              onChange={(event) =>
                onUpdate(group, link.localId, { label: event.target.value })
              }
            />
            <input
              className="input"
              placeholder="/archive 或 https://..."
              aria-label={`${title}第 ${index + 1} 项 URL`}
              value={link.url}
              aria-invalid={Boolean(fieldErrors[`${fieldPrefix}.${index}.url`])}
              onChange={(event) =>
                onUpdate(group, link.localId, { url: event.target.value })
              }
            />
            <div className="order-controls">
              <button className="icon-btn" type="button" disabled={index === 0} aria-label={`上移 ${link.label || "链接"}`} onClick={() => onMove(group, index, -1)}>↑</button>
              <button className="icon-btn" type="button" disabled={index === links.length - 1} aria-label={`下移 ${link.label || "链接"}`} onClick={() => onMove(group, index, 1)}>↓</button>
            </div>
            <button
              className="icon-btn danger"
              type="button"
              aria-label="删除链接"
              onClick={() => onRemove(group, link.localId)}
            >
              ×
            </button>
          </div>
          {[
            ...(fieldErrors[`${fieldPrefix}.${index}.label`] ?? []),
            ...(fieldErrors[`${fieldPrefix}.${index}.url`] ?? [])
          ].map((error) => (
            <small className="error-text" key={error}>{error}</small>
          ))}
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
                aria-label={`${title}第 ${index + 1} 项图标 URL`}
                value={link.iconUrl ?? ""}
                aria-invalid={Boolean(fieldErrors[`${fieldPrefix}.${index}.iconUrl`])}
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
              {(fieldErrors[`${fieldPrefix}.${index}.iconUrl`] ?? []).map((error) => (
                <small className="error-text" key={error}>{error}</small>
              ))}
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}
