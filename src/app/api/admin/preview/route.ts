import { NextResponse } from "next/server";
import { requireAdminForApi } from "@/lib/auth/session";
import { renderEntryMarkdown } from "@/lib/content/markdown";
import { apiError } from "@/lib/http/api-response";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  const admin = await requireAdminForApi();
  if (!admin) return apiError(401, "UNAUTHORIZED", "Unauthorized");

  try {
    const body = (await request.json()) as unknown;
    if (!body || typeof body !== "object") {
      return apiError(400, "INVALID_REQUEST", "预览请求格式无效。");
    }

    const input = body as Record<string, unknown>;
    if (
      (input.title !== undefined && typeof input.title !== "string") ||
      (input.markdown !== undefined && typeof input.markdown !== "string")
    ) {
      return apiError(400, "INVALID_REQUEST", "标题和正文必须是文本。");
    }

    return NextResponse.json(
      renderEntryMarkdown(
        typeof input.markdown === "string" ? input.markdown : "",
        typeof input.title === "string" ? input.title : ""
      )
    );
  } catch {
    return apiError(400, "INVALID_REQUEST", "请求内容不是有效的 JSON。");
  }
}
