import { all, get, run, transaction } from "@/lib/db/client";
import { slugify, splitCommaList } from "@/lib/content/slug";
import {
  getContentTypeDefinition,
  type AdminContentType
} from "@/lib/content/content-types";
import type {
  HomeModule,
  MediaRecord,
  NavLink,
  PostRecord,
  PostRevision,
  PostSummary,
  PostStatus,
  PostType,
  PostWithTags,
  SiteSettings,
  ThemeInstallRecord,
  TagRecord
} from "@/types/blog";

type SettingRow = { key: string; value: string };
type CountRow = { count: number };
type IdRow = { id: number };
type StoredPostRevision = Omit<PostRevision, "tags"> & {
  tagsJson: string | null;
};
type StoredPostSummary = Omit<PostSummary, "tags">;

export type SavePostInput = {
  id?: number;
  type: PostType;
  title: string;
  slug?: string;
  markdown: string;
  excerpt?: string;
  cover?: string;
  status: PostStatus;
  publishedAt?: string | null;
  seoTitle?: string;
  seoDescription?: string;
  tags?: string[];
};

const settingDefaults: SiteSettings = {
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
    "这里是关于页面。可以在后台设置里写 Markdown，也可以创建 slug 为 `about` 的页面来覆盖它。"
};

const previousThemeSettingKey = "previousTheme";

function normalizePost(row: PostRecord): PostRecord {
  return {
    ...row,
    publishedAt: row.publishedAt ?? null,
    excerpt: row.excerpt ?? null,
    cover: row.cover ?? null,
    seoTitle: row.seoTitle ?? null,
    seoDescription: row.seoDescription ?? null
  };
}

function postSelect(prefix = "p") {
  return `
    ${prefix}.id,
    ${prefix}.type,
    ${prefix}.slug,
    ${prefix}.title,
    ${prefix}.markdown,
    ${prefix}.excerpt,
    ${prefix}.cover,
    ${prefix}.status,
    ${prefix}.published_at AS publishedAt,
    ${prefix}.seo_title AS seoTitle,
    ${prefix}.seo_description AS seoDescription,
    ${prefix}.created_at AS createdAt,
    ${prefix}.updated_at AS updatedAt
  `;
}

function normalizeRevision(row: StoredPostRevision): PostRevision {
  const { tagsJson, ...revision } = row;
  let tags: string[] | null = null;
  if (tagsJson !== null) {
    try {
      const parsed = JSON.parse(tagsJson) as unknown;
      tags = Array.isArray(parsed) ? parsed.map(String) : null;
    } catch {
      tags = null;
    }
  }
  return {
    ...revision,
    publishedAt: revision.publishedAt ?? null,
    excerpt: revision.excerpt ?? null,
    cover: revision.cover ?? null,
    seoTitle: revision.seoTitle ?? null,
    seoDescription: revision.seoDescription ?? null,
    tags
  };
}

function revisionSelect(prefix = "r") {
  return `
    ${prefix}.id,
    ${prefix}.post_id AS postId,
    ${prefix}.type,
    ${prefix}.slug,
    ${prefix}.title,
    ${prefix}.markdown,
    ${prefix}.excerpt,
    ${prefix}.cover,
    ${prefix}.status,
    ${prefix}.published_at AS publishedAt,
    ${prefix}.seo_title AS seoTitle,
    ${prefix}.seo_description AS seoDescription,
    ${prefix}.tags_json AS tagsJson,
    ${prefix}.post_created_at AS postCreatedAt,
    ${prefix}.post_updated_at AS postUpdatedAt,
    ${prefix}.reason,
    ${prefix}.created_at AS createdAt
  `;
}

export function getSiteSettings(): SiteSettings {
  const rows = all<SettingRow>("SELECT key, value FROM settings");
  const data = { ...settingDefaults };
  for (const row of rows) {
    if (row.key in data) {
      data[row.key as keyof SiteSettings] = row.value;
    }
  }
  return data;
}

export function updateSiteSettings(input: Partial<SiteSettings>) {
  transaction(() => {
    for (const [key, value] of Object.entries(input)) {
      if (!(key in settingDefaults)) continue;
      run(
        "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        [key, String(value ?? "")]
      );
    }
  });
}

export function getHomeModules() {
  return all<{
    id: string;
    enabled: number;
    sortOrder: number;
    config: string;
  }>(
    "SELECT id, enabled, sort_order AS sortOrder, config FROM home_modules ORDER BY sort_order ASC"
  ).map<HomeModule>((row) => ({
    id: row.id,
    enabled: row.enabled === 1,
    sortOrder: row.sortOrder,
    config: JSON.parse(row.config || "{}") as Record<string, unknown>
  }));
}

export function updateHomeModules(modules: HomeModule[]) {
  transaction(() => {
    for (const module of modules) {
      run(
        `INSERT INTO home_modules (id, enabled, sort_order, config)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           enabled = excluded.enabled,
           sort_order = excluded.sort_order,
           config = excluded.config`,
        [
          module.id,
          module.enabled ? 1 : 0,
          module.sortOrder,
          JSON.stringify(module.config ?? {})
        ]
      );
    }
  });
}

export function updateHomeModuleConfig(id: string, config: Record<string, unknown>) {
  run(
    "UPDATE home_modules SET config = ? WHERE id = ?",
    [JSON.stringify(config), id]
  );
}

export function getNavLinks(groupName?: NavLink["groupName"]) {
  const params: unknown[] = [];
  let sql =
    "SELECT id, group_name AS groupName, label, url, icon_url AS iconUrl, sort_order AS sortOrder FROM nav_links";
  if (groupName) {
    sql += " WHERE group_name = ?";
    params.push(groupName);
  }
  sql += " ORDER BY group_name ASC, sort_order ASC, id ASC";
  return all<NavLink>(sql, params);
}

export function replaceNavLinks(groupName: NavLink["groupName"], links: Omit<NavLink, "id" | "groupName">[]) {
  transaction(() => {
    run("DELETE FROM nav_links WHERE group_name = ?", [groupName]);
    for (const link of links) {
      if (!link.label.trim() || !link.url.trim()) continue;
      run(
        "INSERT INTO nav_links (group_name, label, url, icon_url, sort_order) VALUES (?, ?, ?, ?, ?)",
        [
          groupName,
          link.label.trim(),
          link.url.trim(),
          link.iconUrl?.trim() || null,
          link.sortOrder
        ]
      );
    }
  });
}

export function updateSiteConfiguration(input: {
  settings: Partial<SiteSettings>;
  modules: HomeModule[];
  mainLinks: Omit<NavLink, "id" | "groupName">[];
  frequentLinks: Omit<NavLink, "id" | "groupName">[];
}) {
  transaction(() => {
    updateSiteSettings(input.settings);
    updateHomeModules(input.modules);
    replaceNavLinks("main", input.mainLinks);
    replaceNavLinks("frequent", input.frequentLinks);
  });
}

export function isSetupComplete() {
  return (
    get<CountRow>("SELECT COUNT(*) AS count FROM admin_users")?.count ?? 0
  ) > 0;
}

export function createAdminUser(username: string, passwordHash: string) {
  if (isSetupComplete()) {
    throw new Error("Setup is already complete.");
  }
  run("INSERT INTO admin_users (username, password_hash) VALUES (?, ?)", [
    username,
    passwordHash
  ]);
}

export function getAdminByUsername(username: string) {
  return get<{ id: number; username: string; passwordHash: string }>(
    "SELECT id, username, password_hash AS passwordHash FROM admin_users WHERE username = ?",
    [username]
  );
}

export function getAdminById(id: number) {
  return get<{ id: number; username: string }>(
    "SELECT id, username FROM admin_users WHERE id = ?",
    [id]
  );
}

export function makeUniqueSlug(type: PostType, desired: string, excludeId?: number) {
  const base = slugify(desired, type);
  let candidate = base;
  let suffix = 2;

  while (true) {
    const found = get<IdRow>(
      `SELECT id FROM posts WHERE type = ? AND slug = ? ${
        excludeId ? "AND id != ?" : ""
      }`,
      excludeId ? [type, candidate, excludeId] : [type, candidate]
    );
    if (!found) return candidate;
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }
}

function autoSlugPrefix(type: PostType) {
  return getContentTypeDefinition(type).slugPrefix;
}

function postSummarySelect(prefix = "p") {
  return `
    ${prefix}.id,
    ${prefix}.type,
    ${prefix}.slug,
    ${prefix}.title,
    ${prefix}.excerpt,
    ${prefix}.status,
    ${prefix}.published_at AS publishedAt,
    ${prefix}.created_at AS createdAt,
    ${prefix}.updated_at AS updatedAt
  `;
}

function normalizePostSummary(row: StoredPostSummary): StoredPostSummary {
  return {
    ...row,
    publishedAt: row.publishedAt ?? null,
    excerpt: row.excerpt ?? null
  };
}

function readSettingValue(key: string) {
  return get<SettingRow>("SELECT key, value FROM settings WHERE key = ?", [key])?.value ?? null;
}

function writeSettingValue(key: string, value: string) {
  run(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    [key, value]
  );
}

export type ThemeSelection = {
  activeTheme: string;
  previousTheme: string | null;
};

export function getPreviousTheme() {
  const value = readSettingValue(previousThemeSettingKey)?.trim();
  return value || null;
}

export function getThemeSelection(): ThemeSelection {
  return {
    activeTheme: getSiteSettings().activeTheme,
    previousTheme: getPreviousTheme()
  };
}

export function activateTheme(themeId: string): ThemeSelection {
  const target = themeId.trim();
  if (!target) throw new Error("Theme id is required.");

  return transaction(() => {
    const current = getSiteSettings().activeTheme;
    if (current === target) {
      return {
        activeTheme: current,
        previousTheme: getPreviousTheme()
      };
    }

    writeSettingValue(previousThemeSettingKey, current);
    writeSettingValue("activeTheme", target);
    return {
      activeTheme: target,
      previousTheme: current
    };
  });
}

export function rollbackTheme(): ThemeSelection | null {
  const selection = getThemeSelection();
  if (!selection.previousTheme || selection.previousTheme === selection.activeTheme) {
    return null;
  }
  return activateTheme(selection.previousTheme);
}

function makeSequentialSlug(type: PostType, excludeId?: number) {
  const prefix = autoSlugPrefix(type);
  const rows = all<{ slug: string }>(
    `SELECT slug FROM posts WHERE type = ? AND slug LIKE ? ${
      excludeId ? "AND id != ?" : ""
    }`,
    excludeId ? [type, `${prefix}-%`, excludeId] : [type, `${prefix}-%`]
  );
  const pattern = new RegExp(`^${prefix}-(\\d+)$`);
  const max = rows.reduce((highest, row) => {
    const value = Number(row.slug.match(pattern)?.[1] ?? 0);
    return Number.isFinite(value) ? Math.max(highest, value) : highest;
  }, 0);
  let index = max + 1;

  while (true) {
    const candidate = `${prefix}-${String(index).padStart(3, "0")}`;
    const found = get<IdRow>(
      `SELECT id FROM posts WHERE type = ? AND slug = ? ${
        excludeId ? "AND id != ?" : ""
      }`,
      excludeId ? [type, candidate, excludeId] : [type, candidate]
    );
    if (!found) return candidate;
    index += 1;
  }
}

function createPostRevision(post: PostWithTags, reason = "save") {
  const now = new Date().toISOString();
  run(
    `INSERT INTO post_revisions (
      post_id, type, slug, title, markdown, excerpt, cover, status,
      published_at, seo_title, seo_description, tags_json,
      post_created_at, post_updated_at, reason, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      post.id,
      post.type,
      post.slug,
      post.title,
      post.markdown,
      post.excerpt,
      post.cover,
      post.status,
      post.publishedAt,
      post.seoTitle,
      post.seoDescription,
      JSON.stringify(post.tags.map((tag) => tag.name)),
      post.createdAt,
      post.updatedAt,
      reason,
      now
    ]
  );
}

function normalizeTagNames(tags: string[]) {
  return Array.from(new Set(tags.map((tag) => tag.trim()).filter(Boolean))).sort((a, b) =>
    a.localeCompare(b, "zh-CN")
  );
}

function sameTagNames(post: PostWithTags, tagNames: string[]) {
  const current = normalizeTagNames(post.tags.map((tag) => tag.name));
  const next = normalizeTagNames(tagNames);
  return current.length === next.length && current.every((tag, index) => tag === next[index]);
}

function saveRevisionReason(
  existing: PostWithTags,
  next: {
    type: PostType;
    slug: string;
    title: string;
    markdown: string;
    excerpt: string | null;
    cover: string | null;
    status: PostStatus;
    publishedAt: string | null;
    seoTitle: string | null;
    seoDescription: string | null;
    tags: string[];
  }
) {
  if (next.status !== existing.status) {
    if (next.status === "published") return "publish";
    if (next.status === "draft" && existing.status === "published") return "unpublish";
    return "status";
  }

  const contentChanged = existing.markdown !== next.markdown;
  const titleChanged = existing.title !== next.title || existing.slug !== next.slug;
  const metaChanged =
    existing.type !== next.type ||
    existing.excerpt !== next.excerpt ||
    existing.cover !== next.cover ||
    existing.publishedAt !== next.publishedAt ||
    existing.seoTitle !== next.seoTitle ||
    existing.seoDescription !== next.seoDescription ||
    !sameTagNames(existing, next.tags);

  if (contentChanged && (titleChanged || metaChanged)) return "save-content-meta";
  if (contentChanged) return "save-content";
  if (titleChanged) return "save-title";
  if (metaChanged) return "save-meta";
  return null;
}

export function savePost(input: SavePostInput) {
  return transaction(() => savePostInternal(input));
}

function savePostInternal(input: SavePostInput) {
  const title = input.title.trim() || "Untitled";
  const now = new Date().toISOString();
  const existing = input.id ? getPostById(input.id) : null;
  const markdown = input.markdown ?? "";
  const excerpt = input.excerpt?.trim() || null;
  const cover = input.cover?.trim() || null;
  const seoTitle = input.seoTitle?.trim() || null;
  const seoDescription = input.seoDescription?.trim() || null;
  const tags = input.tags ?? [];
  const desiredSlug = input.slug?.trim() ?? "";
  const slug = desiredSlug
    ? makeUniqueSlug(input.type, desiredSlug, existing?.id)
    : makeSequentialSlug(input.type, existing?.id);
  const publishedAt =
    existing?.publishedAt ??
    input.publishedAt ??
    (input.status === "published" ? now : null);

  let id = input.id;
  const next = {
    type: input.type,
    slug,
    title,
    markdown,
    excerpt,
    cover,
    status: input.status,
    publishedAt,
    seoTitle,
    seoDescription,
    tags
  };

  if (id && existing) {
    const reason = saveRevisionReason(existing, next);
    if (!reason) return existing;

    createPostRevision(existing, reason);
    run(
      `UPDATE posts SET
        type = ?,
        slug = ?,
        title = ?,
        markdown = ?,
        excerpt = ?,
        cover = ?,
        status = ?,
        published_at = ?,
        seo_title = ?,
        seo_description = ?,
        updated_at = ?
      WHERE id = ?`,
      [
        next.type,
        slug,
        title,
        markdown,
        excerpt,
        cover,
        next.status,
        publishedAt,
        seoTitle,
        seoDescription,
        now,
        id
      ]
    );
  } else {
    const result = run(
      `INSERT INTO posts (
        type, slug, title, markdown, excerpt, cover, status,
        published_at, seo_title, seo_description, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        next.type,
        slug,
        title,
        markdown,
        excerpt,
        cover,
        next.status,
        publishedAt,
        seoTitle,
        seoDescription,
        now,
        now
      ]
    );
    id = Number(result.lastInsertRowid);
  }

  syncPostTags(id, tags);
  return getPostById(id)!;
}

function syncPostTags(postId: number, tagNames: string[]) {
  run("DELETE FROM post_tags WHERE post_id = ?", [postId]);
  const names = Array.from(
    new Set(tagNames.map((tag) => tag.trim()).filter(Boolean))
  );
  for (const name of names) {
    const tag = getOrCreateTag(name);
    if (tag) {
      run("INSERT OR IGNORE INTO post_tags (post_id, tag_id) VALUES (?, ?)", [
        postId,
        tag.id
      ]);
    }
  }
  run(
    "DELETE FROM tags WHERE NOT EXISTS (SELECT 1 FROM post_tags WHERE post_tags.tag_id = tags.id)"
  );
}

function sameTagIdentity(left: string, right: string) {
  return left.localeCompare(right, "en", { sensitivity: "accent" }) === 0;
}

function getOrCreateTag(name: string) {
  const existingByName = all<TagRecord>("SELECT id, slug, name FROM tags").find((tag) =>
    sameTagIdentity(tag.name, name)
  );
  if (existingByName) return existingByName;

  const base = slugify(name, "tag");
  let slug = base;
  let suffix = 2;
  while (get<IdRow>("SELECT id FROM tags WHERE slug = ?", [slug])) {
    slug = `${base}-${suffix}`;
    suffix += 1;
  }

  const result = run("INSERT INTO tags (slug, name) VALUES (?, ?)", [slug, name]);
  return { id: Number(result.lastInsertRowid), slug, name } satisfies TagRecord;
}

export function listPosts(options: {
  type?: PostType;
  status?: PostStatus;
  tagSlug?: string;
  limit?: number;
  includePages?: boolean;
  includeTrashed?: boolean;
  includeTags?: boolean;
} = {}) {
  const where: string[] = [];
  const params: unknown[] = [];
  let join = "";

  if (options.tagSlug) {
    join =
      " INNER JOIN post_tags pt ON pt.post_id = p.id INNER JOIN tags t ON t.id = pt.tag_id";
    where.push("t.slug = ?");
    params.push(options.tagSlug);
  }
  if (options.type) {
    where.push("p.type = ?");
    params.push(options.type);
  } else if (!options.includePages) {
    where.push("p.type != 'page'");
  }
  if (options.status) {
    where.push("p.status = ?");
    params.push(options.status);
  } else if (!options.includeTrashed) {
    where.push("p.status != 'trashed'");
  }

  let sql = `SELECT ${postSelect("p")} FROM posts p${join}`;
  if (where.length) {
    sql += ` WHERE ${where.join(" AND ")}`;
  }
  sql += " ORDER BY COALESCE(p.published_at, p.created_at) DESC, p.id DESC";
  if (options.limit) {
    sql += " LIMIT ?";
    params.push(options.limit);
  }
  const posts = all<PostRecord>(sql, params).map(normalizePost);
  return options.includeTags === false ? posts : posts.map(withTags);
}

export type ListAdminPostSummariesOptions = {
  type?: AdminContentType;
  status?: PostStatus;
  q?: string;
  limit?: number;
  offset?: number;
};

function escapeLikePattern(value: string) {
  return value.replace(/[\\%_]/g, "\\$&");
}

function adminPostWhere(options: Pick<ListAdminPostSummariesOptions, "type" | "status" | "q">) {
  const where: string[] = [];
  const params: unknown[] = [];

  if (options.type) {
    where.push("p.type = ?");
    params.push(options.type);
  } else {
    where.push("p.type != 'page'");
  }

  if (options.status) {
    where.push("p.status = ?");
    params.push(options.status);
  } else {
    where.push("p.status != 'trashed'");
  }

  const query = options.q?.trim();
  if (query) {
    const pattern = `%${escapeLikePattern(query)}%`;
    where.push(`(
      p.title LIKE ? ESCAPE '\\'
      OR p.slug LIKE ? ESCAPE '\\'
      OR COALESCE(p.excerpt, '') LIKE ? ESCAPE '\\'
      OR p.markdown LIKE ? ESCAPE '\\'
      OR EXISTS (
        SELECT 1
        FROM post_tags search_pt
        INNER JOIN tags search_t ON search_t.id = search_pt.tag_id
        WHERE search_pt.post_id = p.id
          AND search_t.name LIKE ? ESCAPE '\\'
      )
    )`);
    params.push(pattern, pattern, pattern, pattern, pattern);
  }

  return { where, params };
}

function countAdminPosts(
  options: Pick<ListAdminPostSummariesOptions, "type" | "status" | "q">
) {
  const { where, params } = adminPostWhere(options);
  return get<CountRow>(
    `SELECT COUNT(*) AS count FROM posts p WHERE ${where.join(" AND ")}`,
    params
  )!.count;
}

function loadTagsForPosts<T extends { id: number }>(posts: T[]) {
  if (!posts.length) return posts.map((post) => ({ ...post, tags: [] as TagRecord[] }));

  const tagsByPost = new Map<number, TagRecord[]>();
  for (const post of posts) tagsByPost.set(post.id, []);
  const placeholders = posts.map(() => "?").join(", ");
  const rows = all<TagRecord & { postId: number }>(
    `SELECT pt.post_id AS postId, t.id, t.slug, t.name
     FROM post_tags pt
     INNER JOIN tags t ON t.id = pt.tag_id
     WHERE pt.post_id IN (${placeholders})
     ORDER BY t.name ASC`,
    posts.map((post) => post.id)
  );
  for (const { postId, ...tag } of rows) {
    tagsByPost.get(postId)?.push(tag);
  }
  return posts.map((post) => ({ ...post, tags: tagsByPost.get(post.id) ?? [] }));
}

export function listAdminPostSummaries(options: ListAdminPostSummariesOptions = {}) {
  const requestedLimit = Math.floor(options.limit ?? 20);
  const limit = Math.min(100, Math.max(1, requestedLimit));
  const requestedOffset = Math.max(0, Math.floor(options.offset ?? 0));
  const { where, params } = adminPostWhere(options);
  const total = get<CountRow>(
    `SELECT COUNT(*) AS count FROM posts p WHERE ${where.join(" AND ")}`,
    params
  )!.count;
  const lastPageOffset = total > 0 ? Math.floor((total - 1) / limit) * limit : 0;
  const offset = total === 0 || requestedOffset >= total ? lastPageOffset : requestedOffset;
  const rows = all<StoredPostSummary>(
    `SELECT ${postSummarySelect("p")}
     FROM posts p
     WHERE ${where.join(" AND ")}
     ORDER BY p.updated_at DESC, p.id DESC
     LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  ).map(normalizePostSummary);

  return {
    posts: loadTagsForPosts(rows),
    total,
    limit,
    offset
  };
}

export function getPostById(id: number) {
  const post = get<PostRecord>(`SELECT ${postSelect("p")} FROM posts p WHERE p.id = ?`, [
    id
  ]);
  return post ? withTags(normalizePost(post)) : null;
}

export function getPostBySlug(type: PostType, slug: string, onlyPublished = true) {
  const post = get<PostRecord>(
    `SELECT ${postSelect("p")} FROM posts p WHERE p.type = ? AND p.slug = ? ${
      onlyPublished ? "AND p.status = 'published'" : ""
    }`,
    [type, slug]
  );
  return post ? withTags(normalizePost(post)) : null;
}

export function getPageBySlug(slug: string) {
  return getPostBySlug("page", slug, true);
}

export function withTags(post: PostRecord): PostWithTags {
  return {
    ...post,
    tags: all<TagRecord>(
      `SELECT t.id, t.slug, t.name
       FROM tags t
       INNER JOIN post_tags pt ON pt.tag_id = t.id
       WHERE pt.post_id = ?
       ORDER BY t.name ASC`,
      [post.id]
    )
  };
}

export function getTags() {
  return all<TagRecord>(
    `SELECT t.id, t.slug, t.name
     FROM tags t
     INNER JOIN post_tags pt ON pt.tag_id = t.id
     INNER JOIN posts p ON p.id = pt.post_id
     WHERE p.status = 'published'
     GROUP BY t.id
     ORDER BY t.name ASC`
  );
}

export function getTagBySlug(slug: string) {
  return get<TagRecord>(
    `SELECT t.id, t.slug, t.name
     FROM tags t
     WHERE t.slug = ?
       AND EXISTS (
         SELECT 1
         FROM post_tags pt
         INNER JOIN posts p ON p.id = pt.post_id
         WHERE pt.tag_id = t.id AND p.status = 'published'
       )`,
    [slug]
  );
}

export function setPostStatus(id: number, status: PostStatus) {
  return transaction(() => setPostStatusInternal(id, status));
}

function setPostStatusInternal(id: number, status: PostStatus) {
  const now = new Date().toISOString();
  const existing = getPostById(id);
  if (!existing) return null;
  if (existing.status === status) return existing;

  const reason =
    status === "trashed"
      ? "trash"
      : status === "published"
        ? "publish"
        : existing.status === "published"
          ? "unpublish"
          : "status";
  createPostRevision(existing, reason);

  const publishedAtSql =
    status === "published" ? "COALESCE(published_at, ?)" : "published_at";
  const params =
    status === "published"
      ? [status, now, now, id]
      : [status, now, id];
  run(
    `UPDATE posts SET
      status = ?,
      published_at = ${publishedAtSql},
      updated_at = ?
     WHERE id = ?`,
    params
  );
  return getPostById(id);
}

export function movePostToTrash(id: number) {
  return setPostStatus(id, "trashed");
}

export function restorePostFromTrash(id: number) {
  return setPostStatus(id, "draft");
}

export function deletePostPermanently(id: number) {
  run("DELETE FROM posts WHERE id = ?", [id]);
}

export function listPostRevisions(postId: number, limit = 20) {
  return all<StoredPostRevision>(
    `SELECT ${revisionSelect("r")}
     FROM post_revisions r
     WHERE r.post_id = ?
     ORDER BY r.created_at DESC, r.id DESC
     LIMIT ?`,
    [postId, limit]
  ).map(normalizeRevision);
}

export function restorePostRevision(postId: number, revisionId: number) {
  return transaction(() => {
    const current = getPostById(postId);
    const revision = get<StoredPostRevision>(
      `SELECT ${revisionSelect("r")}
       FROM post_revisions r
       WHERE r.id = ? AND r.post_id = ?`,
      [revisionId, postId]
    );
    if (!current || !revision) return null;

    const snapshot = normalizeRevision(revision);
    const now = new Date().toISOString();
    const slug = makeUniqueSlug(snapshot.type, snapshot.slug || snapshot.title, postId);
    const publishedAt =
      snapshot.status === "published"
        ? (current.publishedAt ?? snapshot.publishedAt ?? now)
        : (current.publishedAt ?? snapshot.publishedAt ?? null);

    createPostRevision(current, "restore-before");
    run(
      `UPDATE posts SET
        type = ?,
        slug = ?,
        title = ?,
        markdown = ?,
        excerpt = ?,
        cover = ?,
        status = ?,
        published_at = ?,
        seo_title = ?,
        seo_description = ?,
        updated_at = ?
       WHERE id = ?`,
      [
        snapshot.type,
        slug,
        snapshot.title,
        snapshot.markdown,
        snapshot.excerpt,
        snapshot.cover,
        snapshot.status,
        publishedAt,
        snapshot.seoTitle,
        snapshot.seoDescription,
        now,
        postId
      ]
    );
    if (snapshot.tags !== null) {
      syncPostTags(postId, snapshot.tags);
    }
    return getPostById(postId);
  });
}

export function getAdjacentPosts(post: PostRecord) {
  if (!post.publishedAt) return { prev: null, next: null };
  const prev = get<PostRecord>(
    `SELECT ${postSelect("p")} FROM posts p
     WHERE p.type = ? AND p.status = 'published' AND p.id != ?
       AND (
         COALESCE(p.published_at, p.created_at) < ?
         OR (COALESCE(p.published_at, p.created_at) = ? AND p.id < ?)
       )
     ORDER BY COALESCE(p.published_at, p.created_at) DESC, p.id DESC LIMIT 1`,
    [post.type, post.id, post.publishedAt, post.publishedAt, post.id]
  );
  const next = get<PostRecord>(
    `SELECT ${postSelect("p")} FROM posts p
     WHERE p.type = ? AND p.status = 'published' AND p.id != ?
       AND (
         COALESCE(p.published_at, p.created_at) > ?
         OR (COALESCE(p.published_at, p.created_at) = ? AND p.id > ?)
       )
     ORDER BY COALESCE(p.published_at, p.created_at) ASC, p.id ASC LIMIT 1`,
    [post.type, post.id, post.publishedAt, post.publishedAt, post.id]
  );
  return {
    prev: prev ? normalizePost(prev) : null,
    next: next ? normalizePost(next) : null
  };
}

export function addMedia(input: Omit<MediaRecord, "id" | "createdAt">) {
  const result = run(
    "INSERT INTO media (filename, original_name, mime, size, url) VALUES (?, ?, ?, ?, ?)",
    [input.filename, input.originalName, input.mime, input.size, input.url]
  );
  return get<MediaRecord>(
    "SELECT id, filename, original_name AS originalName, mime, size, url, created_at AS createdAt FROM media WHERE id = ?",
    [Number(result.lastInsertRowid)]
  )!;
}

export function listMedia() {
  return all<MediaRecord>(
    "SELECT id, filename, original_name AS originalName, mime, size, url, created_at AS createdAt FROM media ORDER BY id DESC"
  );
}

export function addThemeInstall(input: Omit<ThemeInstallRecord, "id" | "createdAt">) {
  const result = run(
    `INSERT INTO theme_installs (theme_id, name, version, description, status, issues)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      input.themeId,
      input.name,
      input.version,
      input.description,
      input.status,
      JSON.stringify(input.issues)
    ]
  );
  return get<{
    id: number;
    themeId: string;
    name: string;
    version: string;
    description: string;
    status: "compatible" | "incompatible";
    issues: string;
    createdAt: string;
  }>(
    `SELECT id, theme_id AS themeId, name, version, description, status,
      issues, created_at AS createdAt
     FROM theme_installs WHERE id = ?`,
    [Number(result.lastInsertRowid)]
  )!;
}

export function listThemeInstalls(): ThemeInstallRecord[] {
  return all<{
    id: number;
    themeId: string;
    name: string;
    version: string;
    description: string;
    status: "compatible" | "incompatible";
    issues: string;
    createdAt: string;
  }>(
    `SELECT id, theme_id AS themeId, name, version, description, status,
      issues, created_at AS createdAt
     FROM theme_installs ORDER BY id DESC`
  ).map((row) => ({
    ...row,
    issues: JSON.parse(row.issues || "[]") as string[]
  }));
}

export function dashboardStats() {
  return {
    posts: get<CountRow>(
      "SELECT COUNT(*) AS count FROM posts WHERE type = 'post' AND status != 'trashed'"
    )!
      .count,
    projects: get<CountRow>(
      "SELECT COUNT(*) AS count FROM posts WHERE type = 'project' AND status != 'trashed'"
    )!.count,
    published: get<CountRow>(
      "SELECT COUNT(*) AS count FROM posts WHERE type != 'page' AND status = 'published'"
    )!.count,
    drafts: get<CountRow>(
      "SELECT COUNT(*) AS count FROM posts WHERE type != 'page' AND status = 'draft'"
    )!.count,
    trashed: get<CountRow>(
      "SELECT COUNT(*) AS count FROM posts WHERE type != 'page' AND status = 'trashed'"
    )!.count,
    media: get<CountRow>("SELECT COUNT(*) AS count FROM media")!.count
  };
}

export function contentStatusCounts(type?: AdminContentType, q?: string) {
  const published = countAdminPosts({ type, q, status: "published" });
  const draft = countAdminPosts({ type, q, status: "draft" });
  const trashed = countAdminPosts({ type, q, status: "trashed" });

  return {
    all: published + draft,
    published,
    draft,
    trashed
  };
}

export function contentTypeCounts(status?: PostStatus, q?: string) {
  const post = countAdminPosts({ type: "post", status, q });
  const project = countAdminPosts({ type: "project", status, q });

  return {
    all: post + project,
    post,
    project
  };
}

export function tagsToInput(post: PostWithTags | null) {
  return post?.tags.map((tag) => tag.name).join(", ") ?? "";
}

export function parseTagsInput(input: string) {
  return splitCommaList(input);
}
