import { NextResponse } from "next/server";
import { requireAdminForApi } from "@/lib/auth/session";
import { clientIpFromHeaders } from "@/lib/auth/login-rate-limit";
import { transaction } from "@/lib/db/client";
import {
  deletePostPermanently,
  getPostById,
  movePostToTrash,
  parseTagsInput,
  restorePostFromTrash,
  savePost,
  setPostStatus,
  VersionConflictError
} from "@/lib/db/queries";
import { isAdminCreatableContentType } from "@/lib/content/content-types";
import type { PostStatus } from "@/types/blog";
import { apiError } from "@/lib/http/api-response";
import {
  executeIdempotently,
  hashIdempotencyPayload,
  IdempotencyCapacityError,
  IdempotencyConflictError,
  IdempotencyInProgressError,
  InvalidIdempotencyKeyError,
  parseIdempotencyKey
} from "@/lib/db/idempotency";
import { auditLog, auditRequestId } from "@/lib/observability/audit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function normalizeBody(body: Record<string, unknown>) {
  const type = String(body.type ?? "post");
  const status = String(body.status ?? "draft") as PostStatus;
  if (!isAdminCreatableContentType(type)) {
    throw new Error("Invalid content type.");
  }
  if (!["draft", "published", "trashed"].includes(status)) {
    throw new Error("Invalid status.");
  }
  return {
    type,
    status,
    title: String(body.title ?? "").trim(),
    slug: String(body.slug ?? "").trim(),
    markdown: String(body.markdown ?? ""),
    excerpt: String(body.excerpt ?? "").trim(),
    cover: String(body.cover ?? "").trim(),
    seoTitle: String(body.seoTitle ?? "").trim(),
    seoDescription: String(body.seoDescription ?? "").trim(),
    tags: parseTagsInput(String(body.tags ?? ""))
  };
}

export async function POST(request: Request) {
  const admin = await requireAdminForApi();
  if (!admin) return apiError(401, "UNAUTHORIZED", "Unauthorized");
  const auditContext = {
    requestId: auditRequestId(request.headers),
    source: clientIpFromHeaders(request.headers),
    actorId: admin.id
  };

  try {
    const idempotencyKey = parseIdempotencyKey(
      request.headers.get("idempotency-key")
    );
    const body = (await request.json()) as Record<string, unknown>;
    const normalized = normalizeBody(body);
    const requestHash = hashIdempotencyPayload(JSON.stringify(normalized));
    const result = executeIdempotently(
      "post:create",
      idempotencyKey,
      requestHash,
      () => {
        const post = savePost(normalized);
        return {
          id: post.id,
          slug: post.slug,
          version: post.version,
          updatedAt: post.updatedAt
        };
      }
    );
    auditLog({
      action: "post.create",
      outcome: "success",
      ...auditContext,
      resourceType: normalized.type,
      resourceId: result.response.id,
      detail: {
        status: normalized.status,
        replayed: result.replayed
      }
    });
    return NextResponse.json({
      ok: true,
      ...result.response,
      replayed: result.replayed
    }, {
      headers: result.replayed ? { "Idempotency-Replayed": "true" } : undefined
    });
  } catch (error) {
    if (error instanceof InvalidIdempotencyKeyError) {
      auditLog({
        action: "post.create",
        outcome: "rejected",
        ...auditContext,
        code: "INVALID_IDEMPOTENCY_KEY"
      });
      return apiError(400, "INVALID_IDEMPOTENCY_KEY", error.message);
    }
    if (error instanceof IdempotencyConflictError) {
      auditLog({
        action: "post.create",
        outcome: "rejected",
        ...auditContext,
        code: "IDEMPOTENCY_CONFLICT"
      });
      return apiError(
        409,
        "IDEMPOTENCY_CONFLICT",
        "该幂等键已用于不同的新建内容；请重新提交当前表单。"
      );
    }
    if (error instanceof IdempotencyInProgressError) {
      auditLog({
        action: "post.create",
        outcome: "rejected",
        ...auditContext,
        code: "IDEMPOTENCY_IN_PROGRESS"
      });
      return apiError(
        409,
        "IDEMPOTENCY_IN_PROGRESS",
        "同一新建请求仍在处理中，请稍后用相同幂等键重试。"
      );
    }
    if (error instanceof IdempotencyCapacityError) {
      auditLog({
        action: "post.create",
        outcome: "failure",
        ...auditContext,
        code: "IDEMPOTENCY_CAPACITY"
      });
      return apiError(
        503,
        "WRITE_FAILED",
        "当前有过多新建请求正在处理，请稍后重试。"
      );
    }
    if (error instanceof SyntaxError) {
      auditLog({
        action: "post.create",
        outcome: "rejected",
        ...auditContext,
        code: "INVALID_JSON"
      });
      return apiError(400, "INVALID_REQUEST", "请求内容不是有效的 JSON。");
    }
    if (
      error instanceof Error &&
      ["Invalid content type.", "Invalid status."].includes(error.message)
    ) {
      auditLog({
        action: "post.create",
        outcome: "rejected",
        ...auditContext,
        code: "VALIDATION_ERROR"
      });
      return apiError(400, "VALIDATION_ERROR", error.message);
    }
    auditLog({
      action: "post.create",
      outcome: "failure",
      ...auditContext,
      code: "WRITE_FAILED"
    });
    return apiError(500, "WRITE_FAILED", "内容创建失败。");
  }
}

export async function PATCH(request: Request) {
  const admin = await requireAdminForApi();
  if (!admin) return apiError(401, "UNAUTHORIZED", "Unauthorized");
  const auditContext = {
    requestId: auditRequestId(request.headers),
    source: clientIpFromHeaders(request.headers),
    actorId: admin.id
  };

  try {
    const body = (await request.json()) as {
      ids?: unknown;
      action?: unknown;
      versions?: unknown;
    };
    const ids = Array.isArray(body.ids)
      ? Array.from(
          new Set(
            body.ids
              .map((id) => Number(id))
              .filter((id) => Number.isInteger(id) && id > 0)
          )
        )
      : [];
    const action = String(body.action ?? "");
    if (!ids.length) {
      auditLog({
        action: "post.batch",
        outcome: "rejected",
        ...auditContext,
        code: "EMPTY_SELECTION"
      });
      return apiError(400, "INVALID_REQUEST", "No posts selected");
    }
    if (!["publish", "unpublish", "trash", "restore", "delete"].includes(action)) {
      auditLog({
        action: "post.batch",
        outcome: "rejected",
        ...auditContext,
        code: "INVALID_ACTION"
      });
      return apiError(400, "INVALID_REQUEST", "Invalid action");
    }
    const versionSource =
      body.versions && typeof body.versions === "object" && !Array.isArray(body.versions)
        ? body.versions as Record<string, unknown>
        : {};
    const versions = new Map(
      ids.map((id) => [id, Number(versionSource[String(id)])])
    );
    if (
      Array.from(versions.values()).some(
        (version) => !Number.isInteger(version) || version < 1
      )
    ) {
      auditLog({
        action: "post.batch",
        outcome: "rejected",
        ...auditContext,
        code: "INVALID_VERSION"
      });
      return apiError(
        400,
        "INVALID_REQUEST",
        "A current version is required for every selected post."
      );
    }

    let count = 0;
    transaction(() => {
      for (const id of ids) {
        const post = getPostById(id);
        if (!post) continue;
        const expectedVersion = versions.get(id)!;

        if (action === "publish") {
          if (setPostStatus(id, "published", expectedVersion)) count += 1;
        } else if (action === "unpublish") {
          if (setPostStatus(id, "draft", expectedVersion)) count += 1;
        } else if (action === "trash") {
          if (movePostToTrash(id, expectedVersion)) count += 1;
        } else if (action === "restore") {
          if (restorePostFromTrash(id, expectedVersion)) count += 1;
        } else if (post.status === "trashed") {
          deletePostPermanently(id, expectedVersion);
          count += 1;
        }
      }
    });

    auditLog({
      action: "post.batch",
      outcome: "success",
      ...auditContext,
      resourceType: "post",
      detail: {
        action,
        requestedCount: ids.length,
        changedCount: count
      }
    });
    return NextResponse.json({ ok: true, count });
  } catch (error) {
    if (error instanceof VersionConflictError) {
      auditLog({
        action: "post.batch",
        outcome: "rejected",
        ...auditContext,
        resourceType: "post",
        resourceId: error.resourceId ?? "unknown",
        code: "VERSION_CONFLICT"
      });
      return apiError(
        409,
        "VERSION_CONFLICT",
        "至少一项内容已被其他页面更新；本次批量操作未执行。",
        {
          current: {
            id: error.resourceId,
            version: error.currentVersion
          }
        }
      );
    }
    auditLog({
      action: "post.batch",
      outcome: error instanceof SyntaxError ? "rejected" : "failure",
      ...auditContext,
      code: error instanceof SyntaxError ? "INVALID_JSON" : "WRITE_FAILED"
    });
    return apiError(
      error instanceof SyntaxError ? 400 : 500,
      error instanceof SyntaxError ? "INVALID_REQUEST" : "WRITE_FAILED",
      error instanceof SyntaxError
        ? "请求内容不是有效的 JSON。"
        : "批量更新失败。"
    );
  }
}
