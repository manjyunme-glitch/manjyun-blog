export type ThemeMutationAction = "activate" | "rollback";

export type ThemeMutationRequest = {
  action: ThemeMutationAction;
  themeId: string;
  expectedActiveTheme: string;
};

export type ThemeMutationDecision =
  | {
      ok: true;
      action: ThemeMutationAction;
      targetTheme: string;
      expectedActiveTheme: string;
    }
  | {
      ok: false;
      status: 400 | 409;
      error: string;
    };

export function readThemeMutationRequest(
  raw: unknown
): ThemeMutationRequest | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const source = raw as Record<string, unknown>;
  const action = source.action;
  if (action !== "activate" && action !== "rollback") return null;
  return {
    action,
    themeId: typeof source.themeId === "string" ? source.themeId.trim() : "",
    expectedActiveTheme:
      typeof source.expectedActiveTheme === "string"
        ? source.expectedActiveTheme.trim()
        : ""
  };
}

export function resolveThemeMutation(
  raw: unknown,
  selection: { activeTheme: string; previousTheme: string | null },
  availableThemeIds: Iterable<string>
): ThemeMutationDecision {
  const request = readThemeMutationRequest(raw);
  if (!request) {
    return { ok: false, status: 400, error: "无效的主题操作。" };
  }

  const available = new Set(availableThemeIds);
  if (!request.expectedActiveTheme) {
    return {
      ok: false,
      status: 400,
      error: "缺少主题状态版本，请刷新主题页后重试。"
    };
  }

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
      if (
        request.expectedActiveTheme !== request.themeId &&
        selection.previousTheme !== request.expectedActiveTheme
      ) {
        return {
          ok: false,
          status: 409,
          error: "主题状态已经变化，请刷新主题页后重试。"
        };
      }
      return {
        ok: true,
        action: "activate",
        targetTheme: request.themeId,
        expectedActiveTheme: request.expectedActiveTheme
      };
    }
    if (selection.activeTheme !== request.expectedActiveTheme) {
      return {
        ok: false,
        status: 409,
        error: "主题状态已经变化，请刷新主题页后重试。"
      };
    }
    return {
      ok: true,
      action: "activate",
      targetTheme: request.themeId,
      expectedActiveTheme: request.expectedActiveTheme
    };
  }

  if (!request.themeId) {
    return { ok: false, status: 400, error: "缺少要回退的主题。" };
  }
  if (request.themeId === request.expectedActiveTheme) {
    return { ok: false, status: 400, error: "回退目标不能是当前主题。" };
  }
  if (!available.has(request.themeId)) {
    return {
      ok: false,
      status: 409,
      error: "上一个主题未编译进当前版本，或已不兼容，无法回退。"
    };
  }
  if (
    selection.activeTheme === request.themeId &&
    selection.previousTheme === request.expectedActiveTheme
  ) {
    return {
      ok: true,
      action: "rollback",
      targetTheme: request.themeId,
      expectedActiveTheme: request.expectedActiveTheme
    };
  }
  if (selection.activeTheme !== request.expectedActiveTheme) {
    return {
      ok: false,
      status: 409,
      error: "主题状态已经变化，请刷新主题页后重试。"
    };
  }
  if (
    !selection.previousTheme ||
    selection.previousTheme !== request.themeId
  ) {
    return { ok: false, status: 409, error: "当前没有可回退的主题。" };
  }
  return {
    ok: true,
    action: "rollback",
    targetTheme: request.themeId,
    expectedActiveTheme: request.expectedActiveTheme
  };
}
