import { NextResponse } from "next/server";
import { requireAdminForApi } from "@/lib/auth/session";
import { addThemeInstall } from "@/lib/db/queries";
import { readFormDataWithLimit, RequestBodyTooLargeError } from "@/lib/http/limited-form-data";
import { auditThemeManifest } from "@/lib/themes/import";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const maxThemeBytes = 1024 * 1024;

export async function POST(request: Request) {
  const admin = await requireAdminForApi();
  if (!admin) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  let formData: FormData;
  try {
    formData = await readFormDataWithLimit(request, maxThemeBytes + 256 * 1024);
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return NextResponse.json({ ok: false, error: "主题文件不能超过 1MB。" }, { status: 413 });
    }
    return NextResponse.json({ ok: false, error: "主题上传请求格式无效。" }, { status: 400 });
  }
  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ ok: false, error: "No theme file provided" }, { status: 400 });
  }
  if (file.size > maxThemeBytes) {
    return NextResponse.json({ ok: false, error: "主题文件不能超过 1MB。" }, { status: 413 });
  }
  if (!file.name.toLowerCase().endsWith(".json")) {
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
