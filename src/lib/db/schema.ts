import type { DatabaseSync } from "node:sqlite";

const defaultSettings = {
  siteTitle: "ManJyun",
  siteDescription: "一个自托管的个人博客与折腾记录。",
  baseUrl: process.env.SITE_URL ?? "http://localhost:4482",
  activeTheme: "manjyun-console",
  heroBio:
    "折腾爱好者，热衷于 self-hosting 和各种不务正业的技术实验。相信能自建的绝不用别人的，能折腾的绝不躺平。",
  heroTags: "Homelab,Networking,NAS,Docker,Linux,Proxy,Self-hosted",
  stackItems:
    "Debian,Docker,Nginx,Cloudflare,Python,Mihomo,Xray,Hysteria2,WireGuard,ZFS",
  uptimeStart: "2026-03-20",
  blogTitle: "随笔",
  blogDescription: "按时间倒序浏览随笔。",
  projectsTitle: "Projects",
  projectsDescription: "记录已经完成、正在折腾、或者值得复盘的项目。",
  aboutTitle: "About",
  aboutMarkdown:
    "这里是关于页面。可以在后台“页面”工作台使用 Markdown 编辑。"
};

const defaultModules = [
  ["recentPosts", 1, 10, { title: "Recent Posts", limit: 3 }],
  [
    "now",
    1,
    20,
    {
      title: "Now",
      workingOn: "博客的搭建和完善。",
      reading: "各种 self-hosted 项目和网络穿透方案。",
      completed: [
        "Jellyfin",
        "Komga",
        "AdGuard Home",
        "Homelab 网络架构优化"
      ]
    }
  ],
  ["projects", 1, 30, { title: "Projects", limit: 3 }],
  ["frequentLinks", 1, 40, { title: "Frequent" }],
  ["stack", 1, 50, { title: "Stack" }]
] as const;

const defaultMainLinks = [
  ["main", "home", "/", 10],
  ["main", "posts", "/posts", 20],
  ["main", "projects", "/projects", 30],
  ["main", "about", "/about", 40]
] as const;

const legacyAboutDefaults = new Set([
  "这里是关于页面。可以在后台设置里写 Markdown，也可以创建 slug 为 `about` 的页面来覆盖它。"
]);

export function ensureSchema(db: DatabaseSync) {
  const hadExistingSettingsTable = Boolean(
    db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'settings'").get()
  );

  // Every instance performs the check-and-migrate sequence while holding the
  // SQLite writer lock. Without this lock two containers starting on the same
  // old database can both observe a missing column and race the same ALTER.
  // Foreign keys are disabled only for the legacy posts table rebuild and are
  // restored before this function returns.
  db.exec("PRAGMA foreign_keys = OFF;");
  db.exec("BEGIN IMMEDIATE;");
  try {
    db.exec(`
    CREATE TABLE IF NOT EXISTS admin_users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      session_version INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS posts (
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
      version INTEGER NOT NULL DEFAULT 1,
      UNIQUE(type, slug)
    );

    CREATE TABLE IF NOT EXISTS tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slug TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS post_tags (
      post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
      tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
      PRIMARY KEY (post_id, tag_id)
    );

    CREATE TABLE IF NOT EXISTS post_revisions (
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
      tags_json TEXT,
      post_created_at TEXT NOT NULL,
      post_updated_at TEXT NOT NULL,
      reason TEXT NOT NULL DEFAULT 'save',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS media (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      filename TEXT NOT NULL,
      original_name TEXT NOT NULL,
      mime TEXT NOT NULL,
      size INTEGER NOT NULL,
      url TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS idempotency_requests (
      scope TEXT NOT NULL,
      idempotency_key TEXT NOT NULL,
      request_hash TEXT NOT NULL,
      state TEXT NOT NULL CHECK (state IN ('processing', 'completed')),
      operation_json TEXT NOT NULL DEFAULT '{}',
      response_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (scope, idempotency_key)
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS site_configuration_meta (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      version INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS home_modules (
      id TEXT PRIMARY KEY,
      enabled INTEGER NOT NULL DEFAULT 1,
      sort_order INTEGER NOT NULL DEFAULT 0,
      config TEXT NOT NULL DEFAULT '{}'
    );

    CREATE TABLE IF NOT EXISTS nav_links (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      group_name TEXT NOT NULL CHECK (group_name IN ('main', 'frequent', 'footer')),
      label TEXT NOT NULL,
      url TEXT NOT NULL,
      icon_url TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS theme_installs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      theme_id TEXT NOT NULL,
      name TEXT NOT NULL,
      version TEXT NOT NULL,
      description TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('compatible', 'incompatible')),
      issues TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_posts_status_type_published
      ON posts(status, type, published_at DESC);
    CREATE INDEX IF NOT EXISTS idx_post_tags_tag
      ON post_tags(tag_id, post_id);
    CREATE INDEX IF NOT EXISTS idx_post_revisions_post_created
      ON post_revisions(post_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_nav_links_group
      ON nav_links(group_name, sort_order);
    CREATE INDEX IF NOT EXISTS idx_idempotency_scope_state_updated
      ON idempotency_requests(scope, state, updated_at DESC);
  `);

  migratePostStatus(db);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_posts_status_type_published
      ON posts(status, type, published_at DESC);
    CREATE INDEX IF NOT EXISTS idx_post_tags_tag
      ON post_tags(tag_id, post_id);
    CREATE INDEX IF NOT EXISTS idx_post_revisions_post_created
      ON post_revisions(post_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_nav_links_group
      ON nav_links(group_name, sort_order);
    CREATE INDEX IF NOT EXISTS idx_idempotency_scope_state_updated
      ON idempotency_requests(scope, state, updated_at DESC);
  `);

  const navColumns = db.prepare("PRAGMA table_info(nav_links)").all() as Array<{ name: string }>;
  if (!navColumns.some((column) => column.name === "icon_url")) {
    db.exec("ALTER TABLE nav_links ADD COLUMN icon_url TEXT");
  }

  const revisionColumns = db.prepare("PRAGMA table_info(post_revisions)").all() as Array<{ name: string }>;
  if (!revisionColumns.some((column) => column.name === "tags_json")) {
    db.exec("ALTER TABLE post_revisions ADD COLUMN tags_json TEXT");
  }

  const adminColumns = db.prepare("PRAGMA table_info(admin_users)").all() as Array<{ name: string }>;
  if (!adminColumns.some((column) => column.name === "session_version")) {
    db.exec("ALTER TABLE admin_users ADD COLUMN session_version INTEGER NOT NULL DEFAULT 1");
  }

  const postColumns = db.prepare("PRAGMA table_info(posts)").all() as Array<{ name: string }>;
  if (!postColumns.some((column) => column.name === "version")) {
    db.exec("ALTER TABLE posts ADD COLUMN version INTEGER NOT NULL DEFAULT 1");
  }

  db.prepare(
    "INSERT OR IGNORE INTO site_configuration_meta (id, version) VALUES (1, 1)"
  ).run();

  const settingStmt = db.prepare(
    "INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)"
  );
  for (const [key, value] of Object.entries(defaultSettings)) {
    settingStmt.run(key, value);
  }

  migrateLegacyAboutSettings(db, settingStmt);

  // Rename only untouched legacy defaults. Custom titles/descriptions are user
  // content and must never be overwritten during an application upgrade.
  const legacyDefaultStmt = db.prepare(
    "UPDATE settings SET value = ? WHERE key = ? AND value = ?"
  );
  legacyDefaultStmt.run("随笔", "blogTitle", "All Posts");
  legacyDefaultStmt.run(
    "按时间倒序浏览随笔。",
    "blogDescription",
    "按时间倒序浏览博客文章。"
  );

  const moduleStmt = db.prepare(
    "INSERT OR IGNORE INTO home_modules (id, enabled, sort_order, config) VALUES (?, ?, ?, ?)"
  );
  db.exec(`
    DELETE FROM home_modules
    WHERE id NOT IN ('recentPosts', 'now', 'projects', 'frequentLinks', 'stack')
  `);
  for (const [id, enabled, sortOrder, config] of defaultModules) {
    moduleStmt.run(id, enabled, sortOrder, JSON.stringify(config));
  }

  const mainNavSeedKey = "system.seed.main_nav.v1";
  const mainNavSeeded = db
    .prepare("SELECT value FROM settings WHERE key = ?")
    .get(mainNavSeedKey);
  if (!mainNavSeeded) {
    const linkCount = db
      .prepare("SELECT COUNT(*) AS count FROM nav_links WHERE group_name = 'main'")
      .get() as { count: number };
    if (!hadExistingSettingsTable && linkCount.count === 0) {
      const linkStmt = db.prepare(
        "INSERT INTO nav_links (group_name, label, url, sort_order) VALUES (?, ?, ?, ?)"
      );
      for (const link of defaultMainLinks) {
        linkStmt.run(...link);
      }
    }
    settingStmt.run(mainNavSeedKey, "1");
  }
    db.exec("COMMIT;");
  } catch (error) {
    try {
      db.exec("ROLLBACK;");
    } catch {
      // Preserve the migration error if SQLite already rolled the transaction
      // back while handling it.
    }
    throw error;
  } finally {
    db.exec("PRAGMA foreign_keys = ON;");
  }
}

function migrateLegacyAboutSettings(
  db: DatabaseSync,
  settingStmt: ReturnType<DatabaseSync["prepare"]>
) {
  const migrationKey = "system.migration.about_page.v1";
  if (db.prepare("SELECT 1 FROM settings WHERE key = ?").get(migrationKey)) {
    return;
  }

  const rows = db.prepare(
    "SELECT key, value FROM settings WHERE key IN ('aboutTitle', 'aboutMarkdown')"
  ).all() as Array<{ key: string; value: string }>;
  const legacy = Object.fromEntries(rows.map(({ key, value }) => [key, value]));
  const title = String(legacy.aboutTitle ?? defaultSettings.aboutTitle).trim() || "About";
  const markdown = String(legacy.aboutMarkdown ?? defaultSettings.aboutMarkdown);
  const existing = db.prepare(
    `SELECT id, title, markdown, status
     FROM posts
     WHERE type = 'page' AND slug = 'about'`
  ).get() as {
    id: number;
    title: string;
    markdown: string;
    status: "draft" | "published" | "trashed";
  } | undefined;
  const now = new Date().toISOString();

  if (!existing) {
    db.prepare(
      `INSERT INTO posts (
        type, slug, title, markdown, status, published_at, created_at, updated_at
      ) VALUES ('page', 'about', ?, ?, 'published', ?, ?, ?)`
    ).run(title, markdown, now, now, now);
  } else if (existing.status !== "published") {
    let backupSlug = "about-unpublished-legacy";
    let suffix = 2;
    while (
      db.prepare("SELECT 1 FROM posts WHERE type = 'page' AND slug = ?").get(
        backupSlug
      )
    ) {
      backupSlug = `about-unpublished-legacy-${suffix}`;
      suffix += 1;
    }
    db.prepare(
      "UPDATE posts SET slug = ?, updated_at = ? WHERE id = ?"
    ).run(backupSlug, now, existing.id);
    db.prepare(
      `INSERT INTO posts (
        type, slug, title, markdown, status, published_at, created_at, updated_at
      ) VALUES ('page', 'about', ?, ?, 'published', ?, ?, ?)`
    ).run(title, markdown, now, now, now);
  } else {
    const customizedLegacySettings =
      title !== defaultSettings.aboutTitle ||
      (!legacyAboutDefaults.has(markdown) && markdown !== defaultSettings.aboutMarkdown);
    const differsFromPage =
      existing.title !== title || existing.markdown !== markdown;

    if (customizedLegacySettings && differsFromPage) {
      let backupSlug = "about-settings-legacy";
      let suffix = 2;
      while (
        db.prepare("SELECT 1 FROM posts WHERE type = 'page' AND slug = ?").get(
          backupSlug
        )
      ) {
        backupSlug = `about-settings-legacy-${suffix}`;
        suffix += 1;
      }
      db.prepare(
        `INSERT INTO posts (
          type, slug, title, markdown, status, created_at, updated_at
        ) VALUES ('page', ?, ?, ?, 'draft', ?, ?)`
      ).run(backupSlug, `${title}（旧设置备份）`, markdown, now, now);
    }
  }

  settingStmt.run(migrationKey, "1");
}

function migratePostStatus(db: DatabaseSync) {
  const schema = db
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'posts'")
    .get() as { sql?: string } | undefined;

  if (!schema?.sql || schema.sql.includes("'trashed'")) return;

  db.exec(`
    CREATE TABLE posts_new (
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

    INSERT INTO posts_new (
      id, type, slug, title, markdown, excerpt, cover, status,
      published_at, seo_title, seo_description, created_at, updated_at
    )
    SELECT
      id, type, slug, title, markdown, excerpt, cover, status,
      published_at, seo_title, seo_description, created_at, updated_at
    FROM posts;

    DROP TABLE posts;
    ALTER TABLE posts_new RENAME TO posts;
  `);
}
