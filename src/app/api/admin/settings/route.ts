import { NextResponse } from "next/server";
import { requireAdminForApi } from "@/lib/auth/session";
import {
  getSiteConfiguration,
  updateSiteConfiguration,
  VersionConflictError
} from "@/lib/db/queries";
import { validateSiteConfigurationPayload } from "@/lib/admin/settings-validation";
import { clientIpFromHeaders } from "@/lib/auth/login-rate-limit";
import { apiError } from "@/lib/http/api-response";
import { auditLog, auditRequestId } from "@/lib/observability/audit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function PUT(request: Request) {
  const admin = await requireAdminForApi();
  if (!admin) return apiError(401, "UNAUTHORIZED", "Unauthorized");
  const auditContext = {
    requestId: auditRequestId(request.headers),
    source: clientIpFromHeaders(request.headers),
    actorId: admin.id
  };

  try {
    const body = (await request.json()) as Record<string, unknown>;
    const expectedVersion = Number(body.expectedVersion);
    if (!Number.isInteger(expectedVersion) || expectedVersion < 1) {
      auditLog({
        action: "settings.update",
        outcome: "rejected",
        ...auditContext,
        code: "INVALID_VERSION"
      });
      return apiError(
        400,
        "INVALID_REQUEST",
        "A valid expectedVersion is required.",
        {
          fieldErrors: {
            expectedVersion: ["保存版本无效，请重新载入设置页后再试。"]
          }
        }
      );
    }

    const validated = validateSiteConfigurationPayload(body);
    if (!validated.ok) {
      auditLog({
        action: "settings.update",
        outcome: "rejected",
        ...auditContext,
        code: "VALIDATION_ERROR"
      });
      return apiError(
        400,
        "VALIDATION_ERROR",
        validated.issues[0] ?? "设置校验失败。",
        {
          issues: validated.issues,
          fieldErrors: validated.fieldErrors
        }
      );
    }

    const configuration = updateSiteConfiguration(
      validated.value,
      expectedVersion
    );
    auditLog({
      action: "settings.update",
      outcome: "success",
      ...auditContext,
      resourceType: "site-configuration",
      resourceId: configuration.version
    });
    return NextResponse.json({ ok: true, configuration });
  } catch (error) {
    if (error instanceof VersionConflictError) {
      auditLog({
        action: "settings.update",
        outcome: "rejected",
        ...auditContext,
        code: "VERSION_CONFLICT"
      });
      return apiError(
        409,
        "VERSION_CONFLICT",
        "设置已在其他标签页更新；当前修改尚未保存。",
        { current: getSiteConfiguration() }
      );
    }
    if (error instanceof SyntaxError) {
      auditLog({
        action: "settings.update",
        outcome: "rejected",
        ...auditContext,
        code: "INVALID_JSON"
      });
      return apiError(400, "INVALID_REQUEST", "请求内容不是有效的 JSON。");
    }
    auditLog({
      action: "settings.update",
      outcome: "failure",
      ...auditContext,
      code: "WRITE_FAILED"
    });
    return apiError(
      500,
      "WRITE_FAILED",
      "保存设置失败。"
    );
  }
}
