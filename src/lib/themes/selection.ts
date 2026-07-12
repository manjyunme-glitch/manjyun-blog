export type ThemeMutationAction = "activate" | "rollback";

export type ThemeMutationDecision =
  | {
      ok: true;
      action: ThemeMutationAction;
      targetTheme: string;
    }
  | {
      ok: false;
      status: 400 | 409;
      error: string;
    };

function readAction(raw: unknown) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const source = raw as Record<string, unknown>;
  const action = source.action;
  if (action !== "activate" && action !== "rollback") return null;
  return {
    action,
    themeId: typeof source.themeId === "string" ? source.themeId.trim() : ""
  };
}

export function resolveThemeMutation(
  raw: unknown,
  selection: { activeTheme: string; previousTheme: string | null },
  availableThemeIds: Iterable<string>
): ThemeMutationDecision {
  const request = readAction(raw);
  if (!request) {
    return { ok: false, status: 400, error: "无效的主题操作。" };
  }

  const available = new Set(availableThemeIds);
  if (request.action === "activate") {
    if (!request.themeId) {
      return { ok: false, status: 400, error: "缺少要激活的主题。" };
    }
    if (!available.has(request.themeId)) {
      return {
        ok: false,
        status: 400,
        error: "该主题未编译进当前版本，或与当前主题 API 不兼容。"
      };
    }
    if (request.themeId === selection.activeTheme) {
      return { ok: false, status: 409, error: "该主题已经处于激活状态。" };
    }
    return {
      ok: true,
      action: "activate",
      targetTheme: request.themeId
    };
  }

  const previousTheme = selection.previousTheme;
  if (!previousTheme || previousTheme === selection.activeTheme) {
    return { ok: false, status: 409, error: "当前没有可回退的主题。" };
  }
  if (!available.has(previousTheme)) {
    return {
      ok: false,
      status: 409,
      error: "上一个主题未编译进当前版本，或已不兼容，无法回退。"
    };
  }
  return {
    ok: true,
    action: "rollback",
    targetTheme: previousTheme
  };
}
