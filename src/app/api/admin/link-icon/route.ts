import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { requireAdminForApi } from "@/lib/auth/session";
import { clientIpFromHeaders } from "@/lib/auth/login-rate-limit";
import { validateMediaFile } from "@/lib/media/file-validation";
import { writeMediaFileAtomically } from "@/lib/media/storage";
import {
  fetchUrlSafely,
  resolvePublicTarget,
  SafeFetchError,
  TimeoutError
} from "@/lib/net/safe-fetch";
import { ensureUploadsDir, getUploadsDir } from "@/lib/paths";
import { auditLog, auditRequestId } from "@/lib/observability/audit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const iconMaxBytes = 1024 * 1024;
const localIconDir = "link-icons";
const iconExtensions = [".ico", ".png", ".webp", ".gif", ".jpg", ".jpeg", ".avif"];

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

function iconCacheHash(iconUrl: string) {
  return crypto.createHash("sha256").update(iconUrl).digest("hex").slice(0, 28);
}

function localIconPath(iconUrl: string, ext: string) {
  const filename = `${iconCacheHash(iconUrl)}${ext}`;
  return {
    fullPath: path.join(getUploadsDir(), localIconDir, filename),
    publicUrl: `/uploads/${localIconDir}/${filename}`
  };
}

async function readCachedIcon(iconUrl: string) {
  for (const ext of iconExtensions) {
    const candidate = localIconPath(iconUrl, ext);
    try {
      await fs.access(candidate.fullPath);
      return candidate.publicUrl;
    } catch {
      // Try the next known image extension.
    }
  }
  return "";
}

async function cacheRemoteIcon(iconUrl: string, timeoutMs = 5200) {
  // Validate even cache hits so blocked URLs cannot bypass the policy via an old file.
  await resolvePublicTarget(new URL(iconUrl), undefined, timeoutMs);
  const cached = await readCachedIcon(iconUrl);
  if (cached) return cached;

  const response = await fetchUrlSafely(iconUrl, {
    accept: "image/avif,image/webp,image/png,image/jpeg,image/gif,image/x-icon,*/*;q=0.5",
    timeoutMs,
    maxBytes: iconMaxBytes
  });

  if (!response.ok) {
    throw new Error("Icon request failed.");
  }

  const contentLength = Number(response.headers.get("content-length") ?? 0);
  if (contentLength > iconMaxBytes) {
    throw new Error("Icon is too large.");
  }

  const buffer = response.body;
  if (buffer.length > iconMaxBytes) {
    throw new Error("Icon is too large.");
  }

  const validated = validateMediaFile(buffer, { imageOnly: true });
  if (!validated) {
    throw new Error("Icon response is not a supported raster image.");
  }
  const target = localIconPath(iconUrl, validated.extension);
  ensureUploadsDir();
  await writeMediaFileAtomically(
    `${localIconDir}/${path.basename(target.fullPath)}`,
    buffer
  );
  return target.publicUrl;
}

function isTargetPolicyError(error: unknown) {
  return (
    error instanceof SafeFetchError &&
    ["INVALID_URL", "UNSUPPORTED_PROTOCOL", "TARGET_NOT_PUBLIC", "INVALID_DNS_RESPONSE"].includes(
      error.code
    )
  );
}

function errorResponse(
  status: number,
  code: string,
  message: string,
  details: Record<string, unknown> = {}
) {
  return NextResponse.json(
    {
      ok: false,
      error: message,
      code,
      details
    },
    { status }
  );
}

export async function POST(request: Request) {
  const admin = await requireAdminForApi();
  if (!admin) {
    return errorResponse(401, "UNAUTHORIZED", "Unauthorized");
  }
  const auditContext = {
    requestId: auditRequestId(request.headers),
    source: clientIpFromHeaders(request.headers),
    actorId: admin.id
  };

  let body: { url?: string };
  try {
    const input = (await request.json()) as unknown;
    body = input && typeof input === "object" ? (input as { url?: string }) : {};
  } catch {
    auditLog({
      action: "link-icon.fetch",
      outcome: "rejected",
      ...auditContext,
      code: "INVALID_JSON"
    });
    return errorResponse(400, "INVALID_REQUEST_BODY", "请求正文必须是有效的 JSON。");
  }
  if (body.url !== undefined && typeof body.url !== "string") {
    auditLog({
      action: "link-icon.fetch",
      outcome: "rejected",
      ...auditContext,
      code: "INVALID_URL"
    });
    return errorResponse(400, "INVALID_URL", "请输入可访问的 http(s) 链接。");
  }
  const target = normalizeUrl(body.url ?? "");
  if (!target || !["http:", "https:"].includes(target.protocol)) {
    auditLog({
      action: "link-icon.fetch",
      outcome: "rejected",
      ...auditContext,
      code: "INVALID_URL"
    });
    return errorResponse(400, "INVALID_URL", "请输入可访问的 http(s) 链接。");
  }

  try {
    const directIcon = await cacheRemoteIcon(fallbackIconUrl(target)).catch((error) => {
      if (isTargetPolicyError(error)) throw error;
      return "";
    });
    if (directIcon) {
      auditLog({
        action: "link-icon.fetch",
        outcome: "success",
        ...auditContext,
        resourceType: "link-icon",
        detail: { source: "favicon" }
      });
      return NextResponse.json({ ok: true, iconUrl: directIcon });
    }

    const response = await fetchUrlSafely(target.toString(), {
      accept: "text/html,application/xhtml+xml",
      timeoutMs: 5500,
      maxBytes: 2 * 1024 * 1024
    });
    const finalUrl = new URL(response.url || target.toString());
    const html = response.body.toString("utf8");
    const iconUrl = findIcon(html, finalUrl);
    if (iconUrl) {
      const localIcon = await cacheRemoteIcon(iconUrl).catch((error) => {
        if (isTargetPolicyError(error)) throw error;
        return "";
      });
      auditLog({
        action: "link-icon.fetch",
        outcome: "success",
        ...auditContext,
        resourceType: "link-icon",
        detail: { source: localIcon ? "cache" : "remote" }
      });
      return NextResponse.json({ ok: true, iconUrl: localIcon || iconUrl });
    }

    auditLog({
      action: "link-icon.fetch",
      outcome: "success",
      ...auditContext,
      resourceType: "link-icon",
      code: "FALLBACK_FAVICON"
    });
    return NextResponse.json({
      ok: true,
      iconUrl: fallbackIconUrl(finalUrl),
      warning: "页面没有声明图标，已填入默认 favicon 地址。"
    });
  } catch (error) {
    if (error instanceof TimeoutError || error instanceof DOMException) {
      auditLog({
        action: "link-icon.fetch",
        outcome: "success",
        ...auditContext,
        resourceType: "link-icon",
        code: "FALLBACK_TIMEOUT"
      });
      return NextResponse.json({
        ok: true,
        iconUrl: fallbackIconUrl(target),
        warning: "读取网页超时，已填入默认 favicon 地址；如果预览不显示，请手动填写或上传图标。"
      });
    }

    if (error instanceof SafeFetchError) {
      auditLog({
        action: "link-icon.fetch",
        outcome: "rejected",
        ...auditContext,
        code: error.code
      });
      const message =
        error.code === "TARGET_NOT_PUBLIC"
          ? "出于安全原因，不能读取本机、局域网或非公网地址。"
          : error.code === "DNS_RESOLUTION_FAILED"
            ? "无法解析该网页地址，请检查域名后重试。"
            : "无法安全读取该网页图标，请手动填写图标 URL 或上传图标。";
      return errorResponse(error.status, error.code, message, error.details);
    }

    auditLog({
      action: "link-icon.fetch",
      outcome: "failure",
      ...auditContext,
      code: "LINK_ICON_FETCH_FAILED"
    });
    return errorResponse(
      502,
      "LINK_ICON_FETCH_FAILED",
      "无法读取该网页图标，请手动填写图标 URL 或上传图标。"
    );
  }
}
