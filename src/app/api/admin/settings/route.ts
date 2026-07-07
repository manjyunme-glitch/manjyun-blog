import { NextResponse } from "next/server";
import { requireAdminForApi } from "@/lib/auth/session";
import { replaceNavLinks, updateSiteSettings } from "@/lib/db/queries";
import type { NavLink, SiteSettings } from "@/types/blog";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type LinkInput = Omit<NavLink, "id" | "groupName">;

function cleanLinks(input: unknown): LinkInput[] {
  if (!Array.isArray(input)) return [];
  return input
    .map((link) => {
      const item = link as Record<string, unknown>;
      return {
        label: String(item.label ?? "").trim(),
        url: String(item.url ?? "").trim(),
        iconUrl: String(item.iconUrl ?? "").trim() || null,
        sortOrder: Number(item.sortOrder ?? 0) || 0
      };
    })
    .filter((link) => link.label && link.url);
}

export async function PUT(request: Request) {
  const admin = await requireAdminForApi();
  if (!admin) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const body = (await request.json()) as {
    settings?: Partial<SiteSettings>;
    mainLinks?: unknown;
    frequentLinks?: unknown;
  };
  updateSiteSettings(body.settings ?? {});
  replaceNavLinks("main", cleanLinks(body.mainLinks));
  replaceNavLinks("frequent", cleanLinks(body.frequentLinks));
  return NextResponse.json({ ok: true });
}
