import { NextResponse } from "next/server";
import { requireAdminForApi } from "@/lib/auth/session";
import {
  activateTheme,
  getThemeSelection,
  rollbackTheme
} from "@/lib/db/queries";
import { resolveThemeMutation } from "@/lib/themes/selection";
import { getThemes } from "@/themes";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  const admin = await requireAdminForApi();
  if (!admin) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "主题操作请求不是合法 JSON。" },
      { status: 400 }
    );
  }

  const themes = getThemes();
  const decision = resolveThemeMutation(
    body,
    getThemeSelection(),
    themes.map((theme) => theme.meta.id)
  );
  if (!decision.ok) {
    return NextResponse.json(
      { ok: false, error: decision.error },
      { status: decision.status }
    );
  }

  const selection = decision.action === "rollback"
    ? rollbackTheme()
    : activateTheme(decision.targetTheme);
  if (!selection) {
    return NextResponse.json(
      { ok: false, error: "当前没有可回退的主题。" },
      { status: 409 }
    );
  }

  return NextResponse.json({
    ok: true,
    action: decision.action,
    activeTheme: selection.activeTheme,
    previousTheme: selection.previousTheme
  });
}
