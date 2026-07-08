import { NextResponse } from "next/server";
import { requireAdminForApi } from "@/lib/auth/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

class TimeoutError extends Error {
  constructor() {
    super("Request timed out");
    this.name = "TimeoutError";
  }
}

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

function fallbackIconUrl(target: URL) {
  return new URL("/favicon.ico", target).toString();
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  onTimeout?: () => void
) {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      onTimeout?.();
      reject(new TimeoutError());
    }, timeoutMs);
  });

  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
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

  try {
    const controller = new AbortController();
    const response = await withTimeout(
      fetch(target, {
        redirect: "follow",
        signal: controller.signal,
        headers: {
          Accept: "text/html,application/xhtml+xml",
          "User-Agent": "Mozilla/5.0 ManJyunBlog/0.1 favicon fetcher"
        }
      }),
      5500,
      () => controller.abort()
    );
    const finalUrl = new URL(response.url || target.toString());
    const html = await withTimeout(response.text(), 2200, () => {
      void response.body?.cancel();
    });
    const iconUrl = findIcon(html, finalUrl);
    if (iconUrl) {
      return NextResponse.json({ ok: true, iconUrl });
    }

    return NextResponse.json({
      ok: true,
      iconUrl: fallbackIconUrl(finalUrl),
      warning: "页面没有声明图标，已填入默认 favicon 地址。"
    });
  } catch (error) {
    if (error instanceof TimeoutError || error instanceof DOMException) {
      return NextResponse.json({
        ok: true,
        iconUrl: fallbackIconUrl(target),
        warning: "读取网页超时，已填入默认 favicon 地址；如果预览不显示，请手动填写或上传图标。"
      });
    }

    return NextResponse.json(
      { ok: false, error: "无法读取该网页图标，请手动填写图标 URL 或上传图标。" },
      { status: 502 }
    );
  }
}
