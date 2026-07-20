import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync
} from "node:fs";
import path from "node:path";
import test from "node:test";
import { trackedTempDir } from "./fixtures/tracked-temp-dir";

test("post and media writes are replay-safe, bounded, and recoverable", async () => {
  const root = trackedTempDir("manjyun-idempotency-");
  process.env.DATA_DIR = path.join(root, "data");
  process.env.UPLOADS_DIR = path.join(root, "uploads");
  process.env.DATABASE_PATH = path.join(root, "data", "manjyun.sqlite");

  const {
    completeReservedIdempotentOperation,
    executeIdempotently,
    hashIdempotencyPayload,
    IdempotencyCapacityError,
    IdempotencyConflictError,
    InvalidIdempotencyKeyError,
    parseIdempotencyKey,
    pruneIdempotencyRequests,
    reserveIdempotentOperation
  } = await import("@/lib/db/idempotency");
  const {
    addMedia,
    deleteMediaRecord,
    findMediaReferences,
    getMediaById,
    listMedia,
    MediaInUseError,
    savePost
  } = await import("@/lib/db/queries");
  const { get, run, transaction } = await import("@/lib/db/client");
  const {
    commitStagedMediaDeletion,
    MediaStorageError,
    rollbackStagedMediaDeletion,
    stageMediaDeletion,
    writeMediaFileAtomically
  } = await import("@/lib/media/storage");
  const { reconcileMediaStorage } = await import("@/lib/media/reconcile");

  assert.throws(
    () => parseIdempotencyKey(null),
    (error: unknown) =>
      error instanceof InvalidIdempotencyKeyError &&
      error.reason === "required"
  );
  assert.throws(
    () => parseIdempotencyKey("too-short"),
    (error: unknown) => error instanceof InvalidIdempotencyKeyError
  );
  assert.equal(
    parseIdempotencyKey("post-create-00000001"),
    "post-create-00000001"
  );

  const createKey = "post-create-replay-0001";
  const createHash = hashIdempotencyPayload(
    JSON.stringify({ title: "Replay once", markdown: "body" })
  );
  let createCalls = 0;
  const firstCreate = executeIdempotently(
    "post:create:test",
    createKey,
    createHash,
    () => {
      createCalls += 1;
      const post = savePost({
        type: "post",
        title: "Replay once",
        markdown: "body",
        status: "draft",
        tags: []
      });
      return { id: post.id, slug: post.slug };
    }
  );
  const replayedCreate = executeIdempotently(
    "post:create:test",
    createKey,
    createHash,
    () => {
      createCalls += 1;
      throw new Error("replay must not execute");
    }
  );
  assert.equal(firstCreate.replayed, false);
  assert.equal(replayedCreate.replayed, true);
  assert.deepEqual(replayedCreate.response, firstCreate.response);
  assert.equal(createCalls, 1);
  assert.equal(
    get<{ count: number }>(
      "SELECT COUNT(*) AS count FROM posts WHERE title = ?",
      ["Replay once"]
    )?.count,
    1
  );
  assert.throws(
    () =>
      executeIdempotently(
        "post:create:test",
        createKey,
        hashIdempotencyPayload("different body"),
        () => ({ id: 999, slug: "must-not-run" })
      ),
    (error: unknown) => error instanceof IdempotencyConflictError
  );

  const old = "2020-01-01T00:00:00.000Z";
  run(
    `INSERT INTO idempotency_requests (
       scope, idempotency_key, request_hash, state,
       operation_json, response_json, created_at, updated_at
     ) VALUES (?, ?, ?, 'completed', '{}', '{}', ?, ?)`,
    ["retention:test", "old-completed-key-0001", "a".repeat(64), old, old]
  );
  pruneIdempotencyRequests("retention:test", Date.now());
  assert.equal(
    get(
      "SELECT 1 FROM idempotency_requests WHERE scope = ?",
      ["retention:test"]
    ),
    null
  );

  const capacityTime = new Date().toISOString();
  transaction(() => {
    for (let index = 0; index < 100; index += 1) {
      run(
        `INSERT INTO idempotency_requests (
           scope, idempotency_key, request_hash, state,
           operation_json, response_json, created_at, updated_at
         ) VALUES (?, ?, ?, 'processing', '{}', NULL, ?, ?)`,
        [
          "capacity:test",
          `processing-key-${String(index).padStart(4, "0")}`,
          String(index).padStart(64, "0"),
          capacityTime,
          capacityTime
        ]
      );
    }
  });
  assert.throws(
    () =>
      reserveIdempotentOperation(
        "capacity:test",
        "processing-key-overflow",
        "f".repeat(64),
        {}
      ),
    (error: unknown) => error instanceof IdempotencyCapacityError
  );

  const pngA = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01
  ]);
  const pngB = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x02
  ]);
  const uploadKey = "media-concurrent-replay-0001";
  const uploadHashA = hashIdempotencyPayload(pngA);
  const uploadHashB = hashIdempotencyPayload(pngB);
  const operationA = {
    filename: "2026/07/concurrent-a.png",
    originalName: "a.png",
    mime: "image/png",
    size: pngA.length,
    url: "/uploads/2026/07/concurrent-a.png",
    contentHash: uploadHashA
  };
  const operationB = {
    ...operationA,
    filename: "2026/07/concurrent-b.png",
    originalName: "b.png",
    url: "/uploads/2026/07/concurrent-b.png",
    contentHash: uploadHashB
  };

  const concurrentAdmission = await Promise.allSettled([
    Promise.resolve().then(() =>
      reserveIdempotentOperation(
        "media:upload:test",
        uploadKey,
        uploadHashA,
        operationA
      )
    ),
    Promise.resolve().then(() =>
      reserveIdempotentOperation(
        "media:upload:test",
        uploadKey,
        uploadHashB,
        operationB
      )
    )
  ]);
  assert.equal(
    concurrentAdmission.filter((result) => result.status === "fulfilled").length,
    1
  );
  const rejectedAdmission = concurrentAdmission.find(
    (result): result is PromiseRejectedResult => result.status === "rejected"
  );
  assert.ok(rejectedAdmission?.reason instanceof IdempotencyConflictError);

  const winner =
    concurrentAdmission[0].status === "fulfilled"
      ? { hash: uploadHashA, bytes: pngA, operation: operationA }
      : { hash: uploadHashB, bytes: pngB, operation: operationB };
  assert.equal(
    await writeMediaFileAtomically(winner.operation.filename, winner.bytes),
    "created"
  );
  const completedUpload = completeReservedIdempotentOperation(
    "media:upload:test",
    uploadKey,
    winner.hash,
    () =>
      addMedia({
        filename: winner.operation.filename,
        originalName: winner.operation.originalName,
        mime: winner.operation.mime,
        size: winner.operation.size,
        url: winner.operation.url
      })
  );
  assert.equal(completedUpload.replayed, false);
  const replayedUpload = reserveIdempotentOperation<
    typeof completedUpload.response,
    typeof operationA
  >(
    "media:upload:test",
    uploadKey,
    winner.hash,
    winner.operation
  );
  assert.equal(replayedUpload.state, "completed");
  assert.equal(replayedUpload.replayed, true);
  assert.equal(listMedia().length, 1);
  assert.deepEqual(
    readFileSync(path.join(process.env.UPLOADS_DIR!, ...winner.operation.filename.split("/"))),
    winner.bytes
  );

  await assert.rejects(
    () => writeMediaFileAtomically(winner.operation.filename, pngB),
    (error: unknown) =>
      error instanceof MediaStorageError && error.kind === "conflict"
  );
  assert.deepEqual(
    readFileSync(path.join(process.env.UPLOADS_DIR!, ...winner.operation.filename.split("/"))),
    winner.bytes
  );
  assert.equal(
    readdirSync(
      path.dirname(
        path.join(process.env.UPLOADS_DIR!, ...winner.operation.filename.split("/"))
      )
    ).some((name) => name.includes(".upload-") || name.endsWith(".publish-lock")),
    false
  );

  const referencedMedia = completedUpload.response;
  savePost({
    type: "post",
    title: "Media references",
    markdown: `![body](${referencedMedia.url})`,
    cover: referencedMedia.url,
    status: "draft",
    tags: []
  });
  run(
    `INSERT INTO nav_links (
       group_name, label, url, icon_url, sort_order
     ) VALUES ('frequent', 'Media link', 'https://example.com', ?, 1)`,
    [referencedMedia.url]
  );
  run(
    "INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)",
    ["test.media-reference", `See ${referencedMedia.url}`]
  );
  const references = findMediaReferences(referencedMedia.url);
  assert.ok(references.some((reference) => reference.kind === "post" && reference.field === "cover"));
  assert.ok(references.some((reference) => reference.kind === "post" && reference.field === "markdown"));
  assert.ok(references.some((reference) => reference.kind === "navigation"));
  assert.ok(references.some((reference) => reference.kind === "setting"));
  assert.throws(
    () => deleteMediaRecord(referencedMedia.id),
    (error: unknown) =>
      error instanceof MediaInUseError && error.references.length >= 4
  );

  const firstStage = await stageMediaDeletion(referencedMedia.filename);
  assert.equal(firstStage.state, "staged");
  await rollbackStagedMediaDeletion(firstStage);
  assert.equal(
    existsSync(
      path.join(process.env.UPLOADS_DIR!, ...referencedMedia.filename.split("/"))
    ),
    true
  );
  const finalStage = await stageMediaDeletion(referencedMedia.filename);
  const forcedDelete = deleteMediaRecord(referencedMedia.id, {
    allowReferenced: true
  });
  assert.equal(forcedDelete?.media.id, referencedMedia.id);
  assert.equal(await commitStagedMediaDeletion(finalStage), true);
  assert.equal(getMediaById(referencedMedia.id), null);
  assert.equal(
    existsSync(
      path.join(process.env.UPLOADS_DIR!, ...referencedMedia.filename.split("/"))
    ),
    false
  );

  const trackedFilename = "2026/07/tracked.png";
  await writeMediaFileAtomically(trackedFilename, pngA);
  addMedia({
    filename: trackedFilename,
    originalName: "tracked.png",
    mime: "image/png",
    size: pngA.length,
    url: `/uploads/${trackedFilename}`
  });
  addMedia({
    filename: "2026/07/missing.png",
    originalName: "missing.png",
    mime: "image/png",
    size: pngA.length,
    url: "/uploads/2026/07/missing.png"
  });
  await writeMediaFileAtomically("2026/07/orphan.png", pngA);
  await writeMediaFileAtomically("link-icons/cache.png", pngA);
  const transientDir = path.join(process.env.UPLOADS_DIR!, "2026", "07");
  mkdirSync(transientDir, { recursive: true });
  writeFileSync(path.join(transientDir, ".left.upload-test.tmp"), pngA);

  const report = await reconcileMediaStorage(listMedia());
  assert.equal(report.missingCount, 1);
  assert.ok(report.orphaned.includes("2026/07/orphan.png"));
  assert.equal(report.orphaned.some((name) => name.startsWith("link-icons/")), false);
  assert.ok(report.transient.includes("2026/07/.left.upload-test.tmp"));
});
