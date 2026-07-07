import { NextResponse } from "next/server";
import { requireAdminForApi } from "@/lib/auth/session";
import {
  getPostById,
  listPostRevisions,
  restorePostRevision
} from "@/lib/db/queries";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const admin = await requireAdminForApi();
  if (!admin) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const { id: rawId } = await params;
  const id = Number(rawId);
  if (!getPostById(id)) {
    return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true, revisions: listPostRevisions(id) });
}

export async function POST(
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
    const body = (await request.json()) as { revisionId?: unknown };
    const revisionId = Number(body.revisionId);
    if (!Number.isInteger(revisionId) || revisionId <= 0) {
      return NextResponse.json({ ok: false, error: "Invalid revision" }, { status: 400 });
    }

    const post = restorePostRevision(id, revisionId);
    if (!post) {
      return NextResponse.json({ ok: false, error: "Revision not found" }, { status: 404 });
    }

    return NextResponse.json({
      ok: true,
      post,
      revisions: listPostRevisions(id)
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Restore failed" },
      { status: 400 }
    );
  }
}
