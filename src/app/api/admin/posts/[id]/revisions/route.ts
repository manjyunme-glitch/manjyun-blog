import { NextResponse } from "next/server";
import { requireAdminForApi } from "@/lib/auth/session";
import {
  getPostById,
  listPostRevisionPage,
  restorePostRevision,
  VersionConflictError
} from "@/lib/db/queries";
import { apiError } from "@/lib/http/api-response";
import { auditLog, auditRequestId } from "@/lib/observability/audit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const admin = await requireAdminForApi();
  if (!admin) return apiError(401, "UNAUTHORIZED", "Unauthorized");

  const { id: rawId } = await params;
  const id = Number(rawId);
  if (!getPostById(id)) {
    return apiError(404, "NOT_FOUND", "Not found");
  }

  const url = new URL(request.url);
  const rawLimit = url.searchParams.get("limit");
  const limit = rawLimit === null ? 20 : Number(rawLimit);
  try {
    return NextResponse.json({
      ok: true,
      ...listPostRevisionPage(id, {
        cursor: url.searchParams.get("cursor"),
        limit
      })
    });
  } catch (error) {
    if (error instanceof RangeError) {
      return apiError(400, "INVALID_REQUEST", error.message);
    }
    throw error;
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const requestId = auditRequestId(request.headers);
  const admin = await requireAdminForApi();
  if (!admin) {
    auditLog({
      action: "post.revision.restore",
      outcome: "rejected",
      requestId,
      code: "UNAUTHORIZED"
    });
    return apiError(401, "UNAUTHORIZED", "Unauthorized");
  }

  const { id: rawId } = await params;
  const id = Number(rawId);
  if (!getPostById(id)) {
    auditLog({
      action: "post.revision.restore",
      outcome: "rejected",
      requestId,
      actorId: admin.id,
      resourceType: "post",
      ...(Number.isInteger(id) ? { resourceId: id } : {}),
      code: "NOT_FOUND"
    });
    return apiError(404, "NOT_FOUND", "Not found");
  }

  let requestedRevisionId: number | undefined;
  try {
    const body = (await request.json()) as {
      revisionId?: unknown;
      expectedVersion?: unknown;
    };
    const revisionId = Number(body.revisionId);
    requestedRevisionId = revisionId;
    if (!Number.isInteger(revisionId) || revisionId <= 0) {
      auditLog({
        action: "post.revision.restore",
        outcome: "rejected",
        requestId,
        actorId: admin.id,
        resourceType: "post",
        resourceId: id,
        code: "INVALID_REQUEST"
      });
      return apiError(400, "INVALID_REQUEST", "Invalid revision");
    }
    const expectedVersion = Number(body.expectedVersion);
    if (!Number.isInteger(expectedVersion) || expectedVersion < 1) {
      auditLog({
        action: "post.revision.restore",
        outcome: "rejected",
        requestId,
        actorId: admin.id,
        resourceType: "post",
        resourceId: id,
        code: "INVALID_REQUEST",
        detail: { revisionId }
      });
      return apiError(
        400,
        "INVALID_REQUEST",
        "A valid expectedVersion is required."
      );
    }

    const post = restorePostRevision(id, revisionId, expectedVersion);
    if (!post) {
      auditLog({
        action: "post.revision.restore",
        outcome: "rejected",
        requestId,
        actorId: admin.id,
        resourceType: "post",
        resourceId: id,
        code: "NOT_FOUND",
        detail: { revisionId }
      });
      return apiError(404, "NOT_FOUND", "Revision not found");
    }

    const revisionPage = listPostRevisionPage(id);
    auditLog({
      action: "post.revision.restore",
      outcome: "success",
      requestId,
      actorId: admin.id,
      resourceType: "post",
      resourceId: id,
      detail: { revisionId, version: post.version }
    });
    return NextResponse.json({
      ok: true,
      post,
      ...revisionPage
    });
  } catch (error) {
    if (error instanceof VersionConflictError) {
      const current = getPostById(id);
      auditLog({
        action: "post.revision.restore",
        outcome: "rejected",
        requestId,
        actorId: admin.id,
        resourceType: "post",
        resourceId: id,
        code: "VERSION_CONFLICT",
        detail: {
          revisionId:
            Number.isInteger(requestedRevisionId) &&
            requestedRevisionId !== undefined
              ? requestedRevisionId
              : null,
          currentVersion: current?.version ?? null
        }
      });
      return apiError(
        409,
        "VERSION_CONFLICT",
        "内容已在其他标签页更新；版本回退未执行。",
        {
          current: current
            ? { id: current.id, version: current.version, updatedAt: current.updatedAt }
            : null
        }
      );
    }
    const syntaxError = error instanceof SyntaxError;
    auditLog({
      action: "post.revision.restore",
      outcome: syntaxError ? "rejected" : "failure",
      requestId,
      actorId: admin.id,
      resourceType: "post",
      resourceId: id,
      code: syntaxError ? "INVALID_REQUEST" : "WRITE_FAILED",
      detail: {
        revisionId:
          Number.isInteger(requestedRevisionId) &&
          requestedRevisionId !== undefined
            ? requestedRevisionId
            : null
      }
    });
    return apiError(
      syntaxError ? 400 : 500,
      syntaxError ? "INVALID_REQUEST" : "WRITE_FAILED",
      syntaxError
        ? "请求内容不是有效的 JSON。"
        : "版本回退失败。"
    );
  }
}
