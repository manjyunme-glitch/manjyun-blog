import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

test("post publishing keeps first published time and revisions restore to draft", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "manjyun-db-"));
  process.env.DATA_DIR = root;
  process.env.UPLOADS_DIR = path.join(root, "uploads");
  process.env.DATABASE_PATH = path.join(root, "manjyun.sqlite");

  const {
    listPostRevisions,
    restorePostRevision,
    savePost,
    setPostStatus
  } = await import("@/lib/db/queries");

  const published = savePost({
    type: "post",
    title: "Revision Anchor",
    slug: "revision-anchor",
    markdown: "original body",
    status: "published",
    tags: []
  });
  assert.ok(published.publishedAt);

  const firstPublishedAt = published.publishedAt;
  assert.equal(setPostStatus(published.id, "draft")?.publishedAt, firstPublishedAt);
  assert.equal(setPostStatus(published.id, "published")?.publishedAt, firstPublishedAt);

  const edited = savePost({
    id: published.id,
    type: "post",
    title: "Revision Anchor",
    slug: "revision-anchor",
    markdown: "edited body",
    status: "draft",
    tags: []
  });
  assert.equal(edited.publishedAt, firstPublishedAt);

  const originalRevision = listPostRevisions(published.id).find(
    (revision) => revision.markdown === "original body"
  );
  assert.ok(originalRevision);

  const restored = restorePostRevision(published.id, originalRevision.id);
  assert.equal(restored?.markdown, "original body");
  assert.equal(restored?.status, "draft");
  assert.equal(restored?.publishedAt, firstPublishedAt);
});
