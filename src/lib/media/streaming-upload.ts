import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { RequestBodyTooLargeError } from "@/lib/http/limited-form-data";
import {
  MediaStorageError,
  storageFailureKind
} from "@/lib/media/storage";
import { assertInside, getUploadsDir } from "@/lib/paths";

const maximumBoundaryBytes = 200;
const maximumPartHeaderBytes = 16 * 1024;
const parserChunkBytes = 64 * 1024;
const signatureBytes = 64;

export const maximumConcurrentMediaUploads = 4;

export class InvalidMultipartUploadError extends Error {
  constructor(
    message = "The multipart upload is invalid.",
    readonly reason:
      | "content-type"
      | "headers"
      | "file-required"
      | "multiple-parts"
      | "truncated"
      | "trailing-data"
      | "stream" = "stream"
  ) {
    super(message);
    this.name = "InvalidMultipartUploadError";
  }
}

export class UploadedFileTooLargeError extends Error {
  constructor() {
    super("The uploaded file is too large.");
    this.name = "UploadedFileTooLargeError";
  }
}

export class MediaUploadCapacityError extends Error {
  constructor() {
    super("Too many media uploads are active.");
    this.name = "MediaUploadCapacityError";
  }
}

export type StagedMediaUpload = {
  contentHash: string;
  originalName: string;
  signature: Uint8Array;
  size: number;
  temporaryPath: string;
};

type GlobalMediaUploadCapacity = typeof globalThis & {
  __manjyunActiveMediaUploadStreams?: number;
};

export function acquireMediaUploadSlot() {
  const state = globalThis as GlobalMediaUploadCapacity;
  const active = state.__manjyunActiveMediaUploadStreams ?? 0;
  if (active >= maximumConcurrentMediaUploads) {
    throw new MediaUploadCapacityError();
  }
  state.__manjyunActiveMediaUploadStreams = active + 1;

  let released = false;
  return () => {
    if (released) return;
    released = true;
    state.__manjyunActiveMediaUploadStreams = Math.max(
      0,
      (state.__manjyunActiveMediaUploadStreams ?? 1) - 1
    );
  };
}

export function resetMediaUploadCapacityForTests() {
  const state = globalThis as GlobalMediaUploadCapacity;
  state.__manjyunActiveMediaUploadStreams = 0;
}

function multipartBoundary(contentType: string | null) {
  if (!contentType) {
    throw new InvalidMultipartUploadError(
      "A multipart content type is required.",
      "content-type"
    );
  }
  const [mediaType] = contentType.split(";", 1);
  if (mediaType.trim().toLowerCase() !== "multipart/form-data") {
    throw new InvalidMultipartUploadError(
      "A multipart content type is required.",
      "content-type"
    );
  }

  const match = /(?:^|;)\s*boundary=(?:"([^"]+)"|([^;]+))/i.exec(
    contentType
  );
  const boundary = (match?.[1] ?? match?.[2] ?? "").trim();
  const length = Buffer.byteLength(boundary, "utf8");
  if (
    !boundary ||
    length > maximumBoundaryBytes ||
    /[\u0000-\u0020\u007f]/.test(boundary)
  ) {
    throw new InvalidMultipartUploadError(
      "The multipart boundary is invalid.",
      "content-type"
    );
  }
  return boundary;
}

function declaredRequestLength(request: Request, maxRequestBytes: number) {
  const raw = request.headers.get("content-length");
  if (raw === null) return;
  if (!/^\d+$/.test(raw)) {
    throw new InvalidMultipartUploadError(
      "The Content-Length header is invalid.",
      "headers"
    );
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value)) {
    throw new RequestBodyTooLargeError();
  }
  if (value > maxRequestBytes) throw new RequestBodyTooLargeError();
}

function unescapeQuotedValue(value: string) {
  return value.replace(/\\(["\\])/g, "$1");
}

function dispositionValue(
  disposition: string,
  parameter: "name" | "filename"
) {
  const expression = new RegExp(
    `(?:^|;)\\s*${parameter}="((?:\\\\.|[^"])*)"`,
    "i"
  );
  const match = expression.exec(disposition);
  return match ? unescapeQuotedValue(match[1]) : null;
}

function originalFilename(headerBlock: Buffer) {
  const raw = headerBlock.toString("utf8");
  if (raw.includes("\u0000")) {
    throw new InvalidMultipartUploadError(
      "The multipart headers are invalid.",
      "headers"
    );
  }
  const headers = new Map<string, string>();
  for (const line of raw.split("\r\n")) {
    const separator = line.indexOf(":");
    if (separator <= 0 || /^[ \t]/.test(line)) {
      throw new InvalidMultipartUploadError(
        "The multipart headers are invalid.",
        "headers"
      );
    }
    const name = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();
    if (!name || headers.has(name)) {
      throw new InvalidMultipartUploadError(
        "The multipart headers are invalid.",
        "headers"
      );
    }
    headers.set(name, value);
  }

  const disposition = headers.get("content-disposition") ?? "";
  if (!/^form-data(?:;|$)/i.test(disposition)) {
    throw new InvalidMultipartUploadError(
      "The multipart file disposition is invalid.",
      "headers"
    );
  }
  const fieldName = dispositionValue(disposition, "name");
  const filename = dispositionValue(disposition, "filename");
  if (fieldName !== "file" || filename === null) {
    throw new InvalidMultipartUploadError(
      "The file field is required.",
      "file-required"
    );
  }
  return filename;
}

class BoundedBodyReader {
  private readonly reader: ReadableStreamDefaultReader<Uint8Array>;
  private pending: Uint8Array | null = null;
  private pendingOffset = 0;
  private total = 0;

  constructor(
    body: ReadableStream<Uint8Array>,
    private readonly maxRequestBytes: number
  ) {
    this.reader = body.getReader();
  }

  async readChunk(): Promise<Uint8Array | null> {
    if (
      this.pending &&
      this.pendingOffset < this.pending.byteLength
    ) {
      const end = Math.min(
        this.pending.byteLength,
        this.pendingOffset + parserChunkBytes
      );
      const chunk = this.pending.subarray(this.pendingOffset, end);
      this.pendingOffset = end;
      if (end === this.pending.byteLength) {
        this.pending = null;
        this.pendingOffset = 0;
      }
      return chunk;
    }

    let result: ReadableStreamReadResult<Uint8Array>;
    try {
      result = await this.reader.read();
    } catch (error) {
      throw new InvalidMultipartUploadError(
        error instanceof Error ? error.message : "Unable to read request body.",
        "stream"
      );
    }
    if (result.done) return null;
    this.total += result.value.byteLength;
    if (this.total > this.maxRequestBytes) {
      throw new RequestBodyTooLargeError();
    }
    this.pending = result.value;
    this.pendingOffset = 0;
    return this.readChunk();
  }

  async cancel() {
    await this.reader.cancel().catch(() => undefined);
  }

  release() {
    this.reader.releaseLock();
  }
}

function appendChunk(
  buffer: Buffer<ArrayBufferLike>,
  chunk: Uint8Array
): Buffer<ArrayBufferLike> {
  const next = Buffer.from(
    chunk.buffer,
    chunk.byteOffset,
    chunk.byteLength
  );
  return buffer.length ? Buffer.concat([buffer, next]) : next;
}

function asStorageError(message: string, error: unknown) {
  if (error instanceof MediaStorageError) return error;
  return new MediaStorageError(message, storageFailureKind(error), {
    cause: error
  });
}

async function createStagingFile() {
  const uploadsDir = getUploadsDir();
  try {
    await fs.mkdir(uploadsDir, { recursive: true });
  } catch (error) {
    throw asStorageError(
      "Unable to prepare the media staging directory.",
      error
    );
  }
  const temporaryPath = path.join(
    uploadsDir,
    `.media.upload-${crypto.randomUUID()}.tmp`
  );
  try {
    return {
      handle: await fs.open(temporaryPath, "wx", 0o600),
      temporaryPath
    };
  } catch (error) {
    throw asStorageError("Unable to create a media staging file.", error);
  }
}

export async function discardStagedMediaUpload(
  upload: Pick<StagedMediaUpload, "temporaryPath"> | string
) {
  const temporaryPath =
    typeof upload === "string" ? upload : upload.temporaryPath;
  const uploadsDir = getUploadsDir();
  let safePath: string;
  try {
    safePath = assertInside(uploadsDir, temporaryPath);
  } catch {
    return false;
  }
  if (
    path.dirname(safePath) !== uploadsDir ||
    !/^\..+\.upload-[a-f0-9-]+\.tmp$/i.test(path.basename(safePath))
  ) {
    return false;
  }
  try {
    await fs.unlink(safePath);
    return true;
  } catch (error) {
    return storageFailureKind(error) === "not-found";
  }
}

export async function streamMediaUploadToStaging(
  request: Request,
  options: {
    maxFileBytes: number;
    maxRequestBytes: number;
  }
): Promise<StagedMediaUpload> {
  let boundary: string;
  try {
    declaredRequestLength(request, options.maxRequestBytes);
    boundary = multipartBoundary(request.headers.get("content-type"));
  } catch (error) {
    await request.body?.cancel().catch(() => undefined);
    throw error;
  }
  if (!request.body) {
    throw new InvalidMultipartUploadError(
      "The multipart request body is missing.",
      "file-required"
    );
  }

  const reader = new BoundedBodyReader(
    request.body,
    options.maxRequestBytes
  );
  let handle: fs.FileHandle | null = null;
  let temporaryPath = "";
  let completed = false;

  try {
    const staging = await createStagingFile();
    handle = staging.handle;
    temporaryPath = staging.temporaryPath;

    const opening = Buffer.from(`--${boundary}\r\n`, "utf8");
    const headerTerminator = Buffer.from("\r\n\r\n", "ascii");
    let buffer: Buffer<ArrayBufferLike> = Buffer.alloc(0);
    while (buffer.indexOf(headerTerminator) < 0) {
      const chunk = await reader.readChunk();
      if (!chunk) {
        throw new InvalidMultipartUploadError(
          "The multipart request ended before its headers.",
          "truncated"
        );
      }
      buffer = appendChunk(buffer, chunk);
      if (
        buffer.indexOf(headerTerminator) < 0 &&
        buffer.length >
        opening.length + maximumPartHeaderBytes + headerTerminator.length
      ) {
        throw new InvalidMultipartUploadError(
          "The multipart headers are too large.",
          "headers"
        );
      }
    }

    if (
      buffer.length < opening.length ||
      !buffer.subarray(0, opening.length).equals(opening)
    ) {
      throw new InvalidMultipartUploadError(
        "The multipart opening boundary is invalid.",
        "truncated"
      );
    }
    const headerEnd = buffer.indexOf(headerTerminator, opening.length);
    if (
      headerEnd < opening.length ||
      headerEnd - opening.length > maximumPartHeaderBytes
    ) {
      throw new InvalidMultipartUploadError(
        "The multipart headers are invalid.",
        "headers"
      );
    }
    const filename = originalFilename(
      buffer.subarray(opening.length, headerEnd)
    );
    buffer = buffer.subarray(headerEnd + headerTerminator.length);

    const delimiter = Buffer.from(`\r\n--${boundary}`, "utf8");
    const hash = crypto.createHash("sha256");
    const signature: Buffer[] = [];
    let signatureLength = 0;
    let size = 0;

    const write = async (bytes: Uint8Array) => {
      if (!bytes.byteLength) return;
      if (size + bytes.byteLength > options.maxFileBytes) {
        throw new UploadedFileTooLargeError();
      }
      hash.update(bytes);
      if (signatureLength < signatureBytes) {
        const length = Math.min(
          signatureBytes - signatureLength,
          bytes.byteLength
        );
        signature.push(Buffer.from(bytes.subarray(0, length)));
        signatureLength += length;
      }
      try {
        let offset = 0;
        while (offset < bytes.byteLength) {
          const result = await handle!.write(
            bytes,
            offset,
            bytes.byteLength - offset,
            null
          );
          if (result.bytesWritten <= 0) {
            throw new Error("The media staging write made no progress.");
          }
          offset += result.bytesWritten;
        }
      } catch (error) {
        throw asStorageError(
          "Unable to write the media staging file.",
          error
        );
      }
      size += bytes.byteLength;
    };

    let foundClosingBoundary = false;
    while (!foundClosingBoundary) {
      const index = buffer.indexOf(delimiter);
      if (index >= 0) {
        const suffixOffset = index + delimiter.length;
        while (buffer.length < suffixOffset + 2) {
          const chunk = await reader.readChunk();
          if (!chunk) {
            throw new InvalidMultipartUploadError(
              "The multipart closing boundary is truncated.",
              "truncated"
            );
          }
          buffer = appendChunk(buffer, chunk);
        }
        const suffix = buffer.subarray(suffixOffset, suffixOffset + 2);
        if (suffix.equals(Buffer.from("--", "ascii"))) {
          await write(buffer.subarray(0, index));
          buffer = buffer.subarray(suffixOffset + 2);
          foundClosingBoundary = true;
          break;
        }
        if (suffix.equals(Buffer.from("\r\n", "ascii"))) {
          throw new InvalidMultipartUploadError(
            "Only one file part is accepted.",
            "multiple-parts"
          );
        }

        // A delimiter-looking byte sequence inside the file is data unless
        // it is followed by a legal multipart delimiter suffix.
        await write(buffer.subarray(0, index + 1));
        buffer = buffer.subarray(index + 1);
        continue;
      }

      const retainedBytes = delimiter.length + 2;
      if (buffer.length > retainedBytes) {
        const flushed = buffer.length - retainedBytes;
        await write(buffer.subarray(0, flushed));
        buffer = buffer.subarray(flushed);
      }
      const chunk = await reader.readChunk();
      if (!chunk) {
        throw new InvalidMultipartUploadError(
          "The multipart closing boundary is missing.",
          "truncated"
        );
      }
      buffer = appendChunk(buffer, chunk);
    }

    while (true) {
      if (buffer.length > 2) {
        throw new InvalidMultipartUploadError(
          "Unexpected data follows the multipart upload.",
          "trailing-data"
        );
      }
      const chunk = await reader.readChunk();
      if (!chunk) break;
      buffer = appendChunk(buffer, chunk);
    }
    if (
      buffer.length !== 0 &&
      !buffer.equals(Buffer.from("\r\n", "ascii"))
    ) {
      throw new InvalidMultipartUploadError(
        "Unexpected data follows the multipart upload.",
        "trailing-data"
      );
    }

    try {
      await handle.sync();
      await handle.close();
      handle = null;
    } catch (error) {
      throw asStorageError("Unable to sync the media staging file.", error);
    }
    completed = true;
    return {
      contentHash: hash.digest("hex"),
      originalName: filename,
      signature: Buffer.concat(signature, signatureLength),
      size,
      temporaryPath
    };
  } finally {
    if (!completed) {
      await reader.cancel();
      await handle?.close().catch(() => undefined);
      if (temporaryPath) {
        await fs.unlink(temporaryPath).catch(() => undefined);
      }
    }
    reader.release();
  }
}
