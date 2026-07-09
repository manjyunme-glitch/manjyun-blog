import crypto from "node:crypto";
import fs from "node:fs/promises";
import http from "node:http";
import https from "node:https";
import path from "node:path";
import tls from "node:tls";
import { NextResponse } from "next/server";
import { requireAdminForApi } from "@/lib/auth/session";
import { proxyForUrl } from "@/lib/net/proxy";
import { tunneledHttpsRequestOptions } from "@/lib/net/tunnel";
import { ensureUploadsDir, getUploadsDir } from "@/lib/paths";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

class TimeoutError extends Error {
  constructor() {
    super("Request timed out");
    this.name = "TimeoutError";
  }
}

const iconMaxBytes = 1024 * 1024;
const localIconDir = "link-icons";
const iconExtensions = [".ico", ".png", ".svg", ".webp", ".gif", ".jpg", ".jpeg", ".avif"];

type FetchResult = {
  ok: boolean;
  status: number;
  url: string;
  headers: Map<string, string>;
  body: Buffer;
};

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

function headersFromResponse(headers: http.IncomingHttpHeaders) {
  const map = new Map<string, string>();
  for (const [key, value] of Object.entries(headers)) {
    if (Array.isArray(value)) {
      map.set(key.toLowerCase(), value.join(", "));
    } else if (value !== undefined) {
      map.set(key.toLowerCase(), String(value));
    }
  }
  return map;
}

function proxyAuthHeader(proxy: URL) {
  if (!proxy.username) return null;
  return `Basic ${Buffer.from(`${decodeURIComponent(proxy.username)}:${decodeURIComponent(proxy.password)}`).toString("base64")}`;
}

function collectResponse(
  response: http.IncomingMessage,
  finalUrl: string,
  maxBytes: number
) {
  return new Promise<FetchResult>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    response.on("data", (chunk: Buffer) => {
      total += chunk.length;
      if (total > maxBytes) {
        response.destroy(new Error("Response is too large."));
        return;
      }
      chunks.push(chunk);
    });
    response.on("end", () => {
      resolve({
        ok: (response.statusCode ?? 0) >= 200 && (response.statusCode ?? 0) < 300,
        status: response.statusCode ?? 0,
        url: finalUrl,
        headers: headersFromResponse(response.headers),
        body: Buffer.concat(chunks)
      });
    });
    response.on("error", reject);
  });
}

function requestDirect(target: URL, headers: Record<string, string>, timeoutMs: number, maxBytes: number) {
  return new Promise<FetchResult>((resolve, reject) => {
    const client = target.protocol === "https:" ? https : http;
    const request = client.request(
      {
        protocol: target.protocol,
        hostname: target.hostname,
        port: target.port || (target.protocol === "https:" ? 443 : 80),
        path: `${target.pathname}${target.search}`,
        method: "GET",
        headers: {
          ...headers,
          Host: target.host,
          Connection: "close"
        },
        timeout: timeoutMs
      },
      (response) => {
        collectResponse(response, response.headers.location ? new URL(response.headers.location, target).toString() : target.toString(), maxBytes)
          .then(resolve)
          .catch(reject);
      }
    );
    request.on("timeout", () => request.destroy(new TimeoutError()));
    request.on("error", reject);
    request.end();
  });
}

function requestViaProxy(target: URL, proxy: URL, headers: Record<string, string>, timeoutMs: number, maxBytes: number) {
  if (target.protocol === "http:") {
    return requestHttpViaProxy(target, proxy, headers, timeoutMs, maxBytes);
  }
  return requestHttpsViaProxy(target, proxy, headers, timeoutMs, maxBytes);
}

function requestHttpViaProxy(target: URL, proxy: URL, headers: Record<string, string>, timeoutMs: number, maxBytes: number) {
  return new Promise<FetchResult>((resolve, reject) => {
    const auth = proxyAuthHeader(proxy);
    const proxyClient = proxy.protocol === "https:" ? https : http;
    const request = proxyClient.request(
      {
        protocol: proxy.protocol,
        hostname: proxy.hostname,
        port: proxy.port || (proxy.protocol === "https:" ? 443 : 80),
        path: target.toString(),
        method: "GET",
        headers: {
          ...headers,
          Host: target.host,
          ...(auth ? { "Proxy-Authorization": auth } : {}),
          Connection: "close"
        },
        timeout: timeoutMs
      },
      (response) => {
        collectResponse(response, response.headers.location ? new URL(response.headers.location, target).toString() : target.toString(), maxBytes)
          .then(resolve)
          .catch(reject);
      }
    );
    request.on("timeout", () => request.destroy(new TimeoutError()));
    request.on("error", reject);
    request.end();
  });
}

function requestHttpsViaProxy(target: URL, proxy: URL, headers: Record<string, string>, timeoutMs: number, maxBytes: number) {
  return new Promise<FetchResult>((resolve, reject) => {
    const auth = proxyAuthHeader(proxy);
    const proxyClient = proxy.protocol === "https:" ? https : http;
    const authority = `${target.hostname}:${target.port || 443}`;
    const connectRequest = proxyClient.request({
      hostname: proxy.hostname,
      port: proxy.port || (proxy.protocol === "https:" ? 443 : 80),
      method: "CONNECT",
      path: authority,
      headers: {
        Host: authority,
        ...(auth ? { "Proxy-Authorization": auth } : {})
      },
      timeout: timeoutMs
    });

    connectRequest.on("connect", (response, socket) => {
      if (response.statusCode !== 200) {
        socket.destroy();
        reject(new Error(`Proxy CONNECT returned ${response.statusCode}`));
        return;
      }

      const secureSocket = tls.connect({
        socket,
        servername: target.hostname
      });
      secureSocket.on("error", reject);
      secureSocket.on("secureConnect", () => {
        const request = https.request(
          tunneledHttpsRequestOptions(target, headers, secureSocket, timeoutMs),
          (iconResponse) => {
            collectResponse(iconResponse, iconResponse.headers.location ? new URL(iconResponse.headers.location, target).toString() : target.toString(), maxBytes)
              .then(resolve)
              .catch(reject);
          }
        );
        request.on("timeout", () => request.destroy(new TimeoutError()));
        request.on("error", reject);
        request.end();
      });
    });
    connectRequest.on("timeout", () => connectRequest.destroy(new TimeoutError()));
    connectRequest.on("error", reject);
    connectRequest.end();
  });
}

async function fetchUrl(
  input: string,
  {
    accept,
    timeoutMs,
    maxBytes,
    redirects = 4
  }: {
    accept: string;
    timeoutMs: number;
    maxBytes: number;
    redirects?: number;
  }
): Promise<FetchResult> {
  const target = new URL(input);
  const headers = {
    Accept: accept,
    "User-Agent": "Mozilla/5.0 ManJyunBlog/0.1 favicon fetcher"
  };
  const proxy = proxyForUrl(target);
  const result = proxy
    ? await requestViaProxy(target, proxy, headers, timeoutMs, maxBytes)
    : await requestDirect(target, headers, timeoutMs, maxBytes);

  if ([301, 302, 303, 307, 308].includes(result.status)) {
    const location = result.headers.get("location");
    if (location && redirects > 0) {
      return fetchUrl(new URL(location, target).toString(), {
        accept,
        timeoutMs,
        maxBytes,
        redirects: redirects - 1
      });
    }
  }

  return result;
}

function iconExtFromMime(mime: string) {
  const normalized = mime.split(";")[0].trim().toLowerCase();
  const extByMime: Record<string, string> = {
    "image/x-icon": ".ico",
    "image/vnd.microsoft.icon": ".ico",
    "image/png": ".png",
    "image/svg+xml": ".svg",
    "image/webp": ".webp",
    "image/gif": ".gif",
    "image/jpeg": ".jpg",
    "image/avif": ".avif"
  };
  return extByMime[normalized] ?? null;
}

function iconExtFromUrl(input: string) {
  try {
    const ext = path.extname(new URL(input).pathname).toLowerCase();
    return iconExtensions.includes(ext) ? ext : null;
  } catch {
    return null;
  }
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

function isImageResponse(response: FetchResult, iconUrl: string) {
  const mime = response.headers.get("content-type") ?? "";
  if (mime.toLowerCase().startsWith("image/")) return true;
  return Boolean(iconExtFromUrl(response.url || iconUrl));
}

async function cacheRemoteIcon(iconUrl: string, timeoutMs = 5200) {
  const cached = await readCachedIcon(iconUrl);
  if (cached) return cached;

  const response = await fetchUrl(iconUrl, {
    accept: "image/avif,image/webp,image/svg+xml,image/png,image/*,*/*;q=0.8",
    timeoutMs,
    maxBytes: iconMaxBytes
  });

  if (!response.ok || !isImageResponse(response, iconUrl)) {
    throw new Error("Icon response is not an image.");
  }

  const contentLength = Number(response.headers.get("content-length") ?? 0);
  if (contentLength > iconMaxBytes) {
    throw new Error("Icon is too large.");
  }

  const buffer = response.body;
  if (buffer.length > iconMaxBytes) {
    throw new Error("Icon is too large.");
  }

  const ext =
    iconExtFromMime(response.headers.get("content-type") ?? "") ??
    iconExtFromUrl(response.url || iconUrl) ??
    ".ico";
  const target = localIconPath(iconUrl, ext);
  ensureUploadsDir();
  await fs.mkdir(path.dirname(target.fullPath), { recursive: true });
  try {
    await fs.writeFile(target.fullPath, buffer, { flag: "wx" });
  } catch (error) {
    if (!(error && typeof error === "object" && "code" in error && error.code === "EEXIST")) {
      throw error;
    }
  }
  return target.publicUrl;
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
    const directIcon = await cacheRemoteIcon(fallbackIconUrl(target)).catch(() => "");
    if (directIcon) {
      return NextResponse.json({ ok: true, iconUrl: directIcon });
    }

    const response = await fetchUrl(target.toString(), {
      accept: "text/html,application/xhtml+xml",
      timeoutMs: 5500,
      maxBytes: 2 * 1024 * 1024
    });
    const finalUrl = new URL(response.url || target.toString());
    const html = response.body.toString("utf8");
    const iconUrl = findIcon(html, finalUrl);
    if (iconUrl) {
      const localIcon = await cacheRemoteIcon(iconUrl).catch(() => "");
      return NextResponse.json({ ok: true, iconUrl: localIcon || iconUrl });
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
