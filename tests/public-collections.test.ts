import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import {
  adminPublicContentHref,
  adminPublicTagHref
} from "@/lib/admin/content-list";
import {
  isCanonicalPublicPageParam,
  normalizePublicPageParam,
  publicCollectionPageHref
} from "@/lib/content/public-pagination";
import { trackedTempDir } from "./fixtures/tracked-temp-dir";

test("public page parameters and admin public links use canonical, reachable URLs", () => {
  assert.equal(normalizePublicPageParam(undefined), 1);
  assert.equal(normalizePublicPageParam("2"), 2);
  for (const value of [
    "0",
    "-1",
    "1.5",
    "1e3",
    " 2 ",
    "abc",
    "1000000000",
    ["2"]
  ]) {
    assert.equal(normalizePublicPageParam(value), 1);
  }

  assert.equal(isCanonicalPublicPageParam(undefined, 1), true);
  assert.equal(isCanonicalPublicPageParam("1", 1), false);
  assert.equal(isCanonicalPublicPageParam("02", 2), false);
  assert.equal(isCanonicalPublicPageParam(["2"], 2), false);
  assert.equal(isCanonicalPublicPageParam("2", 2), true);
  assert.equal(publicCollectionPageHref("/posts", 1), "/posts");
  assert.equal(publicCollectionPageHref("/posts", 2), "/posts?page=2");

  assert.equal(
    adminPublicContentHref({
      status: "published",
      type: "post",
      slug: "visible"
    }),
    "/posts/visible"
  );
  assert.equal(
    adminPublicContentHref({
      status: "draft",
      type: "post",
      slug: "draft"
    }),
    null
  );
  assert.equal(
    adminPublicContentHref({
      status: "trashed",
      type: "project",
      slug: "trashed"
    }),
    null
  );
  assert.equal(adminPublicTagHref("published", "public-tag"), "/tag/public-tag");
  assert.equal(adminPublicTagHref("draft", "draft-only"), null);
  assert.equal(adminPublicTagHref("trashed", "trash-only"), null);

  const tableSource = readFileSync(
    new URL("../src/components/admin/AdminContentTable.tsx", import.meta.url),
    "utf8"
  );
  assert.match(tableSource, /adminPublicContentHref\(post\)/);
  assert.match(tableSource, /adminPublicTagHref\(post\.status,\s*tag\.slug\)/);
  assert.doesNotMatch(tableSource, /href=\{`\/tag\/\$\{tag\.slug\}`\}/);
});

test("public collection queries select summaries, batch tags and clamp page bounds", async () => {
  const root = trackedTempDir("manjyun-public-collections-");
  process.env.DATA_DIR = root;
  process.env.UPLOADS_DIR = path.join(root, "uploads");
  process.env.DATABASE_PATH = path.join(root, "manjyun.sqlite");

  const {
    getTagBySlug,
    getTags,
    listPublishedFeedItems,
    listPublishedPostSummaries,
    listPublishedPostSummaryPage,
    listPublishedSitemapEntries,
    savePost
  } = await import("@/lib/db/queries");

  const publishedIds: number[] = [];
  for (let index = 1; index <= 15; index += 1) {
    const post = savePost({
      type: "post",
      title: `Public ${String(index).padStart(2, "0")}`,
      markdown: `large private-to-summary body ${index} ${"x".repeat(2_000)}`,
      excerpt: `Excerpt ${index}`,
      cover: index === 15 ? "/uploads/cover.webp" : "",
      seoDescription: `SEO ${index}`,
      status: "published",
      tags: index >= 11 ? ["Shared", `Tag ${index}`] : ["Shared"]
    });
    publishedIds.push(post.id);
  }
  savePost({
    type: "post",
    title: "Draft must stay private",
    markdown: "draft body",
    status: "draft",
    tags: ["DraftOnly"]
  });
  savePost({
    type: "project",
    title: "Published project",
    markdown: "project body",
    status: "published",
    tags: ["Shared"]
  });
  savePost({
    type: "page",
    title: "Legacy tagged page",
    slug: "legacy-tagged-page",
    markdown: "page body",
    status: "published",
    tags: ["PageOnly"]
  });
  assert.equal(getTagBySlug("pageonly"), null);
  assert.equal(getTags().some((tag) => tag.slug === "pageonly"), false);
  assert.ok(getTagBySlug("shared"));
  const sitemap = (await import("@/app/sitemap")).default();
  assert.equal(sitemap.some((entry) => entry.url.endsWith("/tag/pageonly")), false);

  const prototype = DatabaseSync.prototype as unknown as {
    prepare: (sql: string) => unknown;
  };
  const originalPrepare = prototype.prepare;
  const statements: string[] = [];
  prototype.prepare = function prepare(sql: string) {
    statements.push(sql.replace(/\s+/g, " ").trim());
    return originalPrepare.call(this, sql);
  };

  try {
    const firstPage = listPublishedPostSummaryPage({
      type: "post",
      page: 1,
      pageSize: 5
    });
    assert.equal(firstPage.total, 15);
    assert.equal(firstPage.totalPages, 3);
    assert.equal(firstPage.page, 1);
    assert.equal(firstPage.posts.length, 5);
    assert.deepEqual(
      firstPage.posts.map((post) => post.id),
      publishedIds.slice(-5).reverse()
    );
    assert.equal(firstPage.posts[0]?.cover, "/uploads/cover.webp");
    assert.deepEqual(
      firstPage.posts[0]?.tags.map((tag) => tag.name),
      ["Shared", "Tag 15"]
    );
    assert.equal("markdown" in firstPage.posts[0]!, false);
    assert.equal("seoDescription" in firstPage.posts[0]!, false);
    assert.equal("status" in firstPage.posts[0]!, false);
    assert.equal("version" in firstPage.posts[0]!, false);

    const selects = statements.filter((sql) => /^SELECT /i.test(sql));
    assert.equal(selects.length, 3);
    const summarySql = selects.find(
      (sql) => sql.includes("FROM posts p") && sql.includes("LIMIT ? OFFSET ?")
    );
    assert.ok(summarySql);
    const projection = summarySql.slice(0, summarySql.indexOf(" FROM posts p"));
    assert.doesNotMatch(
      projection,
      /\bmarkdown\b|seo_title|seo_description|\bstatus\b|\bversion\b/i
    );
    const tagQueries = selects.filter((sql) =>
      sql.includes("WHERE pt.post_id IN")
    );
    assert.equal(tagQueries.length, 1);
    assert.match(tagQueries[0]!, /WHERE pt\.post_id IN \(\?, \?, \?, \?, \?\)/);
    assert.doesNotMatch(tagQueries[0]!, /WHERE pt\.post_id = \?/);

    statements.length = 0;
    const overflowPage = listPublishedPostSummaryPage({
      type: "post",
      page: 999_999_999,
      pageSize: 5
    });
    assert.equal(overflowPage.page, 3);
    assert.equal(overflowPage.posts.length, 5);
    assert.equal(isCanonicalPublicPageParam("999999999", overflowPage.page), false);
    assert.equal(
      publicCollectionPageHref("/posts", overflowPage.page),
      "/posts?page=3"
    );

    statements.length = 0;
    const tagged = listPublishedPostSummaryPage({
      tagSlug: "shared",
      pageSize: 50
    });
    assert.equal(tagged.total, 16);
    assert.ok(tagged.posts.some((post) => post.type === "project"));
    assert.ok(tagged.posts.every((post) => post.tags.some((tag) => tag.slug === "shared")));
    assert.equal(
      statements.filter((sql) => sql.includes("WHERE pt.post_id IN")).length,
      1
    );

    statements.length = 0;
    const recent = listPublishedPostSummaries({ type: "post", limit: 3 });
    assert.equal(recent.length, 3);
    assert.equal(statements.filter((sql) => /^SELECT /i.test(sql)).length, 2);

    statements.length = 0;
    const feed = listPublishedFeedItems(50);
    assert.equal(feed.length, 15);
    assert.equal("markdown" in feed[0]!, false);
    const feedProjection = statements[0]!.slice(
      0,
      statements[0]!.indexOf(" FROM posts p")
    );
    assert.doesNotMatch(feedProjection, /\bmarkdown\b|seo_title|\bcover\b/i);

    statements.length = 0;
    const sitemapEntries = listPublishedSitemapEntries("post");
    assert.equal(sitemapEntries.length, 15);
    assert.deepEqual(
      Object.keys(sitemapEntries[0]!).sort(),
      ["slug", "type", "updatedAt"]
    );
    assert.doesNotMatch(statements[0]!, /\bmarkdown\b|excerpt|seo_|cover/i);

    const renderPostsPage = (await import("@/app/posts/page")).default;
    async function redirectedTo(page: string | string[]) {
      try {
        await renderPostsPage({
          searchParams: Promise.resolve({ page })
        });
        assert.fail("Expected the collection route to redirect.");
      } catch (error) {
        const digest =
          error && typeof error === "object" && "digest" in error
            ? String(error.digest)
            : "";
        assert.match(digest, /^NEXT_REDIRECT;/);
        return digest.split(";")[2];
      }
    }

    assert.equal(await redirectedTo("1"), "/posts");
    assert.equal(await redirectedTo("02"), "/posts?page=2");
    assert.equal(await redirectedTo(["2", "3"]), "/posts");
    assert.equal(await redirectedTo("999999999"), "/posts?page=2");

    const canonicalSecondPage = await renderPostsPage({
      searchParams: Promise.resolve({ page: "2" })
    });
    const canonicalView = canonicalSecondPage.props.view;
    assert.equal(canonicalView.pagination.currentPage, 2);
    assert.equal(canonicalView.pagination.totalPages, 2);
    assert.equal(canonicalView.entries.length, 3);
  } finally {
    prototype.prepare = originalPrepare;
  }
});
