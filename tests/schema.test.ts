import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { ensureSchema } from "@/lib/db/schema";
import { trackedTempDir } from "./fixtures/tracked-temp-dir";

function waitForChild(child: ReturnType<typeof spawn>) {
  return new Promise<{
    code: number | null;
    stderr: string;
    stdout: string;
  }>((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr?.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.once("error", reject);
    child.once("close", (code) => resolve({ code, stderr, stdout }));
  });
}

test("schema migration adds revision tags without reseeding an existing empty navigation", () => {
  const root = trackedTempDir("manjyun-schema-");
  const db = new DatabaseSync(path.join(root, "schema.sqlite"));
  db.exec(`
    CREATE TABLE admin_users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    INSERT INTO admin_users (username, password_hash)
    VALUES ('legacy-admin', 'legacy-hash');

    CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    INSERT INTO settings (key, value) VALUES
      ('siteTitle', 'Existing Blog'),
      ('blogTitle', 'All Posts'),
      ('blogDescription', '按时间倒序浏览博客文章。');

    CREATE TABLE posts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL CHECK (type IN ('post', 'page', 'project')),
      slug TEXT NOT NULL,
      title TEXT NOT NULL,
      markdown TEXT NOT NULL DEFAULT '',
      excerpt TEXT,
      cover TEXT,
      status TEXT NOT NULL CHECK (status IN ('draft', 'published', 'trashed')) DEFAULT 'draft',
      published_at TEXT,
      seo_title TEXT,
      seo_description TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(type, slug)
    );

    CREATE TABLE post_revisions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
      type TEXT NOT NULL CHECK (type IN ('post', 'page', 'project')),
      slug TEXT NOT NULL,
      title TEXT NOT NULL,
      markdown TEXT NOT NULL DEFAULT '',
      excerpt TEXT,
      cover TEXT,
      status TEXT NOT NULL CHECK (status IN ('draft', 'published', 'trashed')),
      published_at TEXT,
      seo_title TEXT,
      seo_description TEXT,
      post_created_at TEXT NOT NULL,
      post_updated_at TEXT NOT NULL,
      reason TEXT NOT NULL DEFAULT 'save',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  ensureSchema(db);

  const revisionColumns = db.prepare("PRAGMA table_info(post_revisions)").all() as Array<{
    name: string;
  }>;
  assert.ok(revisionColumns.some((column) => column.name === "tags_json"));
  const adminColumns = db.prepare("PRAGMA table_info(admin_users)").all() as Array<{
    name: string;
  }>;
  assert.ok(adminColumns.some((column) => column.name === "session_version"));
  assert.equal(
    (db.prepare("SELECT session_version AS version FROM admin_users").get() as {
      version: number;
    }).version,
    1
  );
  const postColumns = db.prepare("PRAGMA table_info(posts)").all() as Array<{
    name: string;
  }>;
  assert.ok(postColumns.some((column) => column.name === "version"));
  assert.equal(
    (db.prepare("SELECT version FROM site_configuration_meta WHERE id = 1").get() as {
      version: number;
    }).version,
    1
  );
  assert.equal(
    (db.prepare("SELECT COUNT(*) AS count FROM nav_links WHERE group_name = 'main'").get() as {
      count: number;
    }).count,
    0
  );
  assert.equal(
    (db.prepare("SELECT value FROM settings WHERE key = ?").get("system.seed.main_nav.v1") as {
      value: string;
    }).value,
    "1"
  );
  assert.equal(
    (db.prepare("SELECT value FROM settings WHERE key = 'blogTitle'").get() as {
      value: string;
    }).value,
    "随笔"
  );
  assert.equal(
    (db.prepare("SELECT value FROM settings WHERE key = 'blogDescription'").get() as {
      value: string;
    }).value,
    "按时间倒序浏览随笔。"
  );

  db.prepare(
    "INSERT INTO home_modules (id, enabled, sort_order, config) VALUES (?, ?, ?, ?)"
  ).run("legacy-unknown", 1, 999, "{}");
  ensureSchema(db);
  assert.equal(
    (db.prepare("SELECT COUNT(*) AS count FROM home_modules WHERE id = ?").get(
      "legacy-unknown"
    ) as { count: number }).count,
    0
  );
  assert.equal(
    (db.prepare("SELECT version FROM site_configuration_meta WHERE id = 1").get() as {
      version: number;
    }).version,
    1
  );
  db.close();
});

test("schema migration preserves customized blog labels", () => {
  const root = trackedTempDir("manjyun-schema-custom-");
  const db = new DatabaseSync(path.join(root, "schema.sqlite"));
  db.exec(`
    CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    INSERT INTO settings (key, value) VALUES
      ('blogTitle', '我的手记'),
      ('blogDescription', '只记录值得留下来的东西。');
  `);

  ensureSchema(db);

  const values = Object.fromEntries(
    (db.prepare(
      "SELECT key, value FROM settings WHERE key IN ('blogTitle', 'blogDescription')"
    ).all() as Array<{ key: string; value: string }>).map(({ key, value }) => [key, value])
  );
  assert.deepEqual(values, {
    blogDescription: "只记录值得留下来的东西。",
    blogTitle: "我的手记"
  });
  db.close();
});

test("legacy About settings become the canonical published page exactly once", () => {
  const root = trackedTempDir("manjyun-schema-about-settings-");
  const db = new DatabaseSync(path.join(root, "schema.sqlite"));
  db.exec(`
    CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    INSERT INTO settings (key, value) VALUES
      ('aboutTitle', '旧设置标题'),
      ('aboutMarkdown', '旧设置正文，必须原样保留。');
  `);

  ensureSchema(db);
  ensureSchema(db);

  const pages = db.prepare(
    `SELECT slug, title, markdown, status
     FROM posts WHERE type = 'page' ORDER BY id`
  ).all() as Array<{
    slug: string;
    title: string;
    markdown: string;
    status: string;
  }>;
  assert.deepEqual(pages.map((page) => ({ ...page })), [{
    slug: "about",
    title: "旧设置标题",
    markdown: "旧设置正文，必须原样保留。",
    status: "published"
  }]);
  assert.equal(
    (db.prepare(
      "SELECT value FROM settings WHERE key = 'system.migration.about_page.v1'"
    ).get() as { value: string }).value,
    "1"
  );
  db.close();
});

test("published legacy About wins while different customized settings are preserved as one draft", () => {
  const root = trackedTempDir("manjyun-schema-about-published-");
  const db = new DatabaseSync(path.join(root, "schema.sqlite"));
  db.exec(`
    CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    INSERT INTO settings (key, value) VALUES
      ('aboutTitle', '设置里的旧标题'),
      ('aboutMarkdown', '设置里的旧正文');

    CREATE TABLE posts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL CHECK (type IN ('post', 'page', 'project')),
      slug TEXT NOT NULL,
      title TEXT NOT NULL,
      markdown TEXT NOT NULL DEFAULT '',
      excerpt TEXT,
      cover TEXT,
      status TEXT NOT NULL CHECK (status IN ('draft', 'published', 'trashed')) DEFAULT 'draft',
      published_at TEXT,
      seo_title TEXT,
      seo_description TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(type, slug)
    );
    INSERT INTO posts (type, slug, title, markdown, status, published_at)
    VALUES ('page', 'about', '页面标题', '页面正文', 'published', datetime('now'));
  `);

  ensureSchema(db);
  ensureSchema(db);

  const pages = db.prepare(
    `SELECT slug, title, markdown, status
     FROM posts WHERE type = 'page' ORDER BY id`
  ).all() as Array<{
    slug: string;
    title: string;
    markdown: string;
    status: string;
  }>;
  assert.deepEqual(pages.map((page) => ({ ...page })), [
    {
      slug: "about",
      title: "页面标题",
      markdown: "页面正文",
      status: "published"
    },
    {
      slug: "about-settings-legacy",
      title: "设置里的旧标题（旧设置备份）",
      markdown: "设置里的旧正文",
      status: "draft"
    }
  ]);
  db.close();
});

test("draft or trashed legacy About remains a backup while settings keep /about public", () => {
  for (const status of ["draft", "trashed"] as const) {
    const root = trackedTempDir(`manjyun-schema-about-${status}-`);
    const db = new DatabaseSync(path.join(root, "schema.sqlite"));
    db.exec(`
      CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      INSERT INTO settings (key, value) VALUES
        ('aboutTitle', '公开回退标题'),
        ('aboutMarkdown', '公开回退正文');

      CREATE TABLE posts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT NOT NULL CHECK (type IN ('post', 'page', 'project')),
        slug TEXT NOT NULL,
        title TEXT NOT NULL,
        markdown TEXT NOT NULL DEFAULT '',
        excerpt TEXT,
        cover TEXT,
        status TEXT NOT NULL CHECK (status IN ('draft', 'published', 'trashed')) DEFAULT 'draft',
        published_at TEXT,
        seo_title TEXT,
        seo_description TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(type, slug)
      );
      INSERT INTO posts (type, slug, title, markdown, status)
      VALUES ('page', 'about', '未公开页面', '未公开正文', '${status}');
    `);

    ensureSchema(db);
    ensureSchema(db);

    const pages = db.prepare(
      `SELECT slug, title, markdown, status
       FROM posts WHERE type = 'page' ORDER BY id`
    ).all() as Array<{
      slug: string;
      title: string;
      markdown: string;
      status: string;
    }>;
    assert.deepEqual(pages.map((page) => ({ ...page })), [
      {
        slug: "about-unpublished-legacy",
        title: "未公开页面",
        markdown: "未公开正文",
        status
      },
      {
        slug: "about",
        title: "公开回退标题",
        markdown: "公开回退正文",
        status: "published"
      }
    ]);
    db.close();
  }
});

test("schema migration is serialized across processes", async () => {
  const root = trackedTempDir("manjyun-schema-race-");
  const databasePath = path.join(root, "schema.sqlite");
  const database = new DatabaseSync(databasePath);
  database.exec(`
    CREATE TABLE admin_users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  database.close();

  const barrier = path.join(root, "start");
  const fixture = path.join(
    process.cwd(),
    "tests",
    "fixtures",
    "ensure-schema-racer.ts"
  );
  const tsxCli = path.join(
    process.cwd(),
    "node_modules",
    "tsx",
    "dist",
    "cli.mjs"
  );
  const racers = ["first", "second"].map((racerId) =>
    spawn(process.execPath, [tsxCli, fixture], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        DATABASE_PATH: databasePath,
        SCHEMA_TEST_BARRIER: barrier,
        SCHEMA_TEST_RACER_ID: racerId
      },
      stdio: ["ignore", "pipe", "pipe"]
    })
  );
  const resultsPromise = Promise.all(racers.map(waitForChild));
  const readyDeadline = Date.now() + 5000;
  while (
    !["first", "second"].every((racerId) =>
      fs.existsSync(`${barrier}.${racerId}.ready`)
    )
  ) {
    if (Date.now() >= readyDeadline) {
      throw new Error("Timed out waiting for schema racers.");
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  fs.writeFileSync(barrier, "go");

  const results = await resultsPromise;
  for (const result of results) {
    assert.equal(result.code, 0, result.stderr);
    assert.equal(result.stdout, "migrated");
  }

  const check = new DatabaseSync(databasePath);
  const adminColumns = check
    .prepare("PRAGMA table_info(admin_users)")
    .all() as Array<{ name: string }>;
  assert.equal(
    adminColumns.filter((column) => column.name === "session_version").length,
    1
  );
  check.close();
});
