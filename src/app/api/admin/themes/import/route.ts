import { NextResponse } from "next/server";
import { requireAdminForApi } from "@/lib/auth/session";
import { addThemeInstall } from "@/lib/db/queries";
import { auditThemeManifest } from "@/lib/themes/import";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  const admin = await requireAdminForApi();
  if (!admin) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const formData = await request.formData();
  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ ok: false, error: "No theme file provided" }, { status: 400 });
  }
  if (!file.name.endsWith(".json")) {
    return NextResponse.json(
      { ok: false, error: "当前导入器只审查 JSON theme manifest。请导入 .json 文件。" },
      { status: 400 }
    );
  }

  try {
    const raw = JSON.parse(await file.text()) as unknown;
    const audit = auditThemeManifest(raw);
    const record = addThemeInstall({
      themeId: audit.manifest.id,
      name: audit.manifest.name,
      version: audit.manifest.version,
      description: audit.manifest.description,
      status: audit.compatible ? "compatible" : "incompatible",
      issues: audit.issues
    });

    if (!audit.compatible) {
      return NextResponse.json(
        { ok: false, error: "主题不兼容", audit, record },
        { status: 422 }
      );
    }

    return NextResponse.json({ ok: true, audit, record });
  } catch {
    return NextResponse.json(
      { ok: false, error: "主题文件不是合法 JSON。" },
      { status: 400 }
    );
  }
}
