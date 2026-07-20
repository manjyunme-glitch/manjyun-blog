import fs from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { clientIpFromHeaders } from "@/lib/auth/login-rate-limit";
import {
  monitoredWebStream,
  parseSingleByteRange,
  RangeNotSatisfiableError
} from "@/lib/media/http-download";
import {
  MediaStorageError,
  resolveMediaPath
} from "@/lib/media/storage";
import { auditLog, auditRequestId } from "@/lib/observability/audit";
import { assertInside, getUploadsDir } from "@/lib/paths";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const mimeMap: Record<string, string> = {
  ".ico": "image/x-icon",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".flac": "audio/flac",
  ".m4a": "audio/mp4",
  ".pdf": "application/pdf"
};

type RouteContext = {
  params: Promise<{ path: string[] }>;
};

function errorCode(error: unknown) {
  return error && typeof error === "object" && "code" in error
    ? String(error.code)
    : "";
}

function auditReadFailure(
  request: Request,
  code: string,
  outcome: "failure" | "rejected" = "failure"
) {
  auditLog({
    action: "media.read",
    outcome,
    requestId: auditRequestId(request.headers),
    source: clientIpFromHeaders(request.headers),
    resourceType: "media-storage",
    code
  });
}

function readFailureResponse(request: Request, error: unknown) {
  const code = errorCode(error);
  if (code === "ENOENT" || code === "ENOTDIR") {
    return new NextResponse("Not found", {
      status: 404,
      headers: { "Cache-Control": "no-store" }
    });
  }
  if (
    code === "EACCES" ||
    code === "EPERM" ||
    code === "EROFS"
  ) {
    auditReadFailure(request, "STORAGE_PERMISSION");
    return new NextResponse("Storage permission denied", {
      status: 503,
      headers: { "Cache-Control": "no-store" }
    });
  }
  if (
    code === "EIO" ||
    code === "EMFILE" ||
    code === "ENFILE"
  ) {
    auditReadFailure(request, `STORAGE_${code}`);
    return new NextResponse("Storage temporarily unavailable", {
      status: 503,
      headers: { "Cache-Control": "no-store" }
    });
  }
  auditReadFailure(request, "READ_FAILED");
  return new NextResponse("Unable to read file", {
    status: 500,
    headers: { "Cache-Control": "no-store" }
  });
}

async function serveMedia(
  request: Request,
  { params }: RouteContext,
  headOnly: boolean
) {
  const { path: parts } = await params;
  let requestedPath: string;
  try {
    requestedPath = resolveMediaPath(parts.join("/"));
  } catch (error) {
    if (error instanceof MediaStorageError) {
      auditReadFailure(request, "INVALID_PATH", "rejected");
      return new NextResponse("Invalid path", {
        status: 400,
        headers: { "Cache-Control": "no-store" }
      });
    }
    throw error;
  }

  let handle: fs.FileHandle | null = null;
  try {
    const requestedStat = await fs.lstat(requestedPath);
    if (!requestedStat.isFile() || requestedStat.isSymbolicLink()) {
      auditReadFailure(request, "INVALID_PATH", "rejected");
      return new NextResponse("Invalid path", {
        status: 400,
        headers: { "Cache-Control": "no-store" }
      });
    }

    const [realUploadsDir, realFilePath] = await Promise.all([
      fs.realpath(getUploadsDir()),
      fs.realpath(requestedPath)
    ]);
    try {
      assertInside(realUploadsDir, realFilePath);
    } catch {
      auditReadFailure(request, "INVALID_PATH", "rejected");
      return new NextResponse("Invalid path", {
        status: 400,
        headers: { "Cache-Control": "no-store" }
      });
    }

    handle = await fs.open(realFilePath, "r");
    const stat = await handle.stat();
    if (!stat.isFile()) {
      await handle.close();
      handle = null;
      auditReadFailure(request, "INVALID_PATH", "rejected");
      return new NextResponse("Invalid path", {
        status: 400,
        headers: { "Cache-Control": "no-store" }
      });
    }

    let range;
    try {
      range = parseSingleByteRange(request.headers.get("range"), stat.size);
    } catch (error) {
      if (!(error instanceof RangeNotSatisfiableError)) throw error;
      await handle.close();
      handle = null;
      return new NextResponse(null, {
        status: 416,
        headers: {
          "Accept-Ranges": "bytes",
          "Cache-Control": "no-store",
          "Content-Range": `bytes */${stat.size}`
        }
      });
    }

    const ext = path.extname(realFilePath).toLowerCase();
    const mime = mimeMap[ext] ?? "application/octet-stream";
    const disposition =
      mime.startsWith("image/") ||
      mime.startsWith("audio/") ||
      mime === "application/pdf"
        ? "inline"
        : "attachment";
    const filename = encodeURIComponent(path.basename(realFilePath));
    const headers = new Headers({
      "Accept-Ranges": "bytes",
      "Cache-Control": "public, max-age=31536000, immutable",
      "Content-Disposition": `${disposition}; filename*=UTF-8''${filename}`,
      "Content-Length": String(range?.length ?? stat.size),
      "Content-Type": mime,
      "X-Content-Type-Options": "nosniff"
    });
    if (range) {
      headers.set(
        "Content-Range",
        `bytes ${range.start}-${range.end}/${stat.size}`
      );
    }

    const status = range ? 206 : 200;
    if (headOnly) {
      await handle.close();
      handle = null;
      return new NextResponse(null, { status, headers });
    }

    const nodeStream = handle.createReadStream({
      autoClose: true,
      ...(range ? { start: range.start, end: range.end } : {})
    });
    handle = null;
    const body = monitoredWebStream(nodeStream, (error) => {
      auditReadFailure(
        request,
        errorCode(error)
          ? `STREAM_${errorCode(error)}`
          : "STREAM_FAILED"
      );
    });
    return new NextResponse(body, { status, headers });
  } catch (error) {
    return readFailureResponse(request, error);
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

export async function GET(request: Request, context: RouteContext) {
  return serveMedia(request, context, false);
}

export async function HEAD(request: Request, context: RouteContext) {
  return serveMedia(request, context, true);
}
