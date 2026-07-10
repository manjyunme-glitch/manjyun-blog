import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { requireAdminForApi } from "@/lib/auth/session";
import { addMedia, listMedia } from "@/lib/db/queries";
import { readFormDataWithLimit, RequestBodyTooLargeError } from "@/lib/http/limited-form-data";
import { validateMediaFile } from "@/lib/media/file-validation";
import { ensureUploadsDir, getUploadsDir } from "@/lib/paths";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const maxBytes = 50 * 1024 * 1024;
const maxRequestBytes = maxBytes + 1024 * 1024;

export async function GET() {
  const admin = await requireAdminForApi();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json({ media: listMedia() });
}

export async function POST(request: Request) {
  const admin = await requireAdminForApi();
  if (!admin) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  let formData: FormData;
  try {
    formData = await readFormDataWithLimit(request, maxRequestBytes);
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return NextResponse.json({ ok: false, error: "上传失败：请求体超过 51MB" }, { status: 413 });
    }
    return NextResponse.json({ ok: false, error: "上传失败：请求格式无效" }, { status: 400 });
  }
  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ ok: false, error: "上传失败：没有收到文件" }, { status: 400 });
  }
  if (file.size > maxBytes) {
    return NextResponse.json({ ok: false, error: "上传失败：文件超过 50MB" }, { status: 413 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const validated = validateMediaFile(buffer);
  if (!validated) {
    return NextResponse.json(
      {
        ok: false,
        error: "上传失败：仅支持 JPG、PNG、GIF、WebP、AVIF、ICO、MP3、WAV、OGG、FLAC、M4A 或 PDF"
      },
      { status: 415 }
    );
  }

  const now = new Date();
  const year = String(now.getFullYear());
  const month = String(now.getMonth() + 1).padStart(2, "0");
  ensureUploadsDir();
  const dir = path.join(getUploadsDir(), year, month);
  await fs.mkdir(dir, { recursive: true });

  const filename = `${crypto.randomUUID()}${validated.extension}`;
  const fullPath = path.join(dir, filename);
  await fs.writeFile(fullPath, buffer);

  const url = `/uploads/${year}/${month}/${filename}`;
  try {
    const media = addMedia({
      filename: `${year}/${month}/${filename}`,
      originalName: file.name.replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 255) || "upload",
      mime: validated.mime,
      size: buffer.byteLength,
      url
    });
    return NextResponse.json({ ok: true, media });
  } catch {
    await fs.unlink(fullPath).catch(() => undefined);
    return NextResponse.json({ ok: false, error: "上传失败：无法保存媒体记录" }, { status: 500 });
  }
}
