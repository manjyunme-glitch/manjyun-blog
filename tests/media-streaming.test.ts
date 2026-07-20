import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs, {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import test from "node:test";
import { RequestBodyTooLargeError } from "@/lib/http/limited-form-data";
import {
  monitoredWebStream,
  parseSingleByteRange,
  RangeNotSatisfiableError
} from "@/lib/media/http-download";
import { validateMediaFile } from "@/lib/media/file-validation";
import {
  MediaStorageError,
  publishStagedMediaFileAtomically
} from "@/lib/media/storage";
import {
  acquireMediaUploadSlot,
  discardStagedMediaUpload,
  InvalidMultipartUploadError,
  maximumConcurrentMediaUploads,
  MediaUploadCapacityError,
  resetMediaUploadCapacityForTests,
  streamMediaUploadToStaging,
  UploadedFileTooLargeError
} from "@/lib/media/streaming-upload";

function mediaRequest(
  bytes: Uint8Array,
  filename = "sample.png",
  type = "application/octet-stream",
  extraField = false
) {
  const formData = new FormData();
  const fileBuffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(fileBuffer).set(bytes);
  formData.append("file", new File([fileBuffer], filename, { type }));
  if (extraField) formData.append("extra", "not accepted");
  return new Request("http://localhost/api/admin/media", {
    method: "POST",
    body: formData
  });
}

function rawMultipartRequest(
  boundary: string,
  bytes: Uint8Array,
  options: {
    chunks?: number[];
    closing?: boolean;
    contentLength?: number;
    extraHeaders?: string;
    quotedBoundary?: boolean;
  } = {}
) {
  const opening = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="raw.png"\r\n${options.extraHeaders ?? ""}\r\n`,
    "utf8"
  );
  const closing =
    options.closing === false
      ? Buffer.alloc(0)
      : Buffer.from(`\r\n--${boundary}--\r\n`, "utf8");
  const body = Buffer.concat([opening, Buffer.from(bytes), closing]);
  const headers = new Headers({
    "Content-Type": `multipart/form-data; boundary=${
      options.quotedBoundary ? `"${boundary}"` : boundary
    }`
  });
  if (options.contentLength !== undefined) {
    headers.set("Content-Length", String(options.contentLength));
  }

  let offset = 0;
  let chunkIndex = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset >= body.length) {
        controller.close();
        return;
      }
      const requested =
        options.chunks?.[chunkIndex++] ?? body.length - offset;
      const end = Math.min(body.length, offset + Math.max(1, requested));
      controller.enqueue(body.subarray(offset, end));
      offset = end;
    }
  });
  return {
    body,
    request: new Request(
      "http://localhost/api/admin/media",
      {
        method: "POST",
        headers,
        body: stream,
        duplex: "half"
      } as RequestInit & { duplex: "half" }
    )
  };
}

async function stage(
  bytes: Uint8Array,
  maxFileBytes = 1024 * 1024,
  filename = "sample.png"
) {
  return streamMediaUploadToStaging(mediaRequest(bytes, filename), {
    maxFileBytes,
    maxRequestBytes: maxFileBytes + 256 * 1024
  });
}

test("media multipart uploads stream to a bounded staging file and publish atomically", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "manjyun-stream-upload-"));
  const previousUploadsDir = process.env.UPLOADS_DIR;
  process.env.UPLOADS_DIR = root;
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.alloc(192 * 1024, 0x61)
  ]);

  try {
    const staged = await stage(png, 256 * 1024, "测试 image.png");
    assert.equal(staged.originalName, "测试 image.png");
    assert.equal(staged.size, png.length);
    assert.equal(
      staged.contentHash,
      crypto.createHash("sha256").update(png).digest("hex")
    );
    assert.deepEqual(readFileSync(staged.temporaryPath), png);
    assert.equal(validateMediaFile(staged.signature)?.mime, "image/png");

    assert.equal(
      await publishStagedMediaFileAtomically(
        "2026/07/streamed.png",
        staged.temporaryPath,
        staged.contentHash
      ),
      "created"
    );
    assert.equal(existsSync(staged.temporaryPath), false);
    assert.deepEqual(
      readFileSync(path.join(root, "2026", "07", "streamed.png")),
      png
    );

    const replay = await stage(png, 256 * 1024);
    assert.equal(
      await publishStagedMediaFileAtomically(
        "2026/07/streamed.png",
        replay.temporaryPath,
        replay.contentHash
      ),
      "existing"
    );
    assert.equal(existsSync(replay.temporaryPath), false);

    const conflict = await stage(
      Buffer.concat([png.subarray(0, 8), Buffer.from("different")]),
      256 * 1024
    );
    await assert.rejects(
      () =>
        publishStagedMediaFileAtomically(
          "2026/07/streamed.png",
          conflict.temporaryPath,
          conflict.contentHash
        ),
      (error: unknown) =>
        error instanceof MediaStorageError && error.kind === "conflict"
    );
    await discardStagedMediaUpload(conflict);
  } finally {
    if (previousUploadsDir === undefined) delete process.env.UPLOADS_DIR;
    else process.env.UPLOADS_DIR = previousUploadsDir;
    rmSync(root, { recursive: true, force: true });
  }
});

test("streaming upload rejects empty, oversized, forged, multipart, and interrupted input safely", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "manjyun-stream-invalid-"));
  const previousUploadsDir = process.env.UPLOADS_DIR;
  process.env.UPLOADS_DIR = root;

  try {
    const empty = await stage(Buffer.alloc(0), 32);
    assert.equal(empty.size, 0);
    assert.equal(validateMediaFile(empty.signature), null);
    await discardStagedMediaUpload(empty);

    await assert.rejects(
      () => stage(Buffer.alloc(33, 0x61), 32),
      UploadedFileTooLargeError
    );

    const forged = await stage(
      Buffer.from("<svg><script>alert(1)</script></svg>"),
      1024,
      "forged.png"
    );
    assert.equal(validateMediaFile(forged.signature), null);
    await discardStagedMediaUpload(forged);

    await assert.rejects(
      () =>
        streamMediaUploadToStaging(
          mediaRequest(Buffer.from("safe"), "safe.png", "image/png", true),
          { maxFileBytes: 1024, maxRequestBytes: 2048 }
        ),
      (error: unknown) =>
        error instanceof InvalidMultipartUploadError &&
        error.reason === "multiple-parts"
    );

    const declaredTooLarge = new Request(
      "http://localhost/api/admin/media",
      {
        method: "POST",
        headers: {
          "Content-Length": "4096",
          "Content-Type": "multipart/form-data; boundary=declared"
        },
        body: Buffer.from("not consumed"),
        duplex: "half"
      } as RequestInit & { duplex: "half" }
    );
    await assert.rejects(
      () =>
        streamMediaUploadToStaging(declaredTooLarge, {
          maxFileBytes: 1024,
          maxRequestBytes: 2048
        }),
      RequestBodyTooLargeError
    );

    const encoder = new TextEncoder();
    const brokenBody = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          encoder.encode(
            "--broken\r\nContent-Disposition: form-data; name=\"file\"; filename=\"x.png\"\r\n\r\n"
          )
        );
        controller.error(new Error("client disconnected"));
      }
    });
    const interrupted = new Request(
      "http://localhost/api/admin/media",
      {
        method: "POST",
        headers: {
          "Content-Type": "multipart/form-data; boundary=broken"
        },
        body: brokenBody,
        duplex: "half"
      } as RequestInit & { duplex: "half" }
    );
    await assert.rejects(
      () =>
        streamMediaUploadToStaging(interrupted, {
          maxFileBytes: 1024,
          maxRequestBytes: 2048
        }),
      (error: unknown) =>
        error instanceof InvalidMultipartUploadError &&
        error.reason === "stream"
    );

    assert.deepEqual(
      fs
        .readdirSync(root)
        .filter((name) => name.includes(".upload-")),
      []
    );
  } finally {
    if (previousUploadsDir === undefined) delete process.env.UPLOADS_DIR;
    else process.env.UPLOADS_DIR = previousUploadsDir;
    rmSync(root, { recursive: true, force: true });
  }
});

test("multipart boundaries remain correct across chunks, false delimiters, and exact limits", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "manjyun-stream-boundary-"));
  const previousUploadsDir = process.env.UPLOADS_DIR;
  process.env.UPLOADS_DIR = root;
  const boundary = "quoted-boundary-0123456789";
  const payload = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.from(`prefix\r\n--${boundary}Xstill-file-data`, "utf8")
  ]);

  try {
    const exact = rawMultipartRequest(boundary, payload, {
      chunks: Array.from({ length: 256 }, () => 3),
      quotedBoundary: true
    });
    exact.request.headers.set("Content-Length", String(exact.body.length));
    const staged = await streamMediaUploadToStaging(exact.request, {
      maxFileBytes: payload.length,
      maxRequestBytes: exact.body.length
    });
    assert.deepEqual(readFileSync(staged.temporaryPath), payload);
    assert.equal(staged.size, payload.length);
    await discardStagedMediaUpload(staged);

    const fileTooLarge = rawMultipartRequest(boundary, payload);
    await assert.rejects(
      () =>
        streamMediaUploadToStaging(fileTooLarge.request, {
          maxFileBytes: payload.length - 1,
          maxRequestBytes: fileTooLarge.body.length
        }),
      UploadedFileTooLargeError
    );

    const requestTooLarge = rawMultipartRequest(boundary, payload, {
      contentLength: 0
    });
    requestTooLarge.request.headers.set(
      "Content-Length",
      String(requestTooLarge.body.length)
    );
    await assert.rejects(
      () =>
        streamMediaUploadToStaging(requestTooLarge.request, {
          maxFileBytes: payload.length,
          maxRequestBytes: requestTooLarge.body.length - 1
        }),
      RequestBodyTooLargeError
    );

    const oversizedHeaders = rawMultipartRequest(
      boundary,
      Buffer.from("data"),
      { extraHeaders: `X-Fill: ${"x".repeat(17 * 1024)}\r\n` }
    );
    await assert.rejects(
      () =>
        streamMediaUploadToStaging(oversizedHeaders.request, {
          maxFileBytes: 1024,
          maxRequestBytes: oversizedHeaders.body.length
        }),
      (error: unknown) =>
        error instanceof InvalidMultipartUploadError &&
        error.reason === "headers"
    );

    const truncated = rawMultipartRequest(
      boundary,
      Buffer.from("truncated"),
      { closing: false }
    );
    await assert.rejects(
      () =>
        streamMediaUploadToStaging(truncated.request, {
          maxFileBytes: 1024,
          maxRequestBytes: truncated.body.length
        }),
      (error: unknown) =>
        error instanceof InvalidMultipartUploadError &&
        error.reason === "truncated"
    );

    assert.deepEqual(
      fs
        .readdirSync(root)
        .filter((name) => name.includes(".upload-")),
      []
    );
  } finally {
    if (previousUploadsDir === undefined) delete process.env.UPLOADS_DIR;
    else process.env.UPLOADS_DIR = previousUploadsDir;
    rmSync(root, { recursive: true, force: true });
  }
});

test("an aborted upload closes and removes its staging file", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "manjyun-stream-abort-"));
  const previousUploadsDir = process.env.UPLOADS_DIR;
  process.env.UPLOADS_DIR = root;
  const encoder = new TextEncoder();
  let controller:
    | ReadableStreamDefaultController<Uint8Array>
    | undefined;
  const body = new ReadableStream<Uint8Array>({
    start(current) {
      controller = current;
      current.enqueue(
        encoder.encode(
          "--abort\r\nContent-Disposition: form-data; name=\"file\"; filename=\"abort.png\"\r\n\r\n"
        )
      );
    }
  });
  const request = new Request(
    "http://localhost/api/admin/media",
    {
      method: "POST",
      headers: {
        "Content-Type": "multipart/form-data; boundary=abort"
      },
      body,
      duplex: "half"
    } as RequestInit & { duplex: "half" }
  );

  try {
    const pending = streamMediaUploadToStaging(request, {
      maxFileBytes: 1024,
      maxRequestBytes: 2048
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    controller?.error(new DOMException("client canceled", "AbortError"));
    await assert.rejects(
      () => pending,
      (error: unknown) =>
        error instanceof InvalidMultipartUploadError &&
        error.reason === "stream"
    );
    assert.deepEqual(
      fs
        .readdirSync(root)
        .filter((name) => name.includes(".upload-")),
      []
    );
  } finally {
    if (previousUploadsDir === undefined) delete process.env.UPLOADS_DIR;
    else process.env.UPLOADS_DIR = previousUploadsDir;
    // Recursive deletion succeeds on Windows only if the parser closed its
    // staging handle before resolving the rejection.
    rmSync(root, { recursive: true, force: false });
  }
});

test("streaming upload maps staging write setup failures and bounds concurrency", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "manjyun-stream-storage-"));
  const blocked = path.join(root, "not-a-directory");
  writeFileSync(blocked, "file");
  const previousUploadsDir = process.env.UPLOADS_DIR;
  process.env.UPLOADS_DIR = blocked;

  try {
    await assert.rejects(
      () => stage(Buffer.from("bytes"), 1024),
      MediaStorageError
    );
  } finally {
    if (previousUploadsDir === undefined) delete process.env.UPLOADS_DIR;
    else process.env.UPLOADS_DIR = previousUploadsDir;
    rmSync(root, { recursive: true, force: true });
  }

  resetMediaUploadCapacityForTests();
  const releases = Array.from(
    { length: maximumConcurrentMediaUploads },
    () => acquireMediaUploadSlot()
  );
  assert.throws(() => acquireMediaUploadSlot(), MediaUploadCapacityError);
  releases[0]();
  const replacement = acquireMediaUploadSlot();
  replacement();
  releases.slice(1).forEach((release) => release());
  resetMediaUploadCapacityForTests();
});

test("single byte ranges cover fixed, open-ended, suffix, clipped, and invalid forms", () => {
  assert.equal(parseSingleByteRange(null, 10), null);
  assert.deepEqual(parseSingleByteRange("bytes=0-3", 10), {
    start: 0,
    end: 3,
    length: 4
  });
  assert.deepEqual(parseSingleByteRange("bytes=7-", 10), {
    start: 7,
    end: 9,
    length: 3
  });
  assert.deepEqual(parseSingleByteRange("bytes=-3", 10), {
    start: 7,
    end: 9,
    length: 3
  });
  assert.deepEqual(parseSingleByteRange("bytes=0-999", 10), {
    start: 0,
    end: 9,
    length: 10
  });
  assert.deepEqual(parseSingleByteRange("bytes=-999", 10), {
    start: 0,
    end: 9,
    length: 10
  });

  for (const value of [
    "bytes=10-",
    "bytes=5-4",
    "bytes=-0",
    "bytes=-",
    "bytes=0-1,4-5",
    "items=0-1"
  ]) {
    assert.throws(
      () => parseSingleByteRange(value, 10),
      RangeNotSatisfiableError
    );
  }
  assert.throws(
    () => parseSingleByteRange("bytes=0-0", 0),
    RangeNotSatisfiableError
  );
});

test("public uploads stream full, ranged, suffix, HEAD, invalid, and concurrent responses", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "manjyun-stream-download-"));
  const previousUploadsDir = process.env.UPLOADS_DIR;
  process.env.UPLOADS_DIR = root;
  const directory = path.join(root, "2026", "07");
  mkdirSync(directory, { recursive: true });
  const filename = path.join(directory, "sample.bin");
  writeFileSync(filename, "0123456789");
  mkdirSync(path.join(root, "directory-only"));
  writeFileSync(path.join(root, "plain-file"), "not a directory");

  try {
    const { GET, HEAD } = await import(
      "@/app/uploads/[...path]/route"
    );
    const context = {
      params: Promise.resolve({ path: ["2026", "07", "sample.bin"] })
    };

    const full = await GET(
      new Request("http://localhost/uploads/2026/07/sample.bin"),
      context
    );
    assert.equal(full.status, 200);
    assert.equal(full.headers.get("accept-ranges"), "bytes");
    assert.equal(full.headers.get("content-length"), "10");
    assert.equal(await full.text(), "0123456789");

    const fixed = await GET(
      new Request("http://localhost/uploads/2026/07/sample.bin", {
        headers: { Range: "bytes=2-5" }
      }),
      context
    );
    assert.equal(fixed.status, 206);
    assert.equal(fixed.headers.get("content-range"), "bytes 2-5/10");
    assert.equal(fixed.headers.get("content-length"), "4");
    assert.equal(await fixed.text(), "2345");

    const suffix = await GET(
      new Request("http://localhost/uploads/2026/07/sample.bin", {
        headers: { Range: "bytes=-3" }
      }),
      context
    );
    assert.equal(suffix.status, 206);
    assert.equal(await suffix.text(), "789");

    const head = await HEAD(
      new Request("http://localhost/uploads/2026/07/sample.bin", {
        method: "HEAD",
        headers: { Range: "bytes=4-" }
      }),
      context
    );
    assert.equal(head.status, 206);
    assert.equal(head.headers.get("content-range"), "bytes 4-9/10");
    assert.equal(head.headers.get("content-length"), "6");
    assert.equal(await head.text(), "");

    for (const range of ["bytes=99-", "bytes=0-1,4-5"]) {
      const invalid = await GET(
        new Request("http://localhost/uploads/2026/07/sample.bin", {
          headers: { Range: range }
        }),
        context
      );
      assert.equal(invalid.status, 416);
      assert.equal(invalid.headers.get("content-range"), "bytes */10");
    }

    const missing = await GET(
      new Request("http://localhost/uploads/missing.bin"),
      { params: Promise.resolve({ path: ["missing.bin"] }) }
    );
    assert.equal(missing.status, 404);

    const traversal = await GET(
      new Request("http://localhost/uploads/../outside"),
      { params: Promise.resolve({ path: ["..", "outside"] }) }
    );
    assert.equal(traversal.status, 400);

    const directoryResponse = await GET(
      new Request("http://localhost/uploads/directory-only"),
      {
        params: Promise.resolve({
          path: ["directory-only"]
        })
      }
    );
    assert.equal(directoryResponse.status, 400);

    const notDirectory = await GET(
      new Request("http://localhost/uploads/plain-file/child"),
      {
        params: Promise.resolve({
          path: ["plain-file", "child"]
        })
      }
    );
    assert.equal(notDirectory.status, 404);

    const concurrent = await Promise.all(
      Array.from({ length: 20 }, (_, index) =>
        GET(
          new Request("http://localhost/uploads/2026/07/sample.bin", {
            headers: { Range: `bytes=${index % 10}-${index % 10}` }
          }),
          context
        ).then((response) => response.text())
      )
    );
    assert.deepEqual(
      concurrent,
      Array.from({ length: 20 }, (_, index) => String(index % 10))
    );
  } finally {
    if (previousUploadsDir === undefined) delete process.env.UPLOADS_DIR;
    else process.env.UPLOADS_DIR = previousUploadsDir;
    rmSync(root, { recursive: true, force: true });
  }
});

test("download stream monitoring surfaces stream errors to the audit hook", async () => {
  const observed: Error[] = [];
  let emitted = false;
  const source = new Readable({
    read() {
      if (emitted) return;
      emitted = true;
      this.push(Buffer.from("first"));
      this.destroy(new Error("simulated read failure"));
    }
  });
  const stream = monitoredWebStream(source, (error) => observed.push(error));
  const reader = stream.getReader();
  await assert.rejects(async () => {
    while (!(await reader.read()).done) {
      // Consume until the simulated storage failure reaches the web stream.
    }
  }, /simulated read failure/);
  assert.equal(observed.length, 1);
  assert.match(observed[0].message, /simulated read failure/);
});

test("canceling a web download destroys the Node stream and closes its file handle", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "manjyun-stream-cancel-"));
  const filename = path.join(root, "large.bin");
  writeFileSync(filename, Buffer.alloc(256 * 1024, 0x61));
  const handle = await fs.promises.open(filename, "r");
  const source = handle.createReadStream({
    autoClose: true,
    highWaterMark: 1024
  });
  const observed: Error[] = [];
  const stream = monitoredWebStream(source, (error) => observed.push(error));
  const reader = stream.getReader();

  const first = await reader.read();
  assert.equal(first.done, false);
  const closed = new Promise<void>((resolve) => {
    source.once("close", () => resolve());
  });
  await reader.cancel("client stopped reading");
  await closed;
  assert.equal(source.destroyed, true);
  assert.equal(observed.length, 0);
  await assert.rejects(() => handle.stat(), /closed|EBADF/i);
  rmSync(root, { recursive: true, force: false });
});
