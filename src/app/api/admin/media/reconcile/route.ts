import { NextResponse } from "next/server";
import { requireAdminForApi } from "@/lib/auth/session";
import { clientIpFromHeaders } from "@/lib/auth/login-rate-limit";
import { listMedia } from "@/lib/db/queries";
import { apiError } from "@/lib/http/api-response";
import { reconcileMediaStorage } from "@/lib/media/reconcile";
import { MediaStorageError, storageFailureKind } from "@/lib/media/storage";
import { auditLog, auditRequestId } from "@/lib/observability/audit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const admin = await requireAdminForApi();
  if (!admin) return apiError(401, "UNAUTHORIZED", "Unauthorized");
  const auditContext = {
    requestId: auditRequestId(request.headers),
    source: clientIpFromHeaders(request.headers),
    actorId: admin.id
  };

  try {
    const report = await reconcileMediaStorage(listMedia());
    auditLog({
      action: "media.reconcile",
      outcome: "success",
      ...auditContext,
      resourceType: "media-storage",
      detail: {
        databaseRecords: report.databaseRecords,
        managedFiles: report.managedFiles,
        missingCount: report.missingCount,
        orphanedCount: report.orphanedCount,
        transientCount: report.transientCount
      }
    });
    return NextResponse.json({ ok: true, report });
  } catch (error) {
    if (error instanceof MediaStorageError) {
      const kind = storageFailureKind(error);
      auditLog({
        action: "media.reconcile",
        outcome: "failure",
        ...auditContext,
        resourceType: "media-storage",
        code: `STORAGE_${kind.toUpperCase().replace("-", "_")}`
      });
      return apiError(
        kind === "permission" || kind === "io" ? 503 : 500,
        "STORAGE_UNAVAILABLE",
        kind === "permission"
          ? "无法读取 uploads volume；请检查目录权限。"
          : kind === "io"
            ? "读取 uploads volume 时发生 I/O 错误；请检查磁盘。"
            : "无法完成媒体存储对账。"
      );
    }
    auditLog({
      action: "media.reconcile",
      outcome: "failure",
      ...auditContext,
      resourceType: "media-storage",
      code: "RECONCILIATION_FAILED"
    });
    return apiError(500, "WRITE_FAILED", "无法完成媒体存储对账。");
  }
}
