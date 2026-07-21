"use client";

import Link from "next/link";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent
} from "react";
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
import {
  applyMarkdownCommand,
  indentMarkdownSelection,
  markdownShortcutCommand,
  type MarkdownCommand
} from "@/lib/admin/markdown-editor";
import {
  appendMarkdownBlock,
  mediaToMarkdown
} from "@/lib/admin/media-markdown";
import type {
  PostRevision,
  PostRevisionPage,
  PostStatus,
  PostType,
  PostWithTags
} from "@/types/blog";
import { ConfirmDialog } from "@/components/admin/AdminFeedback";
import {
  clearPersistentOperationKey,
  createIdempotencyKey,
  persistentOperationKey,
  requestJson
} from "@/lib/http/client-api";

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

type ConflictState = {
  currentVersion: number | null;
  currentUpdatedAt: string | null;
  draftPreserved: boolean;
};

type WriteErrorResponse = {
  ok: false;
  code?: string;
  error: string;
  current?: {
    id: number;
    version: number;
    updatedAt: string;
  } | null;
};

const emptyRevisions: PostRevision[] = [];

const revisionFilters: Array<{ id: RevisionFilter; label: string }> = [
  { id: "all", label: "全部" },
  { id: "published", label: "已发布" },
  { id: "draft", label: "草稿" }
];

const markdownToolGroups: Array<{
  label: string;
  tools: Array<{
    command: MarkdownCommand;
    label: string;
    title: string;
  }>;
}> = [
  {
    label: "标题与强调",
    tools: [
      { command: "heading2", label: "H2", title: "二级标题" },
      { command: "heading3", label: "H3", title: "三级标题" },
      { command: "bold", label: "加粗", title: "加粗（Ctrl/⌘+B）" },
      { command: "italic", label: "斜体", title: "斜体（Ctrl/⌘+I）" },
      {
        command: "strikethrough",
        label: "删除线",
        title: "删除线（Ctrl/⌘+Shift+X）"
      },
      {
        command: "inlineCode",
        label: "行内代码",
        title: "行内代码（Ctrl/⌘+E）"
      }
    ]
  },
  {
    label: "段落结构",
    tools: [
      { command: "blockquote", label: "引用", title: "引用" },
      { command: "unorderedList", label: "无序列表", title: "无序列表" },
      { command: "orderedList", label: "有序列表", title: "有序列表" },
      { command: "taskList", label: "任务列表", title: "任务列表" },
      { command: "horizontalRule", label: "分隔线", title: "插入分隔线" },
      { command: "table", label: "表格", title: "插入 GFM 表格" }
    ]
  },
  {
    label: "链接与卡片",
    tools: [
      { command: "link", label: "链接", title: "链接（Ctrl/⌘+K）" },
      { command: "image", label: "图片", title: "插入图片 Markdown" },
      { command: "bookmark", label: "书签", title: "插入书签卡片" },
      { command: "audio", label: "音频", title: "插入音频卡片" },
      { command: "callout", label: "提示卡", title: "插入提示卡片" }
    ]
  }
];

const codeLanguageOptions = [
  ["text", "纯文本"],
  ["typescript", "TypeScript"],
  ["tsx", "TSX"],
  ["javascript", "JavaScript"],
  ["jsx", "JSX"],
  ["json", "JSON"],
  ["bash", "Bash / Shell"],
  ["powershell", "PowerShell"],
  ["python", "Python"],
  ["go", "Go"],
  ["rust", "Rust"],
  ["java", "Java"],
  ["kotlin", "Kotlin"],
  ["c", "C"],
  ["css", "CSS"],
  ["html", "HTML"],
  ["markdown", "Markdown"],
  ["yaml", "YAML"],
  ["toml", "TOML"],
  ["ini", "INI"],
  ["sql", "SQL"],
  ["php", "PHP"],
  ["ruby", "Ruby"],
  ["dockerfile", "Dockerfile"],
  ["cpp", "C++"],
  ["csharp", "C#"]
] as const;

const starterMarkdown = `标题字段会作为公开页面唯一的一级标题；正文从段落或二级标题开始即可。

## 小标题

::callout 备注
这里是一段自定义 callout。
::
`;

const pendingCreatedPostStorageKey =
  "manjyun:admin-editor:pending-created-post";

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
  revisionPage,
  backHref = "/admin/posts",
  backLabel = "返回内容列表"
}: {
  post: PostWithTags | null;
  revisions?: PostRevision[];
  revisionPage?: PostRevisionPage;
  backHref?: string;
  backLabel?: string;
}) {
  const initialRevisions = revisionPage?.revisions ?? revisions;
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const markdownInputRef = useRef<HTMLTextAreaElement | null>(null);
  const pendingRef = useRef(false);
  const dirtyRef = useRef(false);
  const editVersionRef = useRef(0);
  const previewSequenceRef = useRef(0);
  const allowNavigationRef = useRef(false);
  const tabExitArmedRef = useRef(false);
  const serverUpdatedAtRef = useRef<string | null>(post?.updatedAt ?? null);
  const serverDraftRef = useRef<Draft>(draftFromPost(post));
  const confirmResolverRef = useRef<((confirmed: boolean) => void) | null>(null);
  const [pending, setPending] = useState(false);
  const [pendingLabel, setPendingLabel] = useState("");
  const [message, setMessage] = useState("");
  const [preview, setPreview] = useState("");
  const [previewState, setPreviewState] = useState<"loading" | "ready" | "error">("loading");
  const [helpOpen, setHelpOpen] = useState(false);
  const [revisionOpen, setRevisionOpen] = useState(false);
  const [draft, setDraft] = useState<Draft>(() => draftFromPost(post));
  const draftRef = useRef(draft);
  const [isDirty, setIsDirty] = useState(false);
  const [draftStorageState, setDraftStorageState] = useState<
    "idle" | "pending" | "saved" | "error"
  >("idle");
  const [viewMode, setViewMode] = useState<EditorViewMode>("split");
  const [codeLanguage, setCodeLanguage] = useState("text");
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
  const [revisionItems, setRevisionItems] = useState<PostRevision[]>(initialRevisions);
  const [revisionTotal, setRevisionTotal] = useState(
    revisionPage?.total ?? initialRevisions.length
  );
  const [revisionHasMore, setRevisionHasMore] = useState(
    revisionPage?.hasMore ?? false
  );
  const [revisionNextCursor, setRevisionNextCursor] = useState<string | null>(
    revisionPage?.nextCursor ?? null
  );
  const [revisionLoading, setRevisionLoading] = useState(false);
  const [revisionFilter, setRevisionFilter] = useState<RevisionFilter>("all");
  const [selectedRevisionId, setSelectedRevisionId] = useState<number | null>(
    initialRevisions[0]?.id ?? null
  );
  const [serverVersion, setServerVersion] = useState<number | null>(
    post?.version ?? null
  );
  const [conflict, setConflict] = useState<ConflictState | null>(null);
  const [uploadRetry, setUploadRetry] = useState<{
    file: File;
    idempotencyKey: string;
  } | null>(null);

  const endpoint = useMemo(
    () => (draft.id ? `/api/admin/posts/${draft.id}` : "/api/admin/posts"),
    [draft.id]
  );

  function persistCurrentDraft() {
    if (!dirtyRef.current) return true;
    const current = draftRef.current;
    const persisted = writeEditorDraft(
      window.localStorage,
      editorDraftStorageKey(current.id ?? post?.id),
      createEditorDraftSnapshot({
        draft: current,
        postId: current.id ?? post?.id ?? null,
        sourceUpdatedAt: serverUpdatedAtRef.current
      })
    );
    setDraftStorageState(persisted ? "saved" : "error");
    return persisted;
  }

  useEffect(() => {
    if (viewMode === "write") return;
    const sequence = ++previewSequenceRef.current;
    const controller = new AbortController();
    setPreviewState("loading");
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch("/api/admin/preview", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: draft.title,
            markdown: draft.markdown
          }),
          signal: controller.signal
        });
        if (!response.ok) {
          if (previewSequenceRef.current === sequence) {
            setPreviewState("error");
          }
          return;
        }
        const data = (await response.json()) as { html: string };
        if (previewSequenceRef.current !== sequence) return;
        setPreview(data.html);
        setPreviewState("ready");
      } catch (error) {
        if (
          (error as Error).name !== "AbortError" &&
          previewSequenceRef.current === sequence
        ) {
          setPreviewState("error");
        }
      }
    }, 220);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [draft.markdown, draft.title, viewMode]);

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
    try {
      const rawPendingId = window.localStorage.getItem(
        pendingCreatedPostStorageKey
      );
      if (!rawPendingId) return;
      const pendingId = Number(rawPendingId);
      if (!Number.isInteger(pendingId) || pendingId < 1) {
        window.localStorage.removeItem(pendingCreatedPostStorageKey);
        return;
      }
      if (post?.id === pendingId) {
        window.localStorage.removeItem(pendingCreatedPostStorageKey);
        return;
      }
      if (post) return;
      const pendingDraft = readEditorDraft<Draft>(
        window.localStorage,
        editorDraftStorageKey(pendingId)
      );
      if (!pendingDraft) {
        window.localStorage.removeItem(pendingCreatedPostStorageKey);
        return;
      }
      window.localStorage.removeItem(pendingCreatedPostStorageKey);
      allowNavigationRef.current = true;
      window.location.replace(`/admin/posts/${pendingId}`);
    } catch {
      // Recovery remains available through the normal new-draft key when storage fails.
    }
  }, [post]);

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
      persistCurrentDraft();
    }, 600);
    return () => window.clearTimeout(timer);
  }, [draft, isDirty]);

  useEffect(() => {
    const nextRevisions = revisionPage?.revisions ?? revisions;
    setRevisionItems(nextRevisions);
    setRevisionTotal(revisionPage?.total ?? nextRevisions.length);
    setRevisionHasMore(revisionPage?.hasMore ?? false);
    setRevisionNextCursor(revisionPage?.nextCursor ?? null);
    setSelectedRevisionId((current) => {
      if (current && nextRevisions.some((revision) => revision.id === current)) {
        return current;
      }
      return nextRevisions[0]?.id ?? null;
    });
  }, [revisionPage, revisions]);

  useEffect(() => {
    function warnBeforeUnload(event: BeforeUnloadEvent) {
      if (!dirtyRef.current || allowNavigationRef.current) return;
      persistCurrentDraft();
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
        event.altKey ||
        !(event.target instanceof Element)
      ) {
        return;
      }
      const anchor = event.target.closest<HTMLAnchorElement>("a[href]");
      if (
        !anchor ||
        anchor.target === "_blank" ||
        anchor.hasAttribute("download") ||
        anchor.hasAttribute("data-editor-navigation-managed")
      ) {
        return;
      }
      const target = new URL(anchor.href, window.location.href);
      if (target.origin !== window.location.origin) return;
      const sameDocument =
        target.pathname === window.location.pathname &&
        target.search === window.location.search &&
        target.hash === window.location.hash;
      if (sameDocument) return;

      event.preventDefault();
      if (!persistCurrentDraft()) {
        setMessage(
          "浏览器无法保存本地草稿，已阻止离开。请先保存到服务器或复制正文。"
        );
        return;
      }
      if (!window.confirm("当前内容尚未保存。要保留本地草稿并离开此页吗？")) {
        return;
      }
      allowNavigationRef.current = true;
      window.location.assign(target.href);
    }

    function persistWhenHidden() {
      if (document.visibilityState === "hidden") persistCurrentDraft();
    }

    window.addEventListener("beforeunload", warnBeforeUnload);
    document.addEventListener("click", guardClientNavigation, true);
    document.addEventListener("visibilitychange", persistWhenHidden);
    window.addEventListener("pagehide", persistCurrentDraft);
    return () => {
      window.removeEventListener("beforeunload", warnBeforeUnload);
      document.removeEventListener("click", guardClientNavigation, true);
      document.removeEventListener("visibilitychange", persistWhenHidden);
      window.removeEventListener("pagehide", persistCurrentDraft);
    };
  }, []);

  useEffect(() => {
    const locationKey = `${window.location.pathname}${window.location.search}`;
    const currentState =
      window.history.state && typeof window.history.state === "object"
        ? window.history.state as Record<string, unknown>
        : {};
    if (currentState.__manjyunEditorGuard !== locationKey) {
      window.history.replaceState(
        { ...currentState, __manjyunEditorBase: locationKey },
        "",
        window.location.href
      );
      window.history.pushState(
        { ...currentState, __manjyunEditorGuard: locationKey },
        "",
        window.location.href
      );
    }

    function guardHistoryBack(event: PopStateEvent) {
      if (allowNavigationRef.current) return;
      const state =
        event.state && typeof event.state === "object"
          ? event.state as Record<string, unknown>
          : {};
      if (state.__manjyunEditorBase !== locationKey) return;
      if (!dirtyRef.current) {
        allowNavigationRef.current = true;
        window.history.back();
        return;
      }
      if (!persistCurrentDraft()) {
        setMessage(
          "浏览器无法保存本地草稿，已留在编辑器。请先保存到服务器或复制正文。"
        );
        window.history.forward();
        return;
      }
      if (window.confirm("当前内容尚未保存。要保留本地草稿并返回上一页吗？")) {
        allowNavigationRef.current = true;
        window.history.back();
      } else {
        window.history.forward();
      }
    }

    window.addEventListener("popstate", guardHistoryBack);
    return () => window.removeEventListener("popstate", guardHistoryBack);
  }, []);

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

  function replaceDraft(next: Draft) {
    draftRef.current = next;
    setDraft(next);
  }

  function mutateDraft(mutator: (current: Draft) => Draft) {
    const next = mutator(draftRef.current);
    replaceDraft(next);
    return next;
  }

  function markDraftDirty() {
    editVersionRef.current += 1;
    dirtyRef.current = true;
    setIsDirty(true);
    setDraftStorageState("pending");
  }

  function update<K extends keyof Draft>(key: K, value: Draft[K]) {
    mutateDraft((current) => ({ ...current, [key]: value }));
    markDraftDirty();
  }

  function applyFormatting(command: MarkdownCommand) {
    const currentDraft = draftRef.current;
    if (currentDraft.status === "trashed") return;
    const input = markdownInputRef.current;
    const start = input?.selectionStart ?? currentDraft.markdown.length;
    const end = input?.selectionEnd ?? start;
    const edit = applyMarkdownCommand(
      currentDraft.markdown,
      start,
      end,
      command,
      { codeLanguage }
    );
    update("markdown", edit.value);
    window.requestAnimationFrame(() => {
      const current = markdownInputRef.current;
      current?.focus();
      current?.setSelectionRange(edit.selectionStart, edit.selectionEnd);
    });
  }

  function handleMarkdownKeyDown(
    event: ReactKeyboardEvent<HTMLTextAreaElement>
  ) {
    if (event.key === "Escape") {
      tabExitArmedRef.current = true;
      return;
    }

    if (event.key === "Tab") {
      if (tabExitArmedRef.current) {
        tabExitArmedRef.current = false;
        return;
      }
      const input = event.currentTarget;
      const edit = indentMarkdownSelection(
        draftRef.current.markdown,
        input.selectionStart,
        input.selectionEnd,
        event.shiftKey
      );
      if (edit.value === draftRef.current.markdown) return;
      event.preventDefault();
      update("markdown", edit.value);
      window.requestAnimationFrame(() => {
        const current = markdownInputRef.current;
        current?.focus();
        current?.setSelectionRange(edit.selectionStart, edit.selectionEnd);
      });
      return;
    }

    tabExitArmedRef.current = false;

    const command = markdownShortcutCommand(event);
    if (!command) return;
    event.preventDefault();
    applyFormatting(command);
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
      allowNavigationRef.current = true;
      router.push(backHref);
      return;
    }
    const persisted = persistCurrentDraft();
    void requestConfirmation({
      title: "放弃未保存的修改？",
      description: persisted
        ? "当前修改已保存在浏览器本地，离开后可回来恢复，但尚未写入服务器。"
        : "浏览器无法保存本地副本。离开会丢失尚未写入服务器的修改，请先复制正文。",
      confirmLabel: persisted ? "保留草稿并离开" : "仍然离开",
      danger: true
    }).then((confirmed) => {
      if (confirmed) {
        allowNavigationRef.current = true;
        router.push(backHref);
      }
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
    replaceDraft(recovery.snapshot.draft);
    markDraftDirty();
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

  async function runPending(
    fallbackMessage: string,
    task: () => Promise<void>,
    operationLabel = "处理中..."
  ) {
    if (pendingRef.current) return;

    pendingRef.current = true;
    setPending(true);
    setPendingLabel(operationLabel);
    try {
      await task();
    } catch (issue) {
      setMessage(issue instanceof Error ? issue.message : fallbackMessage);
    } finally {
      pendingRef.current = false;
      setPending(false);
      setPendingLabel("");
    }
  }

  function preserveDraftForConflict(current?: WriteErrorResponse["current"]) {
    const currentDraft = draftRef.current;
    const draftPreserved = writeEditorDraft(
      window.localStorage,
      editorDraftStorageKey(currentDraft.id ?? post?.id),
      createEditorDraftSnapshot({
        draft: currentDraft,
        postId: currentDraft.id ?? post?.id ?? null,
        sourceUpdatedAt: serverUpdatedAtRef.current
      })
    );
    setDraftStorageState(draftPreserved ? "saved" : "error");
    setConflict({
      currentVersion: current?.version ?? null,
      currentUpdatedAt: current?.updatedAt ?? null,
      draftPreserved
    });
    setMessage(
      draftPreserved
        ? "保存冲突：服务器内容已更新。你的当前草稿已保存在本浏览器，尚未覆盖服务器版本。"
        : "保存冲突：服务器内容已更新，且浏览器无法保存本地副本。请先复制当前内容再重新载入。"
    );
    return draftPreserved;
  }

  function reloadLatestAfterConflict() {
    const preserved = preserveDraftForConflict(
      conflict?.currentVersion
        ? {
            id: draft.id ?? post?.id ?? 0,
            version: conflict.currentVersion,
            updatedAt: conflict.currentUpdatedAt ?? ""
          }
        : null
    );
    if (!preserved) return;
    window.location.reload();
  }

  async function save(status: PostStatus, successMessage?: string) {
    setMessage("");
    setConflict(null);
    const submittedDraft = draftRef.current;
    const submittedEditVersion = editVersionRef.current;
    const wasNew = !submittedDraft.id;
    const targetEndpoint = submittedDraft.id
      ? `/api/admin/posts/${submittedDraft.id}`
      : "/api/admin/posts";
    const payload = {
      ...submittedDraft,
      status,
      ...(submittedDraft.id ? { expectedVersion: serverVersion } : {})
    };
    const body = JSON.stringify(payload);
    const createOperationStorageKey = "manjyun:admin-editor:create-operation";
    const idempotencyKey = wasNew
      ? persistentOperationKey(
          window.localStorage,
          createOperationStorageKey,
          body
        )
      : null;

    await runPending("保存失败", async () => {
      const result = await requestJson<{
        ok: true;
        id: number;
        slug: string;
        version: number;
        updatedAt: string;
        replayed?: boolean;
      }>(
        targetEndpoint,
        {
          method: payload.id ? "PUT" : "POST",
          headers: {
            "Content-Type": "application/json",
            ...(idempotencyKey
              ? { "Idempotency-Key": idempotencyKey }
              : {})
          },
          body
        },
        { fallbackMessage: "保存失败" }
      );
      if (!result.ok) {
        const errorData = result.data as WriteErrorResponse | null;
        if (
          result.status === 409 &&
          result.code === "VERSION_CONFLICT"
        ) {
          preserveDraftForConflict(errorData?.current);
          return;
        }
        setMessage(result.message);
        return;
      }
      const data = result.data;
      const hasNewerEdits = editVersionRef.current !== submittedEditVersion;
      const slugChangedDuringSave =
        draftRef.current.slug !== submittedDraft.slug;
      const nextDraft = {
        ...draftRef.current,
        id: data.id,
        slug: slugChangedDuringSave
          ? draftRef.current.slug
          : data.slug || draftRef.current.slug,
        status
      };
      replaceDraft(nextDraft);
      setServerVersion(data.version);
      serverUpdatedAtRef.current = data.updatedAt;
      serverDraftRef.current = {
        ...submittedDraft,
        id: data.id,
        slug: data.slug || submittedDraft.slug,
        status
      };
      if (wasNew) {
        clearPersistentOperationKey(
          window.localStorage,
          createOperationStorageKey
        );
      }

      if (hasNewerEdits) {
        dirtyRef.current = true;
        setIsDirty(true);
        const persisted = writeEditorDraft(
          window.localStorage,
          editorDraftStorageKey(data.id),
          createEditorDraftSnapshot({
            draft: nextDraft,
            postId: data.id,
            sourceUpdatedAt: data.updatedAt
          })
        );
        if ((wasNew || post === null) && persisted) {
          clearEditorDraft(window.localStorage, editorDraftStorageKey(null));
          try {
            window.localStorage.setItem(
              pendingCreatedPostStorageKey,
              String(data.id)
            );
          } catch {
            // The in-memory draft remains dirty even if crash-recovery metadata cannot persist.
          }
        }
        setDraftStorageState(persisted ? "saved" : "error");
        setMessage(
          persisted
            ? "已保存请求发出时的版本；保存期间产生的新修改仍标记为未保存，并已保存在浏览器。"
            : "已保存请求发出时的版本；保存期间产生的新修改仍未保存，且浏览器无法写入恢复副本，请先复制正文。"
        );
        return;
      }

      dirtyRef.current = false;
      setIsDirty(false);
      setDraftStorageState("idle");
      clearEditorDraft(
        window.localStorage,
        editorDraftStorageKey(submittedDraft.id ?? post?.id)
      );
      clearEditorDraft(window.localStorage, editorDraftStorageKey(data.id));
      if (post === null) {
        clearEditorDraft(window.localStorage, editorDraftStorageKey(null));
      }
      if (wasNew || post === null) {
        try {
          window.localStorage.removeItem(pendingCreatedPostStorageKey);
        } catch {
          // A stale redirect marker is ignored once its draft snapshot has been cleared.
        }
      }
      setMessage(
        data.replayed
          ? "已确认此前的新建请求成功，未创建重复内容"
          : successMessage ?? (status === "published" ? "已发布" : "已保存草稿")
      );
      if (wasNew || post === null) {
        window.location.assign(`/admin/posts/${data.id}`);
      } else {
        router.refresh();
      }
    }, "保存中...");
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
      const result = await requestJson<{ ok: true }>(
        `${endpoint}?permanent=1&expectedVersion=${serverVersion ?? ""}`,
        { method: "DELETE" },
        { fallbackMessage: "删除失败" }
      );
      if (!result.ok) {
        const data = result.data as WriteErrorResponse | null;
        if (
          result.status === 409 &&
          result.code === "VERSION_CONFLICT"
        ) {
          preserveDraftForConflict(data?.current);
          return;
        }
        setMessage(result.message);
        return;
      }
      dirtyRef.current = false;
      setIsDirty(false);
      clearEditorDraft(window.localStorage, editorDraftStorageKey(draft.id));
      router.push("/admin/posts?status=trashed");
    }, "删除中...");
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
    setConflict(null);
    await runPending("操作失败", async () => {
      const result = await requestJson<{
        ok: true;
        status: PostStatus;
        version: number;
        updatedAt: string;
      }>(
        endpoint,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action, expectedVersion: serverVersion })
        },
        { fallbackMessage: "操作失败" }
      );
      if (!result.ok) {
        const data = result.data as WriteErrorResponse | null;
        if (
          result.status === 409 &&
          result.code === "VERSION_CONFLICT"
        ) {
          preserveDraftForConflict(data?.current);
          return;
        }
        setMessage(result.message);
        return;
      }

      const data = result.data;
      replaceDraft({ ...draftRef.current, status: data.status });
      setServerVersion(data.version);
      serverUpdatedAtRef.current = data.updatedAt;
      serverDraftRef.current = {
        ...serverDraftRef.current,
        status: data.status
      };
      setMessage(action === "trash" ? "已移到回收站" : "已恢复为草稿");
      if (action === "trash") {
        if (dirtyRef.current && !persistCurrentDraft()) {
          setMessage(
            "内容已移到回收站，但浏览器无法保存未提交修改；已留在当前页面，请先复制正文。"
          );
          return;
        }
        allowNavigationRef.current = true;
        router.push("/admin/posts?status=trashed");
      } else {
        router.refresh();
      }
    }, action === "trash" ? "正在移到回收站..." : "正在恢复...");
  }

  async function restoreRevision(revisionId: number) {
    const draftAtConfirmation = draftRef.current;
    if (!draftAtConfirmation.id) return;
    const targetRevision = revisionItems.find((revision) => revision.id === revisionId);
    if (!targetRevision) return;
    const confirmed = await requestConfirmation({
      title: `回退到${statusText(targetRevision.status, false)}版本？`,
      description: `${dirtyRef.current ? "当前未保存修改会被覆盖；" : ""}正文、元数据和标签将恢复到所选版本${targetRevision.status !== draftAtConfirmation.status ? `，内容状态也会变为“${statusText(targetRevision.status, false)}”` : ""}。`,
      confirmLabel: "回退版本",
      danger: dirtyRef.current || targetRevision.status !== draftAtConfirmation.status
    });
    if (!confirmed) return;

    setMessage("");
    setConflict(null);
    const submittedDraft = draftRef.current;
    const submittedEditVersion = editVersionRef.current;
    await runPending("回退失败", async () => {
      const result = await requestJson<{
        ok: true;
        post: PostWithTags;
      } & PostRevisionPage>(
        `${endpoint}/revisions`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ revisionId, expectedVersion: serverVersion })
        },
        { fallbackMessage: "回退失败" }
      );
      if (!result.ok) {
        const data = result.data as WriteErrorResponse | null;
        if (
          result.status === 409 &&
          result.code === "VERSION_CONFLICT"
        ) {
          preserveDraftForConflict(data?.current);
          return;
        }
        setMessage(result.message);
        return;
      }

      const data = result.data;
      const restoredDraft = draftFromPost(data.post);
      const currentDraft = draftRef.current;
      const editableKeys: Array<keyof Draft> = [
        "type",
        "title",
        "slug",
        "excerpt",
        "cover",
        "markdown",
        "tags",
        "seoTitle",
        "seoDescription"
      ];
      const changedDuringRequest = editableKeys.filter(
        (key) => currentDraft[key] !== submittedDraft[key]
      );
      const hasNewerEdits =
        editVersionRef.current !== submittedEditVersion &&
        changedDuringRequest.length > 0;
      const nextDraft = hasNewerEdits
        ? changedDuringRequest.reduce(
            (next, key) => ({ ...next, [key]: currentDraft[key] }),
            restoredDraft
          )
        : restoredDraft;

      replaceDraft(nextDraft);
      setServerVersion(data.post.version);
      serverUpdatedAtRef.current = data.post.updatedAt;
      serverDraftRef.current = restoredDraft;
      setRevisionItems(data.revisions);
      setRevisionTotal(data.total);
      setRevisionHasMore(data.hasMore);
      setRevisionNextCursor(data.nextCursor);
      setSelectedRevisionId(data.revisions[0]?.id ?? null);
      if (hasNewerEdits) {
        dirtyRef.current = true;
        setIsDirty(true);
        const persisted = writeEditorDraft(
          window.localStorage,
          editorDraftStorageKey(restoredDraft.id),
          createEditorDraftSnapshot({
            draft: nextDraft,
            postId: restoredDraft.id ?? null,
            sourceUpdatedAt: data.post.updatedAt
          })
        );
        setDraftStorageState(persisted ? "saved" : "error");
        setMessage(
          persisted
            ? `已回退为${statusText(data.post.status, false)}；回退期间输入的新修改仍未保存，并已保存在浏览器。`
            : `已回退为${statusText(data.post.status, false)}；回退期间输入的新修改仍未保存，且浏览器无法写入恢复副本，请先复制正文。`
        );
        return;
      }

      dirtyRef.current = false;
      setIsDirty(false);
      setDraftStorageState("idle");
      clearEditorDraft(
        window.localStorage,
        editorDraftStorageKey(restoredDraft.id)
      );
      setMessage(`已回退为${statusText(data.post.status, false)}`);
      router.refresh();
    }, "正在回退版本...");
  }

  async function upload(file: File, idempotencyKey = createIdempotencyKey()) {
    setMessage("");
    await runPending("上传失败", async () => {
      const formData = new FormData();
      formData.append("file", file);
      const result = await requestJson<{
        ok: true;
        media: { url: string; mime: string; originalName: string };
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
      const data = result.data;
      const url = data.media.url;
      const snippet = mediaToMarkdown(data.media);
      mutateDraft((current) => ({
        ...current,
        cover:
          data.media.mime.startsWith("image/") && !current.cover
            ? url
            : current.cover,
        markdown: appendMarkdownBlock(current.markdown, snippet)
      }));
      markDraftDirty();
      if (data.replayed) {
        setMessage("已确认此前上传成功，未创建重复媒体。");
      }
    }, "上传中...");
  }

  async function loadMoreRevisions() {
    if (!draft.id || !revisionNextCursor || revisionLoading) return;
    setRevisionLoading(true);
    try {
      const params = new URLSearchParams({ cursor: revisionNextCursor });
      const result = await requestJson<{ ok: true } & PostRevisionPage>(
        `${endpoint}/revisions?${params.toString()}`,
        { method: "GET" },
        { fallbackMessage: "加载版本历史失败", operation: "read" }
      );
      if (!result.ok) {
        setMessage(result.message);
        return;
      }

      const data = result.data;
      setRevisionItems((current) => {
        const existingIds = new Set(current.map((revision) => revision.id));
        return [
          ...current,
          ...data.revisions.filter((revision) => !existingIds.has(revision.id))
        ];
      });
      setRevisionTotal(data.total);
      setRevisionHasMore(data.hasMore);
      setRevisionNextCursor(data.nextCursor);
    } finally {
      setRevisionLoading(false);
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
        {conflict ? (
          <section className="admin-notice error" role="alert">
            <strong>服务器版本比当前页面更新</strong>
            <span>
              {conflict.draftPreserved
                ? "当前草稿已保存在浏览器。重新载入后可先查看服务器版本，再用“恢复草稿”取回本地修改并重新保存。"
                : "浏览器暂时无法保存本地副本。请先复制当前内容；重新载入按钮会在本地保存成功后才继续。"}
            </span>
            <div className="btn-row">
              <button
                className="btn primary"
                type="button"
                onClick={reloadLatestAfterConflict}
              >
                重新载入服务器版本
              </button>
            </div>
          </section>
        ) : null}
        <div className="editor-toolbar">
          <div className="editor-statusbar">
            <span className={`status-pill ${draft.status}`}>{statusText(draft.status, !draft.id)}</span>
            <span className="type-pill">{typeText(draft.type)}</span>
            <span className={`chip ${isDirty ? "is-dirty" : ""}`}>{isDirty ? "有未保存修改" : "已保存"}</span>
            {isDirty && draftStorageState !== "idle" ? (
              <span
                className={`chip draft-storage-${draftStorageState}`}
                aria-live="polite"
              >
                {draftStorageState === "pending"
                  ? "本地草稿待备份"
                  : draftStorageState === "saved"
                    ? "本地草稿已备份"
                    : "本地草稿无法备份"}
              </span>
            ) : null}
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
              data-editor-navigation-managed
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
            <button
              className="btn ghost"
              type="button"
              aria-expanded={helpOpen}
              aria-controls="editor-writing-help"
              onClick={() => setHelpOpen((open) => !open)}
            >
              写作帮助
            </button>
          </div>
          <span
            className={
              /失败|无法|冲突|错误/.test(message)
                ? "error-text"
                : "success-text"
            }
            aria-live="polite"
          >
            {pending
              ? pendingLabel || "处理中..."
              : message || (isDirty ? "有未保存的修改" : "")}
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
            <label htmlFor="editor-markdown">Markdown</label>
            <span>{draft.markdown.length} chars</span>
          </div>
          <MarkdownToolbar
            disabled={draft.status === "trashed"}
            codeLanguage={codeLanguage}
            onCodeLanguageChange={setCodeLanguage}
            onCommand={applyFormatting}
          />
          <span id="editor-markdown-keyboard-help" className="visually-hidden">
            Tab 和 Shift+Tab 用于缩进。若要移出正文编辑区，请先按 Escape，再按 Tab。
          </span>
          <textarea
            ref={markdownInputRef}
            id="editor-markdown"
            className="markdown-editor input"
            value={draft.markdown}
            onChange={(event) => update("markdown", event.target.value)}
            onKeyDown={handleMarkdownKeyDown}
            onBlur={() => {
              tabExitArmedRef.current = false;
            }}
            aria-describedby="editor-markdown-keyboard-help"
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
                <span className="chip">
                  {revisionItems.length} / {revisionTotal}
                </span>
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
              inert={!revisionOpen || undefined}
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
                      {visibleRevisions.map((revision) => (
                        <button
                          key={revision.id}
                          className={`revision-item ${selectedRevisionId === revision.id ? "is-active" : ""}`}
                          type="button"
                          aria-pressed={selectedRevisionId === revision.id}
                          onClick={() => setSelectedRevisionId(revision.id)}
                        >
                          <span>
                            <strong>{revisionVersionLabel(revision)}</strong>
                            <small>{formatRevisionTime(revision.createdAt)}</small>
                          </span>
                          <span className={`status-pill ${revision.status}`}>
                            {statusText(revision.status, false)}
                          </span>
                        </button>
                      ))}
                    </div>
                    {revisionHasMore ? (
                      <button
                        className="btn ghost"
                        type="button"
                        disabled={revisionLoading}
                        aria-busy={revisionLoading}
                        onClick={() => void loadMoreRevisions()}
                      >
                        {revisionLoading
                          ? "正在加载更早版本…"
                          : `加载更早版本（已载入 ${revisionItems.length} / ${revisionTotal}）`}
                      </button>
                    ) : revisionTotal > revisionItems.length ? (
                      <p className="field-hint" role="status">
                        服务器版本总量已变化；刷新页面可载入其他标签页刚生成的版本。
                      </p>
                    ) : revisionTotal > 0 ? (
                      <p className="field-hint" role="status">
                        已载入全部 {revisionTotal} 条版本记录。
                      </p>
                    ) : null}
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
            <label htmlFor="editor-slug">Slug</label>
            <input id="editor-slug" className="input" value={draft.slug} disabled={draft.status === "trashed"} onChange={(event) => update("slug", event.target.value)} placeholder={`留空自动生成 ${getContentTypeDefinition(draft.type).slugPrefix}-001`} />
          </div>
          <div className="field">
            <label htmlFor="editor-type">类型</label>
            <select id="editor-type" className="select" value={draft.type} disabled={draft.status === "trashed" || draft.type === "page"} onChange={(event) => update("type", event.target.value as PostType)}>
              {draft.type === "page" ? (
                <option value="page">独立页面</option>
              ) : (
                <>
                  <option value="post">随笔</option>
                  <option value="project">项目</option>
                </>
              )}
            </select>
            <p className="field-hint">
              {draft.type === "page"
                ? "独立页面在“页面”工作台管理；为保持公开路由稳定，类型不可转换。"
                : "独立页面请从“页面”工作台新建和管理。"}
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
            <label htmlFor="editor-excerpt">摘要</label>
            <textarea id="editor-excerpt" className="textarea" value={draft.excerpt} disabled={draft.status === "trashed"} onChange={(event) => update("excerpt", event.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="editor-cover">封面 URL</label>
            <input id="editor-cover" className="input" value={draft.cover} disabled={draft.status === "trashed"} onChange={(event) => update("cover", event.target.value)} />
          </div>
        </section>

        <section className="settings-card form-grid">
          <div className="field">
            <label htmlFor="editor-media-upload">上传图片/音频/文件</label>
            <input
              id="editor-media-upload"
              ref={fileInputRef}
              className="visually-hidden"
              type="file"
              accept="image/jpeg,image/png,image/gif,image/webp,image/avif,image/x-icon,audio/mpeg,audio/wav,audio/ogg,audio/flac,audio/mp4,application/pdf"
              disabled={draft.status === "trashed" || pending}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void upload(file);
                event.currentTarget.value = "";
              }}
            />
            <button className="upload-control" type="button" disabled={draft.status === "trashed" || pending} onClick={() => fileInputRef.current?.click()}>
              <span>选择媒体文件</span>
              <small>图片插入 Markdown，音频插入 audio 卡片；支持 PDF</small>
            </button>
            {uploadRetry ? (
              <button
                className="btn"
                type="button"
                disabled={pending}
                onClick={() =>
                  void upload(uploadRetry.file, uploadRetry.idempotencyKey)
                }
              >
                用同一幂等键重试上传
              </button>
            ) : null}
          </div>
          <p className="admin-subtitle">
            图片会插入 Markdown；音频会插入 <code>[audio:title](url)</code> 卡片语法。
          </p>
        </section>

        <section className="settings-card form-grid">
          <div className="field">
            <label htmlFor="editor-seo-title">SEO 标题</label>
            <input id="editor-seo-title" className="input" value={draft.seoTitle} disabled={draft.status === "trashed"} onChange={(event) => update("seoTitle", event.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="editor-seo-description">SEO 描述</label>
            <textarea id="editor-seo-description" className="textarea" value={draft.seoDescription} disabled={draft.status === "trashed"} onChange={(event) => update("seoDescription", event.target.value)} />
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

function MarkdownToolbar({
  disabled,
  codeLanguage,
  onCodeLanguageChange,
  onCommand
}: {
  disabled: boolean;
  codeLanguage: string;
  onCodeLanguageChange: (language: string) => void;
  onCommand: (command: MarkdownCommand) => void;
}) {
  return (
    <div
      className="markdown-format-toolbar"
      role="toolbar"
      aria-label="Markdown 格式工具栏"
    >
      {markdownToolGroups.map((group) => (
        <div
          key={group.label}
          className="markdown-tool-group"
          role="group"
          aria-label={group.label}
        >
          {group.tools.map((tool) => (
            <button
              key={tool.command}
              className="markdown-tool-button"
              type="button"
              title={tool.title}
              aria-label={tool.title}
              disabled={disabled}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => onCommand(tool.command)}
            >
              {tool.label}
            </button>
          ))}
        </div>
      ))}
      <div
        className="markdown-tool-group markdown-code-tools"
        role="group"
        aria-label="代码块"
      >
        <label htmlFor="editor-code-language">代码语言</label>
        <select
          id="editor-code-language"
          className="markdown-language-select"
          value={codeLanguage}
          disabled={disabled}
          onChange={(event) => onCodeLanguageChange(event.target.value)}
        >
          {codeLanguageOptions.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <button
          className="markdown-tool-button"
          type="button"
          title="插入带语言标记的代码块"
          disabled={disabled}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => onCommand("codeBlock")}
        >
          代码块
        </button>
      </div>
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

function revisionVersionLabel(revision: PostRevision) {
  return `${statusText(revision.status, false)}版本 #${revision.id} · ${revisionReasonText(revision.reason)}`;
}

function formatRevisionTime(input: string) {
  return `${formatDateTime(input)} 北京时间`;
}

function WritingHelp() {
  return (
    <section id="editor-writing-help" className="editor-help settings-card">
      <div className="settings-section-head">
        <div>
          <h2>Markdown 写作速查</h2>
          <p>工具栏和预览使用与公开内容页相同的渲染规则。</p>
        </div>
      </div>
      <div className="help-grid">
        <HelpItem title="正文标题" code={"## 二级标题\n### 三级标题\n\n页面的一级标题使用上方“标题”字段。"} />
        <HelpItem title="列表" code={"- 无序列表\n1. 有序列表\n- [ ] 待办\n- [x] 完成"} />
        <HelpItem title="引用与强调" code={"> 引用内容\n**加粗**  _斜体_\n~~删除线~~\n\n---"} />
        <HelpItem title="代码" code={"`inline code`\n\n```typescript\nconst port = 4482;\n```\n\n支持 C++、C#、TSX、JSON、Shell 等语言。"} />
        <HelpItem title="兼容代码块" code={'普通段落后可直接换行：\n[code:C++]\nint main() {}\n[/code]'} />
        <HelpItem title="链接与图片" code={'[链接文字](https://example.com "可选标题")\n![图片说明](/uploads/image.png "可选标题")'} />
        <HelpItem title="表格" code={"| 名称 | 状态 |\n| :--- | ---: |\n| Blog | ready |"} />
        <HelpItem title="音频卡片" code={'[audio:曲名](/uploads/song.mp3 "可选说明")'} />
        <HelpItem title="书签卡片" code={'[bookmark:标题](https://example.com "可选摘要")'} />
        <HelpItem title="提示卡片" code={"::callout 标题\n这里写提示内容。\n::"} />
        <HelpItem title="引用提示" code={"> [!IMPORTANT]\n> 重要说明\n\n也支持 NOTE、TIP、WARNING、CAUTION。"} />
        <HelpItem title="快捷键" code={"Ctrl/⌘+S 保存\nCtrl/⌘+B 加粗\nCtrl/⌘+I 斜体\nCtrl/⌘+K 链接\nCtrl/⌘+E 行内代码\nCtrl/⌘+Shift+X 删除线\nTab / Shift+Tab 缩进\nEscape 后按 Tab 移出编辑区"} />
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
