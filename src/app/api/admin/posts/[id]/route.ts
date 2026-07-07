import { NextResponse } from "next/server";
import { requireAdminForApi } from "@/lib/auth/session";
import {
  deletePostPermanently,
  getPostById,
  movePostToTrash,
  parseTagsInput,
  restorePostFromTrash,
  savePost,
  setPostStatus
} from "@/lib/db/queries";
import type { PostStatus, PostType } from "@/types/blog";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function normalizeBody(id: number, body: Record<string, unknown>) {
  const type = String(body.type ?? "post") as PostType;
  const status = String(body.status ?? "draft") as PostStatus;
  if (!["post", "page", "project"].includes(type)) {
    throw new Error("Invalid content type.");
  }
  if (!["draft", "published", "trashed"].includes(status)) {
    throw new Error("Invalid status.");
  }
  return {
    id,
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
  if (!admin) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const { id: rawId } = await params;
  const id = Number(rawId);
  if (!getPostById(id)) {
    return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
  }

  try {
    const body = (await request.json()) as Record<string, unknown>;
    const post = savePost(normalizeBody(id, body));
    return NextResponse.json({ ok: true, id: post.id, slug: post.slug });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Save failed" },
      { status: 400 }
    );
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const admin = await requireAdminForApi();
  if (!admin) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const { id: rawId } = await params;
  const id = Number(rawId);
  const post = getPostById(id);
  if (!post) {
    return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
  }

  try {
    const body = (await request.json()) as { action?: string };
    const action = String(body.action ?? "");
    const next =
      action === "publish"
        ? setPostStatus(id, "published")
        : action === "unpublish"
          ? setPostStatus(id, "draft")
          : action === "trash"
            ? movePostToTrash(id)
            : action === "restore"
              ? restorePostFromTrash(id)
              : null;

    if (!next) {
      return NextResponse.json({ ok: false, error: "Invalid action" }, { status: 400 });
    }

    return NextResponse.json({ ok: true, id: next.id, status: next.status });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Update failed" },
      { status: 400 }
    );
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const admin = await requireAdminForApi();
  if (!admin) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  const { id: rawId } = await params;
  const id = Number(rawId);
  const post = getPostById(id);
  if (!post) {
    return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
  }

  const url = new URL(request.url);
  if (post.status === "trashed" || url.searchParams.get("permanent") === "1") {
    deletePostPermanently(id);
  } else {
    movePostToTrash(id);
  }

  return NextResponse.json({ ok: true });
}
