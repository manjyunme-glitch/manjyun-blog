import { NextResponse } from "next/server";
import { requireAdminForApi } from "@/lib/auth/session";
import { clientIpFromHeaders } from "@/lib/auth/login-rate-limit";
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
import {
  canAdminChangeContentType,
  isContentType
} from "@/lib/content/content-types";
import type { PostStatus, PostType } from "@/types/blog";
import { apiError } from "@/lib/http/api-response";
import { auditLog, auditRequestId } from "@/lib/observability/audit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function expectedVersionFrom(value: unknown) {
  const version = Number(value);
  return Number.isInteger(version) && version >= 1 ? version : null;
}

function normalizeBody(
  id: number,
  expectedVersion: number,
  body: Record<string, unknown>,
  existingType: PostType
) {
  const type = String(body.type ?? existingType);
  const status = String(body.status ?? "draft") as PostStatus;
  if (!isContentType(type)) {
    throw new Error("Invalid content type.");
  }
  if (!canAdminChangeContentType(existingType, type)) {
    throw new Error("This system content type cannot be changed.");
  }
  if (!["draft", "published", "trashed"].includes(status)) {
    throw new Error("Invalid status.");
  }
  return {
    id,
    expectedVersion,
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

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const admin = await requireAdminForApi();
  if (!admin) return apiError(401, "UNAUTHORIZED", "Unauthorized");
  const auditContext = {
    requestId: auditRequestId(request.headers),
    source: clientIpFromHeaders(request.headers),
    actorId: admin.id,
    resourceType: "post"
  };

  const { id: rawId } = await params;
  const id = Number(rawId);
  const existing = getPostById(id);
  if (!existing) {
    return apiError(404, "NOT_FOUND", "Not found");
  }

  try {
    const body = (await request.json()) as Record<string, unknown>;
    const expectedVersion = expectedVersionFrom(body.expectedVersion);
    if (expectedVersion === null) {
      auditLog({
        action: "post.update",
        outcome: "rejected",
        ...auditContext,
        resourceId: id,
        code: "INVALID_VERSION"
      });
      return apiError(
        400,
        "INVALID_REQUEST",
        "A valid expectedVersion is required."
      );
    }
    const post = savePost(
      normalizeBody(id, expectedVersion, body, existing.type)
    );
    auditLog({
      action: "post.update",
      outcome: "success",
      ...auditContext,
      resourceType: post.type,
      resourceId: post.id,
      detail: { status: post.status, version: post.version }
    });
    return NextResponse.json({
      ok: true,
      id: post.id,
      slug: post.slug,
      version: post.version,
      updatedAt: post.updatedAt
    });
  } catch (error) {
    if (error instanceof VersionConflictError) {
      auditLog({
        action: "post.update",
        outcome: "rejected",
        ...auditContext,
        resourceId: id,
        code: "VERSION_CONFLICT"
      });
      const current = getPostById(id);
      return apiError(
        409,
        "VERSION_CONFLICT",
        "内容已在其他标签页更新；当前修改尚未保存。",
        {
          current: current
            ? { id: current.id, version: current.version, updatedAt: current.updatedAt }
            : null
        }
      );
    }
    if (error instanceof SyntaxError) {
      auditLog({
        action: "post.update",
        outcome: "rejected",
        ...auditContext,
        resourceId: id,
        code: "INVALID_JSON"
      });
      return apiError(400, "INVALID_REQUEST", "请求内容不是有效的 JSON。");
    }
    if (
      error instanceof Error &&
      [
        "Invalid content type.",
        "This system content type cannot be changed.",
        "Invalid status."
      ].includes(error.message)
    ) {
      auditLog({
        action: "post.update",
        outcome: "rejected",
        ...auditContext,
        resourceId: id,
        code: "VALIDATION_ERROR"
      });
      return apiError(400, "VALIDATION_ERROR", error.message);
    }
    auditLog({
      action: "post.update",
      outcome: "failure",
      ...auditContext,
      resourceId: id,
      code: "WRITE_FAILED"
    });
    return apiError(500, "WRITE_FAILED", "内容保存失败。");
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const admin = await requireAdminForApi();
  if (!admin) return apiError(401, "UNAUTHORIZED", "Unauthorized");
  const auditContext = {
    requestId: auditRequestId(request.headers),
    source: clientIpFromHeaders(request.headers),
    actorId: admin.id,
    resourceType: "post"
  };

  const { id: rawId } = await params;
  const id = Number(rawId);
  const post = getPostById(id);
  if (!post) {
    return apiError(404, "NOT_FOUND", "Not found");
  }

  try {
    const body = (await request.json()) as {
      action?: string;
      expectedVersion?: unknown;
    };
    const action = String(body.action ?? "");
    const expectedVersion = expectedVersionFrom(body.expectedVersion);
    if (expectedVersion === null) {
      auditLog({
        action: "post.status",
        outcome: "rejected",
        ...auditContext,
        resourceId: id,
        code: "INVALID_VERSION"
      });
      return apiError(
        400,
        "INVALID_REQUEST",
        "A valid expectedVersion is required."
      );
    }
    const next =
      action === "publish"
        ? setPostStatus(id, "published", expectedVersion)
        : action === "unpublish"
          ? setPostStatus(id, "draft", expectedVersion)
          : action === "trash"
            ? movePostToTrash(id, expectedVersion)
            : action === "restore"
              ? restorePostFromTrash(id, expectedVersion)
              : null;

    if (!next) {
      auditLog({
        action: "post.status",
        outcome: "rejected",
        ...auditContext,
        resourceId: id,
        code: "INVALID_ACTION"
      });
      return apiError(400, "INVALID_REQUEST", "Invalid action");
    }

    auditLog({
      action: "post.status",
      outcome: "success",
      ...auditContext,
      resourceType: next.type,
      resourceId: next.id,
      detail: { action, status: next.status, version: next.version }
    });
    return NextResponse.json({
      ok: true,
      id: next.id,
      status: next.status,
      version: next.version,
      updatedAt: next.updatedAt
    });
  } catch (error) {
    if (error instanceof VersionConflictError) {
      auditLog({
        action: "post.status",
        outcome: "rejected",
        ...auditContext,
        resourceId: id,
        code: "VERSION_CONFLICT"
      });
      const current = getPostById(id);
      return apiError(
        409,
        "VERSION_CONFLICT",
        "内容已在其他标签页更新；操作未执行。",
        {
          current: current
            ? { id: current.id, version: current.version, updatedAt: current.updatedAt }
            : null
        }
      );
    }
    if (error instanceof SyntaxError) {
      auditLog({
        action: "post.status",
        outcome: "rejected",
        ...auditContext,
        resourceId: id,
        code: "INVALID_JSON"
      });
      return apiError(400, "INVALID_REQUEST", "请求内容不是有效的 JSON。");
    }
    auditLog({
      action: "post.status",
      outcome: "failure",
      ...auditContext,
      resourceId: id,
      code: "WRITE_FAILED"
    });
    return apiError(500, "WRITE_FAILED", "更新失败。");
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const admin = await requireAdminForApi();
  if (!admin) return apiError(401, "UNAUTHORIZED", "Unauthorized");
  const auditContext = {
    requestId: auditRequestId(request.headers),
    source: clientIpFromHeaders(request.headers),
    actorId: admin.id,
    resourceType: "post"
  };
  const { id: rawId } = await params;
  const id = Number(rawId);
  const post = getPostById(id);
  if (!post) {
    return apiError(404, "NOT_FOUND", "Not found");
  }

  const url = new URL(request.url);
  const expectedVersion = expectedVersionFrom(url.searchParams.get("expectedVersion"));
  if (expectedVersion === null) {
    auditLog({
      action: "post.delete",
      outcome: "rejected",
      ...auditContext,
      resourceId: id,
      code: "INVALID_VERSION"
    });
    return apiError(
      400,
      "INVALID_REQUEST",
      "A valid expectedVersion is required."
    );
  }

  try {
    if (post.status === "trashed" || url.searchParams.get("permanent") === "1") {
      deletePostPermanently(id, expectedVersion);
      auditLog({
        action: "post.delete",
        outcome: "success",
        ...auditContext,
        resourceType: post.type,
        resourceId: id,
        detail: { permanent: true }
      });
      return NextResponse.json({ ok: true });
    }
    const next = movePostToTrash(id, expectedVersion);
    auditLog({
      action: "post.delete",
      outcome: "success",
      ...auditContext,
      resourceType: post.type,
      resourceId: id,
      detail: { permanent: false }
    });
    return NextResponse.json({
      ok: true,
      version: next?.version,
      updatedAt: next?.updatedAt
    });
  } catch (error) {
    if (error instanceof VersionConflictError) {
      auditLog({
        action: "post.delete",
        outcome: "rejected",
        ...auditContext,
        resourceId: id,
        code: "VERSION_CONFLICT"
      });
      const current = getPostById(id);
      return apiError(
        409,
        "VERSION_CONFLICT",
        "内容已在其他标签页更新；删除操作未执行。",
        {
          current: current
            ? { id: current.id, version: current.version, updatedAt: current.updatedAt }
            : null
        }
      );
    }
    auditLog({
      action: "post.delete",
      outcome: "failure",
      ...auditContext,
      resourceId: id,
      code: "WRITE_FAILED"
    });
    return apiError(500, "WRITE_FAILED", "删除失败。");
  }
}
