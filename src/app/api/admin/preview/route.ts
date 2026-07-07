import { NextResponse } from "next/server";
import { requireAdminForApi } from "@/lib/auth/session";
import { renderMarkdown } from "@/lib/content/markdown";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  const admin = await requireAdminForApi();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = (await request.json()) as { markdown?: string };
  const rendered = renderMarkdown(body.markdown ?? "");
  return NextResponse.json(rendered);
}
