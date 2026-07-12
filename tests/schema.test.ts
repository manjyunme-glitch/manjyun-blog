import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { ensureSchema } from "@/lib/db/schema";

test("schema migration adds revision tags without reseeding an existing empty navigation", () => {
  const root = mkdtempSync(path.join(tmpdir(), "manjyun-schema-"));
  const db = new DatabaseSync(path.join(root, "schema.sqlite"));
  db.exec(`
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
  db.close();
});

test("schema migration preserves customized blog labels", () => {
  const root = mkdtempSync(path.join(tmpdir(), "manjyun-schema-custom-"));
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
