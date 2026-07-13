import { NextResponse } from "next/server";
import { requireAdminForApi } from "@/lib/auth/session";
import { updateSiteConfiguration } from "@/lib/db/queries";
import { validateSiteConfigurationPayload } from "@/lib/admin/settings-validation";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function PUT(request: Request) {
  const admin = await requireAdminForApi();
  if (!admin) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const body = (await request.json()) as Record<string, unknown>;
  const validated = validateSiteConfigurationPayload(body);
  if (!validated.ok) {
    return NextResponse.json({ ok: false, error: validated.issues[0], issues: validated.issues }, { status: 400 });
  }
  updateSiteConfiguration(validated.value);
  return NextResponse.json({ ok: true });
}
