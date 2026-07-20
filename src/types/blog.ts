export type PostType = "post" | "page" | "project";
export type PostStatus = "draft" | "published" | "trashed";

export type PostRecord = {
  id: number;
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
  createdAt: string;
  updatedAt: string;
  version: number;
  tags?: TagRecord[];
};

export type TagRecord = {
  id: number;
  slug: string;
  name: string;
};

export type PostWithTags = PostRecord & {
  tags: TagRecord[];
};

export type PostSummary = Pick<
  PostRecord,
  | "id"
  | "type"
  | "slug"
  | "title"
  | "excerpt"
  | "status"
  | "publishedAt"
  | "createdAt"
  | "updatedAt"
  | "version"
> & {
  tags: TagRecord[];
};

export type PublicPostSummary = Pick<
  PostRecord,
  | "id"
  | "type"
  | "slug"
  | "title"
  | "excerpt"
  | "cover"
  | "publishedAt"
  | "createdAt"
  | "updatedAt"
> & {
  tags: TagRecord[];
};

export type PublicPostSummaryPage = {
  posts: PublicPostSummary[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

export type PublicFeedItem = Pick<
  PostRecord,
  | "type"
  | "slug"
  | "title"
  | "excerpt"
  | "seoDescription"
  | "publishedAt"
  | "createdAt"
  | "updatedAt"
>;

export type PublicSitemapEntry = Pick<
  PostRecord,
  "type" | "slug" | "updatedAt"
>;

export type PostRevision = {
  id: number;
  postId: number;
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
  tags: string[] | null;
  postCreatedAt: string;
  postUpdatedAt: string;
  reason: string;
  createdAt: string;
};

export type PostRevisionPage = {
  revisions: PostRevision[];
  total: number;
  hasMore: boolean;
  nextCursor: string | null;
};

export type SiteSettings = {
  siteTitle: string;
  siteDescription: string;
  baseUrl: string;
  activeTheme: string;
  heroBio: string;
  heroTags: string;
  stackItems: string;
  uptimeStart: string;
  blogTitle: string;
  blogDescription: string;
  projectsTitle: string;
  projectsDescription: string;
  aboutTitle: string;
  aboutMarkdown: string;
};

export type SiteConfiguration = {
  settings: SiteSettings;
  modules: HomeModule[];
  mainLinks: NavLink[];
  frequentLinks: NavLink[];
  version: number;
};

export type HomeModule = {
  id: string;
  enabled: boolean;
  sortOrder: number;
  config: Record<string, unknown>;
};

export type NavLink = {
  id: number;
  groupName: "main" | "frequent" | "footer";
  label: string;
  url: string;
  iconUrl: string | null;
  sortOrder: number;
};

export type MediaRecord = {
  id: number;
  filename: string;
  originalName: string;
  mime: string;
  size: number;
  url: string;
  createdAt: string;
};

export type ThemeInstallRecord = {
  id: number;
  themeId: string;
  name: string;
  version: string;
  description: string;
  status: "compatible" | "incompatible";
  issues: string[];
  createdAt: string;
};

export type RenderedMarkdown = {
  html: string;
  text: string;
  toc: Array<{ id: string; level: 2 | 3; text: string }>;
};
