import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

test("post publishing keeps first published time and revisions restore linearly", async () => {
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
  assert.equal(restored?.status, originalRevision.status);
  assert.equal(restored?.publishedAt, firstPublishedAt);

  const revisionsAfterRestore = listPostRevisions(published.id);
  assert.ok(
    revisionsAfterRestore.every((revision) => revision.id < originalRevision.id)
  );
  assert.equal(
    revisionsAfterRestore.some((revision) => revision.reason.startsWith("restore")),
    false
  );

  const workflow = savePost({
    type: "post",
    title: "Workflow Check",
    slug: "workflow-check",
    markdown: "draft v1",
    status: "draft",
    tags: []
  });
  const workflowPublished = setPostStatus(workflow.id, "published");
  assert.equal(workflowPublished?.status, "published");

  savePost({
    id: workflow.id,
    type: "post",
    title: "Workflow Check",
    slug: "workflow-check",
    markdown: "published v2",
    status: "published",
    tags: []
  });
  assert.equal(setPostStatus(workflow.id, "draft")?.status, "draft");

  savePost({
    id: workflow.id,
    type: "post",
    title: "Workflow Check",
    slug: "workflow-check",
    markdown: "draft v3",
    status: "draft",
    tags: []
  });

  const workflowRevisions = listPostRevisions(workflow.id);
  const publishedBeforeUnpublish = workflowRevisions.find(
    (revision) => revision.status === "published" && revision.markdown === "published v2"
  );
  assert.ok(publishedBeforeUnpublish);
  const restoredPublished = restorePostRevision(workflow.id, publishedBeforeUnpublish.id);
  assert.equal(restoredPublished?.status, "published");
  assert.equal(restoredPublished?.markdown, "published v2");

  const draftWorkflow = savePost({
    type: "post",
    title: "Draft Workflow Check",
    slug: "draft-workflow-check",
    markdown: "draft base",
    status: "draft",
    tags: []
  });
  setPostStatus(draftWorkflow.id, "published");
  savePost({
    id: draftWorkflow.id,
    type: "post",
    title: "Draft Workflow Check",
    slug: "draft-workflow-check",
    markdown: "published body",
    status: "published",
    tags: []
  });
  setPostStatus(draftWorkflow.id, "draft");
  savePost({
    id: draftWorkflow.id,
    type: "post",
    title: "Draft Workflow Check",
    slug: "draft-workflow-check",
    markdown: "draft body",
    status: "draft",
    tags: []
  });

  const draftRevision = listPostRevisions(draftWorkflow.id).find(
    (revision) => revision.status === "draft" && revision.markdown === "published body"
  );
  assert.ok(draftRevision);
  const restoredDraft = restorePostRevision(draftWorkflow.id, draftRevision.id);
  assert.equal(restoredDraft?.status, "draft");
  assert.equal(restoredDraft?.markdown, "published body");
});
