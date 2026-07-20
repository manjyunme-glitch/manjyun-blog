import { NextResponse } from "next/server";
import { requireAdminForApi } from "@/lib/auth/session";
import { clientIpFromHeaders } from "@/lib/auth/login-rate-limit";
import {
  activateTheme,
  getThemeSelection,
  rollbackTheme,
  ThemeSelectionConflictError
} from "@/lib/db/queries";
import {
  readThemeMutationRequest,
  resolveThemeMutation,
  type ThemeMutationDecision
} from "@/lib/themes/selection";
import {
  executeIdempotently,
  hashIdempotencyPayload,
  IdempotencyCapacityError,
  IdempotencyConflictError,
  IdempotencyInProgressError,
  InvalidIdempotencyKeyError,
  parseIdempotencyKey
} from "@/lib/db/idempotency";
import {
  apiError,
  type ApiErrorCode
} from "@/lib/http/api-response";
import { auditLog, auditRequestId } from "@/lib/observability/audit";
import { getThemes } from "@/themes";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RejectedThemeDecision = Extract<ThemeMutationDecision, { ok: false }>;

class ThemeMutationRejectedError extends Error {
  constructor(readonly decision: RejectedThemeDecision) {
    super(decision.error);
    this.name = "ThemeMutationRejectedError";
  }
}

class ThemeRollbackUnavailableError extends Error {
  constructor() {
    super("No matching theme rollback is available.");
    this.name = "ThemeRollbackUnavailableError";
  }
}

export async function POST(request: Request) {
  const admin = await requireAdminForApi();
  if (!admin) {
    return apiError(401, "UNAUTHORIZED", "Unauthorized");
  }
  const auditContext = {
    requestId: auditRequestId(request.headers),
    source: clientIpFromHeaders(request.headers),
    actorId: admin.id
  };

  try {
    const idempotencyKey = parseIdempotencyKey(
      request.headers.get("idempotency-key")
    );
    const body = await request.json() as unknown;
    const normalized = readThemeMutationRequest(body);
    if (!normalized) {
      throw new ThemeMutationRejectedError({
        ok: false,
        status: 400,
        error: "无效的主题操作。"
      });
    }
    const availableThemeIds = getThemes().map((theme) => theme.meta.id);
    const requestHash = hashIdempotencyPayload(JSON.stringify(normalized));
    const result = executeIdempotently(
      "theme:select",
      idempotencyKey,
      requestHash,
      () => {
        const decision = resolveThemeMutation(
          normalized,
          getThemeSelection(),
          availableThemeIds
        );
        if (!decision.ok) {
          throw new ThemeMutationRejectedError(decision);
        }
        const selection = decision.action === "rollback"
          ? rollbackTheme(
              decision.targetTheme,
              decision.expectedActiveTheme
            )
          : activateTheme(
              decision.targetTheme,
              decision.expectedActiveTheme
            );
        if (!selection) throw new ThemeRollbackUnavailableError();
        return {
          ok: true as const,
          action: decision.action,
          activeTheme: selection.activeTheme,
          previousTheme: selection.previousTheme
        };
      }
    );

    auditLog({
      action: "theme.select",
      outcome: "success",
      ...auditContext,
      resourceType: "theme",
      resourceId: result.response.activeTheme,
      detail: {
        mutation: result.response.action,
        replayed: result.replayed
      }
    });
    return NextResponse.json(result.response, {
      headers: result.replayed
        ? { "Idempotency-Replayed": "true" }
        : undefined
    });
  } catch (error) {
    let status = 500;
    let code = "THEME_WRITE_FAILED";
    let apiCode: ApiErrorCode = "WRITE_FAILED";
    let message = "主题切换失败。";
    let outcome: "rejected" | "failure" = "failure";

    if (error instanceof InvalidIdempotencyKeyError) {
      status = 400;
      code = "INVALID_IDEMPOTENCY_KEY";
      apiCode = "INVALID_IDEMPOTENCY_KEY";
      message = error.message;
      outcome = "rejected";
    } else if (error instanceof IdempotencyConflictError) {
      status = 409;
      code = "IDEMPOTENCY_CONFLICT";
      apiCode = "IDEMPOTENCY_CONFLICT";
      message = error.message;
      outcome = "rejected";
    } else if (error instanceof IdempotencyInProgressError) {
      status = 409;
      code = "IDEMPOTENCY_IN_PROGRESS";
      apiCode = "IDEMPOTENCY_IN_PROGRESS";
      message = error.message;
      outcome = "rejected";
    } else if (error instanceof IdempotencyCapacityError) {
      status = 503;
      code = "IDEMPOTENCY_CAPACITY";
      message = error.message;
    } else if (error instanceof ThemeMutationRejectedError) {
      status = error.decision.status;
      code = "INVALID_THEME_MUTATION";
      apiCode =
        error.decision.status === 400
          ? "VALIDATION_ERROR"
          : "VERSION_CONFLICT";
      message = error.decision.error;
      outcome = "rejected";
    } else if (error instanceof ThemeSelectionConflictError) {
      status = 409;
      code = "THEME_SELECTION_CONFLICT";
      apiCode = "VERSION_CONFLICT";
      message = "主题状态已经变化，请刷新主题页后重试。";
      outcome = "rejected";
    } else if (error instanceof ThemeRollbackUnavailableError) {
      status = 409;
      code = "ROLLBACK_UNAVAILABLE";
      apiCode = "VERSION_CONFLICT";
      message = "当前没有可回退的主题。";
      outcome = "rejected";
    } else if (error instanceof SyntaxError) {
      status = 400;
      code = "INVALID_JSON";
      apiCode = "INVALID_REQUEST";
      message = "主题操作请求不是合法 JSON。";
      outcome = "rejected";
    }

    auditLog({
      action: "theme.select",
      outcome,
      ...auditContext,
      code
    });
    return apiError(status, apiCode, message);
  }
}
