import { NextResponse } from "next/server";
import { requireAdminForApi } from "@/lib/auth/session";
import { transaction } from "@/lib/db/client";
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

function normalizeBody(body: Record<string, unknown>) {
  const type = String(body.type ?? "post") as PostType;
  const status = String(body.status ?? "draft") as PostStatus;
  if (!["post", "page", "project"].includes(type)) {
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
  if (!admin) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  try {
    const body = (await request.json()) as Record<string, unknown>;
    const post = savePost(normalizeBody(body));
    return NextResponse.json({ ok: true, id: post.id, slug: post.slug });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Save failed" },
      { status: 400 }
    );
  }
}

export async function PATCH(request: Request) {
  const admin = await requireAdminForApi();
  if (!admin) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  try {
    const body = (await request.json()) as { ids?: unknown; action?: unknown };
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
      return NextResponse.json({ ok: false, error: "No posts selected" }, { status: 400 });
    }
    if (!["publish", "unpublish", "trash", "restore", "delete"].includes(action)) {
      return NextResponse.json({ ok: false, error: "Invalid action" }, { status: 400 });
    }

    let count = 0;
    transaction(() => {
      for (const id of ids) {
        const post = getPostById(id);
        if (!post) continue;

        if (action === "publish") {
          if (setPostStatus(id, "published")) count += 1;
        } else if (action === "unpublish") {
          if (setPostStatus(id, "draft")) count += 1;
        } else if (action === "trash") {
          if (movePostToTrash(id)) count += 1;
        } else if (action === "restore") {
          if (restorePostFromTrash(id)) count += 1;
        } else if (post.status === "trashed") {
          deletePostPermanently(id);
          count += 1;
        }
      }
    });

    return NextResponse.json({ ok: true, count });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Bulk update failed" },
      { status: 400 }
    );
  }
}
