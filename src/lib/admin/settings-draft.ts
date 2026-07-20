export const SETTINGS_DRAFT_VERSION = 1 as const;
export const SETTINGS_DRAFT_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
export const SETTINGS_DRAFT_STORAGE_KEY = "manjyun:admin-settings:draft";

export type SettingsDraftSnapshot<T> = {
  version: typeof SETTINGS_DRAFT_VERSION;
  savedAt: number;
  sourceVersion: number;
  draft: T;
};

export type SettingsDraftRecoveryKind = "none" | "recoverable" | "stale";

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function createSettingsDraftSnapshot<T>(input: {
  sourceVersion: number;
  draft: T;
  savedAt?: number;
}): SettingsDraftSnapshot<T> {
  return {
    version: SETTINGS_DRAFT_VERSION,
    savedAt: input.savedAt ?? Date.now(),
    sourceVersion: input.sourceVersion,
    draft: input.draft
  };
}

export function writeSettingsDraft<T>(
  storage: StorageLike,
  snapshot: SettingsDraftSnapshot<T>
) {
  try {
    storage.setItem(SETTINGS_DRAFT_STORAGE_KEY, JSON.stringify(snapshot));
    return true;
  } catch {
    return false;
  }
}

export function clearSettingsDraft(storage: StorageLike) {
  try {
    storage.removeItem(SETTINGS_DRAFT_STORAGE_KEY);
    return true;
  } catch {
    return false;
  }
}

export function readSettingsDraft<T>(
  storage: StorageLike,
  now = Date.now()
) {
  try {
    const raw = storage.getItem(SETTINGS_DRAFT_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<SettingsDraftSnapshot<T>>;
    if (
      parsed.version !== SETTINGS_DRAFT_VERSION ||
      typeof parsed.savedAt !== "number" ||
      typeof parsed.sourceVersion !== "number" ||
      !Number.isSafeInteger(parsed.sourceVersion) ||
      parsed.sourceVersion < 1 ||
      now - parsed.savedAt > SETTINGS_DRAFT_MAX_AGE_MS ||
      now < parsed.savedAt - 60_000 ||
      !parsed.draft ||
      typeof parsed.draft !== "object"
    ) {
      storage.removeItem(SETTINGS_DRAFT_STORAGE_KEY);
      return null;
    }
    return parsed as SettingsDraftSnapshot<T>;
  } catch {
    return null;
  }
}

export function classifySettingsDraft<T>(
  snapshot: SettingsDraftSnapshot<T> | null,
  serverDraft: T,
  serverVersion: number
): SettingsDraftRecoveryKind {
  if (
    !snapshot ||
    JSON.stringify(snapshot.draft) === JSON.stringify(serverDraft)
  ) {
    return "none";
  }
  return snapshot.sourceVersion === serverVersion ? "recoverable" : "stale";
}

export type SettingsHistoryBackResult = "ignored" | "left" | "restored";

export function handleSettingsHistoryBack(input: {
  isBaseEntry: boolean;
  isDirty: boolean;
  persist(): void;
  confirmLeave(): boolean;
  allowNavigation(): void;
  back(): void;
  forward(): void;
}): SettingsHistoryBackResult {
  if (!input.isBaseEntry) return "ignored";
  if (!input.isDirty) {
    input.allowNavigation();
    input.back();
    return "left";
  }

  input.persist();
  if (input.confirmLeave()) {
    input.allowNavigation();
    input.back();
    return "left";
  }
  input.forward();
  return "restored";
}
