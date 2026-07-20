import { NextRequest, NextResponse } from "next/server";
import { requireAdminForApi } from "@/lib/auth/session";
import { clientIpFromHeaders } from "@/lib/auth/login-rate-limit";
import {
  deleteMediaRecord,
  findMediaReferences,
  getMediaById,
  MediaInUseError,
  type MediaReference
} from "@/lib/db/queries";
import { apiError } from "@/lib/http/api-response";
import {
  commitStagedMediaDeletion,
  MediaStorageError,
  rollbackStagedMediaDeletion,
  stageMediaDeletion,
  storageFailureKind,
  type StagedMediaDeletion
} from "@/lib/media/storage";
import { auditLog, auditRequestId } from "@/lib/observability/audit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function referenceDetails(references: MediaReference[]) {
  return {
    referenceCount: references.length,
    references: references.slice(0, 100),
    referencesTruncated: references.length > 100
  };
}

function storageDeleteError(error: MediaStorageError) {
  const kind = storageFailureKind(error);
  if (kind === "permission") {
    return apiError(
      503,
      "STORAGE_UNAVAILABLE",
      "删除失败：上传目录不可写，媒体记录和公开文件均未删除。"
    );
  }
  if (kind === "io") {
    return apiError(
      503,
      "STORAGE_UNAVAILABLE",
      "删除失败：存储设备发生 I/O 错误，媒体记录和公开文件均未删除。"
    );
  }
  return apiError(
    500,
    "WRITE_FAILED",
    "删除失败：无法安全移动媒体文件，媒体记录未删除。"
  );
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const admin = await requireAdminForApi();
  if (!admin) return apiError(401, "UNAUTHORIZED", "Unauthorized");
  const auditContext = {
    requestId: auditRequestId(request.headers),
    source: clientIpFromHeaders(request.headers),
    actorId: admin.id,
    resourceType: "media"
  };

  const { id: rawId } = await params;
  const id = Number(rawId);
  if (!Number.isInteger(id) || id < 1) {
    return apiError(400, "INVALID_REQUEST", "媒体 ID 无效。");
  }
  const media = getMediaById(id);
  if (!media) return apiError(404, "NOT_FOUND", "媒体不存在。");

  const allowReferenced = request.nextUrl.searchParams.get("force") === "1";
  const initialReferences = findMediaReferences(media.url);
  if (initialReferences.length && !allowReferenced) {
    auditLog({
      action: "media.delete",
      outcome: "rejected",
      ...auditContext,
      resourceId: id,
      code: "MEDIA_IN_USE",
      detail: { referenceCount: initialReferences.length }
    });
    return apiError(
      409,
      "MEDIA_IN_USE",
      "该媒体仍被内容或站点配置引用，默认不会删除。",
      referenceDetails(initialReferences)
    );
  }

  let staged: StagedMediaDeletion;
  try {
    staged = await stageMediaDeletion(media.filename);
  } catch (error) {
    auditLog({
      action: "media.delete",
      outcome: "failure",
      ...auditContext,
      resourceId: id,
      code:
        error instanceof MediaStorageError
          ? `STORAGE_${storageFailureKind(error).toUpperCase().replace("-", "_")}`
          : "STORAGE_INSPECTION_FAILED"
    });
    return error instanceof MediaStorageError
      ? storageDeleteError(error)
      : apiError(500, "WRITE_FAILED", "删除失败：无法检查媒体文件。");
  }

  let deleted: ReturnType<typeof deleteMediaRecord>;
  try {
    deleted = deleteMediaRecord(id, { allowReferenced });
    if (!deleted) {
      await rollbackStagedMediaDeletion(staged);
      auditLog({
        action: "media.delete",
        outcome: "rejected",
        ...auditContext,
        resourceId: id,
        code: "NOT_FOUND"
      });
      return apiError(404, "NOT_FOUND", "媒体不存在。");
    }
  } catch (error) {
    try {
      await rollbackStagedMediaDeletion(staged);
    } catch {
      auditLog({
        action: "media.delete",
        outcome: "failure",
        ...auditContext,
        resourceId: id,
        code: "ROLLBACK_FAILED"
      });
      return apiError(
        500,
        "WRITE_FAILED",
        "数据库删除未执行，但媒体文件恢复失败；请运行存储对账并检查磁盘。"
      );
    }
    if (error instanceof MediaInUseError) {
      auditLog({
        action: "media.delete",
        outcome: "rejected",
        ...auditContext,
        resourceId: id,
        code: "MEDIA_IN_USE",
        detail: { referenceCount: error.references.length }
      });
      return apiError(
        409,
        "MEDIA_IN_USE",
        "删除期间出现了新的媒体引用，文件已恢复且记录未删除。",
        referenceDetails(error.references)
      );
    }
    auditLog({
      action: "media.delete",
      outcome: "failure",
      ...auditContext,
      resourceId: id,
      code: "DATABASE_DELETE_FAILED"
    });
    return apiError(
      500,
      "WRITE_FAILED",
      "删除失败：数据库记录未删除，媒体文件已恢复。"
    );
  }

  const cleaned = await commitStagedMediaDeletion(staged);
  auditLog({
    action: "media.delete",
    outcome: "success",
    ...auditContext,
    resourceId: id,
    detail: {
      forced: allowReferenced,
      forcedReferenceCount: allowReferenced ? deleted.references.length : 0,
      fileMissing: staged.state === "missing",
      cleanupPending: !cleaned
    }
  });
  return NextResponse.json({
    ok: true,
    id,
    fileMissing: staged.state === "missing",
    cleanupPending: !cleaned,
    forcedReferenceCount: allowReferenced ? deleted.references.length : 0,
    warning: !cleaned
      ? "媒体已从公开路径和数据库删除，但隐藏暂存文件仍存在；请先用存储对账定位，再在停服后手动清理。"
      : undefined
  });
}
