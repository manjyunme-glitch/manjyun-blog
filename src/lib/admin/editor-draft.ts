export const EDITOR_DRAFT_VERSION = 1 as const;
export const EDITOR_DRAFT_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export type EditorDraftSnapshot<T> = {
  version: typeof EDITOR_DRAFT_VERSION;
  savedAt: number;
  postId: number | null;
  sourceUpdatedAt: string | null;
  draft: T;
};

export type DraftRecoveryKind = "none" | "recoverable" | "stale";

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function editorDraftStorageKey(postId: number | null | undefined) {
  return `manjyun:admin-editor:draft:${postId ?? "new"}`;
}

export function createEditorDraftSnapshot<T>(input: {
  draft: T;
  postId?: number | null;
  sourceUpdatedAt?: string | null;
  savedAt?: number;
}): EditorDraftSnapshot<T> {
  return {
    version: EDITOR_DRAFT_VERSION,
    savedAt: input.savedAt ?? Date.now(),
    postId: input.postId ?? null,
    sourceUpdatedAt: input.sourceUpdatedAt ?? null,
    draft: input.draft
  };
}

export function writeEditorDraft<T>(storage: StorageLike, key: string, snapshot: EditorDraftSnapshot<T>) {
  try {
    storage.setItem(key, JSON.stringify(snapshot));
    return true;
  } catch {
    return false;
  }
}

export function clearEditorDraft(storage: StorageLike, key: string) {
  try {
    storage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

export function readEditorDraft<T>(storage: StorageLike, key: string, now = Date.now()) {
  try {
    const raw = storage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<EditorDraftSnapshot<T>>;
    if (
      parsed.version !== EDITOR_DRAFT_VERSION ||
      typeof parsed.savedAt !== "number" ||
      now - parsed.savedAt > EDITOR_DRAFT_MAX_AGE_MS ||
      now < parsed.savedAt - 60_000 ||
      !parsed.draft ||
      typeof parsed.draft !== "object"
    ) {
      storage.removeItem(key);
      return null;
    }
    return parsed as EditorDraftSnapshot<T>;
  } catch {
    return null;
  }
}

export function classifyEditorDraft<T>(
  snapshot: EditorDraftSnapshot<T> | null,
  serverDraft: T,
  serverUpdatedAt: string | null
): DraftRecoveryKind {
  if (!snapshot || JSON.stringify(snapshot.draft) === JSON.stringify(serverDraft)) return "none";
  if (snapshot.sourceUpdatedAt !== serverUpdatedAt) return "stale";
  return "recoverable";
}
