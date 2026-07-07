import { NextResponse } from "next/server";
import { requireAdminForApi } from "@/lib/auth/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function readAttribute(source: string, name: string) {
  const pattern = new RegExp(`${name}\\s*=\\s*["']([^"']+)["']`, "i");
  return source.match(pattern)?.[1]?.trim() ?? "";
}

function normalizeUrl(input: string) {
  const trimmed = input.trim();
  if (!trimmed) return null;
  try {
    return new URL(trimmed);
  } catch {
    try {
      return new URL(`https://${trimmed}`);
    } catch {
      return null;
    }
  }
}

function findIcon(html: string, baseUrl: URL) {
  const links = html.match(/<link\b[^>]*>/gi) ?? [];
  const candidates = links
    .map((link) => ({
      rel: readAttribute(link, "rel").toLowerCase(),
      href: readAttribute(link, "href"),
      sizes: readAttribute(link, "sizes")
    }))
    .filter((link) => link.href && /(^|\s)(icon|shortcut icon|apple-touch-icon|mask-icon)(\s|$)/.test(link.rel))
    .sort((a, b) => {
      const aApple = a.rel.includes("apple-touch-icon") ? 1 : 0;
      const bApple = b.rel.includes("apple-touch-icon") ? 1 : 0;
      const aSvg = a.href.endsWith(".svg") ? 1 : 0;
      const bSvg = b.href.endsWith(".svg") ? 1 : 0;
      return bSvg - aSvg || bApple - aApple || b.sizes.length - a.sizes.length;
    });

  const first = candidates[0]?.href;
  return first ? new URL(first, baseUrl).toString() : "";
}

export async function POST(request: Request) {
  const admin = await requireAdminForApi();
  if (!admin) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const body = (await request.json()) as { url?: string };
  const target = normalizeUrl(body.url ?? "");
  if (!target || !["http:", "https:"].includes(target.protocol)) {
    return NextResponse.json(
      { ok: false, error: "请输入可访问的 http(s) 链接。" },
      { status: 400 }
    );
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 7000);

  try {
    const response = await fetch(target, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "User-Agent": "ManJyunBlog/0.1 favicon fetcher"
      }
    });
    const finalUrl = new URL(response.url || target.toString());
    const html = await response.text();
    const iconUrl = findIcon(html, finalUrl) || new URL("/favicon.ico", finalUrl).toString();
    return NextResponse.json({ ok: true, iconUrl });
  } catch {
    return NextResponse.json(
      { ok: false, error: "无法读取该网页图标，请手动填写图标 URL 或上传图标。" },
      { status: 502 }
    );
  } finally {
    clearTimeout(timer);
  }
}
