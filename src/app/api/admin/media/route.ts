import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { requireAdminForApi } from "@/lib/auth/session";
import { addMedia, listMedia } from "@/lib/db/queries";
import { ensureUploadsDir, getUploadsDir } from "@/lib/paths";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const maxBytes = 50 * 1024 * 1024;

function safeExt(name: string) {
  const ext = path.extname(name).toLowerCase().replace(/[^a-z0-9.]/g, "");
  return ext || ".bin";
}

export async function GET() {
  const admin = await requireAdminForApi();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json({ media: listMedia() });
}

export async function POST(request: Request) {
  const admin = await requireAdminForApi();
  if (!admin) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const formData = await request.formData();
  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ ok: false, error: "No file provided" }, { status: 400 });
  }
  if (file.size > maxBytes) {
    return NextResponse.json({ ok: false, error: "File is larger than 50MB" }, { status: 400 });
  }

  const now = new Date();
  const year = String(now.getFullYear());
  const month = String(now.getMonth() + 1).padStart(2, "0");
  ensureUploadsDir();
  const dir = path.join(getUploadsDir(), year, month);
  await fs.mkdir(dir, { recursive: true });

  const filename = `${crypto.randomUUID()}${safeExt(file.name)}`;
  const fullPath = path.join(dir, filename);
  const buffer = Buffer.from(await file.arrayBuffer());
  await fs.writeFile(fullPath, buffer);

  const url = `/uploads/${year}/${month}/${filename}`;
  const media = addMedia({
    filename: `${year}/${month}/${filename}`,
    originalName: file.name,
    mime: file.type || "application/octet-stream",
    size: file.size,
    url
  });
  return NextResponse.json({ ok: true, media });
}
