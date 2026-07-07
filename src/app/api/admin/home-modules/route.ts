import { NextResponse } from "next/server";
import { requireAdminForApi } from "@/lib/auth/session";
import { updateHomeModules } from "@/lib/db/queries";
import type { HomeModule } from "@/types/blog";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function PUT(request: Request) {
  const admin = await requireAdminForApi();
  if (!admin) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const body = (await request.json()) as { modules?: HomeModule[] };
  const modules = Array.isArray(body.modules) ? body.modules : [];
  updateHomeModules(
    modules.map((module) => ({
      id: String(module.id),
      enabled: Boolean(module.enabled),
      sortOrder: Number(module.sortOrder) || 0,
      config: module.config ?? {}
    }))
  );
  return NextResponse.json({ ok: true });
}
