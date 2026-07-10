import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

test("post publishing preserves first publish time and safe revision history", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "manjyun-db-"));
  process.env.DATA_DIR = root;
  process.env.UPLOADS_DIR = path.join(root, "uploads");
  process.env.DATABASE_PATH = path.join(root, "manjyun.sqlite");

  const {
    getAdjacentPosts,
    getPostById,
    getSiteSettings,
    getTagBySlug,
    listPosts,
    listPostRevisions,
    replaceNavLinks,
    restorePostRevision,
    savePost,
    setPostStatus,
    updateSiteConfiguration
  } = await import("@/lib/db/queries");

  const firstAutoSlug = savePost({
    type: "post",
    title: "First Auto Slug",
    markdown: "auto body",
    status: "draft",
    tags: ["Alpha", "Beta"]
  });
  assert.equal(firstAutoSlug.slug, "posts-001");
  assert.deepEqual(
    listPosts({ type: "post" }).find((post) => post.id === firstAutoSlug.id)?.tags?.map((tag) => tag.name),
    ["Alpha", "Beta"]
  );

  const secondAutoSlug = savePost({
    type: "post",
    title: "Second Auto Slug",
    markdown: "auto body",
    status: "published",
    tags: []
  });
  assert.equal(secondAutoSlug.slug, "posts-002");

  const projectAutoSlug = savePost({
    type: "project",
    title: "Project Auto Slug",
    markdown: "auto body",
    status: "draft",
    tags: []
  });
  assert.equal(projectAutoSlug.slug, "projects-001");

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
  assert.ok(revisionsAfterRestore.some((revision) => revision.id === originalRevision.id));
  assert.ok(revisionsAfterRestore.some((revision) => revision.reason === "restore-before"));

  const tagged = savePost({
    type: "post",
    title: "Tagged Revision",
    markdown: "tagged body",
    status: "draft",
    tags: ["Old"]
  });
  savePost({
    id: tagged.id,
    type: "post",
    title: tagged.title,
    slug: tagged.slug,
    markdown: tagged.markdown,
    status: "draft",
    tags: ["New"]
  });
  const oldTagRevision = listPostRevisions(tagged.id).find(
    (revision) => revision.tags?.[0] === "Old"
  );
  assert.ok(oldTagRevision);
  assert.deepEqual(
    restorePostRevision(tagged.id, oldTagRevision.id)?.tags.map((tag) => tag.name),
    ["Old"]
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

  const cpp = savePost({
    type: "post",
    title: "C++",
    markdown: "cpp",
    status: "published",
    tags: ["C++"]
  });
  const csharp = savePost({
    type: "post",
    title: "C#",
    markdown: "csharp",
    status: "published",
    tags: ["C#"]
  });
  assert.deepEqual(getPostById(cpp.id)?.tags.map((tag) => [tag.slug, tag.name]), [["c", "C++"]]);
  assert.deepEqual(getPostById(csharp.id)?.tags.map((tag) => [tag.slug, tag.name]), [["c-2", "C#"]]);

  const tiedAt = "2026-01-01T00:00:00.000Z";
  const tiedA = savePost({
    type: "post",
    title: "Tied A",
    markdown: "a",
    status: "published",
    publishedAt: tiedAt,
    tags: []
  });
  const tiedB = savePost({
    type: "post",
    title: "Tied B",
    markdown: "b",
    status: "published",
    publishedAt: tiedAt,
    tags: []
  });
  assert.equal(getAdjacentPosts(tiedA).next?.id, tiedB.id);
  assert.equal(getAdjacentPosts(tiedB).prev?.id, tiedA.id);

  const draftOnly = savePost({
    type: "post",
    title: "Draft Tag",
    markdown: "draft",
    status: "draft",
    tags: ["DraftOnly"]
  });
  assert.ok(draftOnly.tags.some((tag) => tag.slug === "draftonly"));
  assert.equal(getTagBySlug("draftonly"), null);

  const originalSiteTitle = getSiteSettings().siteTitle;
  assert.throws(() =>
    updateSiteConfiguration({
      settings: { siteTitle: "Must roll back" },
      modules: [
        {
          id: "invalid-config",
          enabled: true,
          sortOrder: 999,
          config: { unsupported: 1n }
        }
      ],
      mainLinks: [],
      frequentLinks: []
    })
  );
  assert.equal(getSiteSettings().siteTitle, originalSiteTitle);

  replaceNavLinks("main", []);
  const { getDb } = await import("@/lib/db/client");
  const { ensureSchema } = await import("@/lib/db/schema");
  getDb().prepare("DELETE FROM settings WHERE key = ?").run("system.seed.main_nav.v1");
  ensureSchema(getDb());
  assert.deepEqual(
    (await import("@/lib/db/queries")).getNavLinks("main"),
    []
  );

  const { get, run, transaction } = await import("@/lib/db/client");
  assert.throws(() =>
    transaction(() => {
      run("INSERT INTO settings (key, value) VALUES (?, ?)", ["test.outer", "1"]);
      transaction(() => {
        run("INSERT INTO settings (key, value) VALUES (?, ?)", ["test.inner", "1"]);
        throw new Error("rollback nested write");
      });
    })
  );
  assert.equal(get("SELECT value FROM settings WHERE key = ?", ["test.outer"]), null);
  assert.equal(get("SELECT value FROM settings WHERE key = ?", ["test.inner"]), null);
});
