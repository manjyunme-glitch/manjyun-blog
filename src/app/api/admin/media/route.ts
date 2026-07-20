import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { requireAdminForApi } from "@/lib/auth/session";
import { clientIpFromHeaders } from "@/lib/auth/login-rate-limit";
import { addMedia, listMedia } from "@/lib/db/queries";
import {
  completeReservedIdempotentOperation,
  hashIdempotencyPayload,
  IdempotencyCapacityError,
  IdempotencyConflictError,
  InvalidIdempotencyKeyError,
  parseIdempotencyKey,
  reserveIdempotentOperation
} from "@/lib/db/idempotency";
import { apiError } from "@/lib/http/api-response";
import { RequestBodyTooLargeError } from "@/lib/http/limited-form-data";
import { validateMediaFile } from "@/lib/media/file-validation";
import {
  discardFailedUpload,
  MediaStorageError,
  publishStagedMediaFileAtomically,
  storageFailureKind
} from "@/lib/media/storage";
import {
  acquireMediaUploadSlot,
  discardStagedMediaUpload,
  InvalidMultipartUploadError,
  MediaUploadCapacityError,
  streamMediaUploadToStaging,
  UploadedFileTooLargeError
} from "@/lib/media/streaming-upload";
import type { StagedMediaUpload } from "@/lib/media/streaming-upload";
import type { MediaRecord } from "@/types/blog";
import { auditLog, auditRequestId } from "@/lib/observability/audit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const maxBytes = 50 * 1024 * 1024;
const maxRequestBytes = maxBytes + 1024 * 1024;
const idempotencyScope = "media:upload";

type MediaUploadOperation = Omit<MediaRecord, "id" | "createdAt"> & {
  contentHash: string;
};

type GlobalMediaUploadLocks = typeof globalThis & {
  __manjyunMediaUploadLocks?: Map<string, Promise<void>>;
};

async function withMediaUploadLock<T>(key: string, operation: () => Promise<T>) {
  const globalLocks = globalThis as GlobalMediaUploadLocks;
  const locks = globalLocks.__manjyunMediaUploadLocks ?? new Map();
  globalLocks.__manjyunMediaUploadLocks = locks;
  const previous = locks.get(key);
  if (previous) await previous.catch(() => undefined);

  const running = operation();
  const signal = running.then(
    () => undefined,
    () => undefined
  );
  locks.set(key, signal);
  try {
    return await running;
  } finally {
    if (locks.get(key) === signal) locks.delete(key);
  }
}

function cleanOriginalName(name: string) {
  return name.replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 255) || "upload";
}

function storageApiError(error: MediaStorageError) {
  const kind = storageFailureKind(error);
  if (kind === "no-space") {
    return apiError(
      507,
      "STORAGE_UNAVAILABLE",
      "上传失败：存储空间不足，请释放空间后用同一文件重试。"
    );
  }
  if (kind === "permission") {
    return apiError(
      503,
      "STORAGE_UNAVAILABLE",
      "上传失败：上传目录不可写，请检查 volume 权限后用同一文件重试。"
    );
  }
  if (kind === "io") {
    return apiError(
      503,
      "STORAGE_UNAVAILABLE",
      "上传失败：存储设备发生 I/O 错误，请检查磁盘后用同一文件重试。"
    );
  }
  if (kind === "conflict") {
    return apiError(
      409,
      "IDEMPOTENCY_CONFLICT",
      "上传目标已存在但内容不一致，未覆盖现有文件。"
    );
  }
  return apiError(500, "WRITE_FAILED", "上传失败：无法安全写入媒体文件。");
}

export async function GET() {
  const admin = await requireAdminForApi();
  if (!admin) return apiError(401, "UNAUTHORIZED", "Unauthorized");
  return NextResponse.json({ ok: true, media: listMedia() });
}

export async function POST(request: Request) {
  const admin = await requireAdminForApi();
  if (!admin) return apiError(401, "UNAUTHORIZED", "Unauthorized");
  const auditContext = {
    requestId: auditRequestId(request.headers),
    source: clientIpFromHeaders(request.headers),
    actorId: admin.id,
    resourceType: "media"
  };

  let idempotencyKey: string;
  try {
    idempotencyKey = parseIdempotencyKey(
      request.headers.get("idempotency-key")
    );
  } catch (error) {
    auditLog({
      action: "media.upload",
      outcome: "rejected",
      ...auditContext,
      code:
        error instanceof InvalidIdempotencyKeyError
          ? "INVALID_IDEMPOTENCY_KEY"
          : "INVALID_REQUEST"
    });
    return error instanceof InvalidIdempotencyKeyError
      ? apiError(400, "INVALID_IDEMPOTENCY_KEY", error.message)
      : apiError(400, "INVALID_REQUEST", "上传请求无效。");
  }

  let releaseUploadSlot: (() => void) | null = null;
  try {
    releaseUploadSlot = acquireMediaUploadSlot();
  } catch (error) {
    if (error instanceof MediaUploadCapacityError) {
      await request.body?.cancel().catch(() => undefined);
      auditLog({
        action: "media.upload",
        outcome: "failure",
        ...auditContext,
        code: "UPLOAD_CAPACITY"
      });
      const response = apiError(
        503,
        "WRITE_FAILED",
        "当前同时上传的文件过多，请稍后用同一文件重试。"
      );
      response.headers.set("Retry-After", "5");
      return response;
    }
    throw error;
  }

  let staged: StagedMediaUpload | null = null;
  try {
    try {
      staged = await streamMediaUploadToStaging(request, {
        maxFileBytes: maxBytes,
        maxRequestBytes
      });
    } catch (error) {
      if (error instanceof RequestBodyTooLargeError) {
        auditLog({
          action: "media.upload",
          outcome: "rejected",
          ...auditContext,
          code: "REQUEST_TOO_LARGE"
        });
        return apiError(
          413,
          "INVALID_REQUEST",
          "上传失败：请求体超过 51MB"
        );
      }
      if (error instanceof UploadedFileTooLargeError) {
        auditLog({
          action: "media.upload",
          outcome: "rejected",
          ...auditContext,
          code: "FILE_TOO_LARGE"
        });
        return apiError(
          413,
          "INVALID_REQUEST",
          "上传失败：文件超过 50MB"
        );
      }
      if (error instanceof InvalidMultipartUploadError) {
        const fileRequired = error.reason === "file-required";
        auditLog({
          action: "media.upload",
          outcome: "rejected",
          ...auditContext,
          code: fileRequired ? "FILE_REQUIRED" : "INVALID_MULTIPART"
        });
        return apiError(
          400,
          "INVALID_REQUEST",
          fileRequired
            ? "上传失败：没有收到文件"
            : "上传失败：请求格式无效"
        );
      }
      if (error instanceof MediaStorageError) {
        auditLog({
          action: "media.upload",
          outcome: "failure",
          ...auditContext,
          code: `STORAGE_${storageFailureKind(error).toUpperCase().replace("-", "_")}`
        });
        return storageApiError(error);
      }
      throw error;
    }

    if (staged.size === 0) {
      auditLog({
        action: "media.upload",
        outcome: "rejected",
        ...auditContext,
        code: "EMPTY_FILE"
      });
      return apiError(400, "VALIDATION_ERROR", "上传失败：文件不能为空");
    }

    const validated = validateMediaFile(staged.signature);
    if (!validated) {
      auditLog({
        action: "media.upload",
        outcome: "rejected",
        ...auditContext,
        code: "UNSUPPORTED_MEDIA"
      });
      return apiError(
        415,
        "VALIDATION_ERROR",
        "上传失败：仅支持 JPG、PNG、GIF、WebP、AVIF、ICO、MP3、WAV、OGG、FLAC、M4A 或 PDF"
      );
    }

    const originalName = cleanOriginalName(staged.originalName);
    const contentHash = staged.contentHash;
    const requestHash = hashIdempotencyPayload(
      JSON.stringify({
        contentHash,
        mime: validated.mime,
        originalName,
        size: staged.size
      })
    );

    return await withMediaUploadLock(idempotencyKey, async () => {
      const now = new Date();
      const year = String(now.getFullYear());
      const month = String(now.getMonth() + 1).padStart(2, "0");
      // Include both key and request hash so even an unexpected publish race
      // between different payloads can never target the same final pathname.
      const stableName = crypto
        .createHash("sha256")
        .update(`${idempotencyKey}:${requestHash}`)
        .digest("hex")
        .slice(0, 40);
      const relativeFilename = `${year}/${month}/${stableName}${validated.extension}`;
      const planned: MediaUploadOperation = {
        filename: relativeFilename,
        originalName,
        mime: validated.mime,
        size: staged!.size,
        url: `/uploads/${relativeFilename}`,
        contentHash
      };
      const reservation = reserveIdempotentOperation<
        MediaRecord,
        MediaUploadOperation
      >(idempotencyScope, idempotencyKey, requestHash, planned);
      if (reservation.state === "completed") {
        auditLog({
          action: "media.upload",
          outcome: "success",
          ...auditContext,
          resourceId: reservation.response.id,
          detail: {
            replayed: true,
            size: reservation.response.size
          }
        });
        return NextResponse.json(
          { ok: true, media: reservation.response, replayed: true },
          { headers: { "Idempotency-Replayed": "true" } }
        );
      }

      const writeResult = await publishStagedMediaFileAtomically(
        reservation.operation.filename,
        staged!.temporaryPath,
        contentHash
      );
      try {
        const completed = completeReservedIdempotentOperation(
          idempotencyScope,
          idempotencyKey,
          requestHash,
          () =>
            addMedia({
              filename: reservation.operation.filename,
              originalName: reservation.operation.originalName,
              mime: reservation.operation.mime,
              size: reservation.operation.size,
              url: reservation.operation.url
            })
        );
        auditLog({
          action: "media.upload",
          outcome: "success",
          ...auditContext,
          resourceId: completed.response.id,
          detail: {
            replayed: completed.replayed,
            size: completed.response.size
          }
        });
        return NextResponse.json(
          {
            ok: true,
            media: completed.response,
            replayed: completed.replayed
          },
          {
            headers: completed.replayed
              ? { "Idempotency-Replayed": "true" }
              : undefined
          }
        );
      } catch (error) {
        if (writeResult === "created") {
          await discardFailedUpload(reservation.operation.filename);
        }
        throw error;
      }
    });
  } catch (error) {
    if (error instanceof InvalidIdempotencyKeyError) {
      auditLog({
        action: "media.upload",
        outcome: "rejected",
        ...auditContext,
        code: "INVALID_IDEMPOTENCY_KEY"
      });
      return apiError(400, "INVALID_IDEMPOTENCY_KEY", error.message);
    }
    if (error instanceof IdempotencyConflictError) {
      auditLog({
        action: "media.upload",
        outcome: "rejected",
        ...auditContext,
        code: "IDEMPOTENCY_CONFLICT"
      });
      return apiError(
        409,
        "IDEMPOTENCY_CONFLICT",
        "该幂等键已用于不同文件；没有覆盖或新增媒体。"
      );
    }
    if (error instanceof IdempotencyCapacityError) {
      auditLog({
        action: "media.upload",
        outcome: "failure",
        ...auditContext,
        code: "IDEMPOTENCY_CAPACITY"
      });
      return apiError(
        503,
        "WRITE_FAILED",
        "当前有过多上传正在恢复，请稍后用同一文件重试。"
      );
    }
    if (error instanceof MediaStorageError) {
      auditLog({
        action: "media.upload",
        outcome: "failure",
        ...auditContext,
        code: `STORAGE_${storageFailureKind(error).toUpperCase().replace("-", "_")}`
      });
      return storageApiError(error);
    }
    auditLog({
      action: "media.upload",
      outcome: "failure",
      ...auditContext,
      code: "WRITE_FAILED"
    });
    return apiError(500, "WRITE_FAILED", "上传失败：无法保存媒体记录。");
  } finally {
    if (staged) await discardStagedMediaUpload(staged);
    releaseUploadSlot?.();
  }
}
