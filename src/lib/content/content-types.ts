import type { PostType } from "@/types/blog";

export type ContentTypeDefinition = {
  id: PostType;
  label: string;
  routePrefix: string;
  slugPrefix: string;
  adminVisible: boolean;
  adminCreatable: boolean;
};

export const CONTENT_TYPE_DEFINITIONS = {
  post: {
    id: "post",
    label: "随笔",
    routePrefix: "/posts",
    slugPrefix: "posts",
    adminVisible: true,
    adminCreatable: true
  },
  project: {
    id: "project",
    label: "项目",
    routePrefix: "/projects",
    slugPrefix: "projects",
    adminVisible: true,
    adminCreatable: true
  },
  page: {
    id: "page",
    label: "页面",
    routePrefix: "",
    slugPrefix: "pages",
    adminVisible: false,
    adminCreatable: false
  }
} as const satisfies Record<PostType, ContentTypeDefinition>;

export const ADMIN_CONTENT_TYPE_IDS = ["post", "project"] as const;
export type AdminContentType = (typeof ADMIN_CONTENT_TYPE_IDS)[number];

export const ADMIN_CONTENT_TYPE_DEFINITIONS = ADMIN_CONTENT_TYPE_IDS.map(
  (id) => CONTENT_TYPE_DEFINITIONS[id]
);

export function isContentType(value: unknown): value is PostType {
  return typeof value === "string" && Object.hasOwn(CONTENT_TYPE_DEFINITIONS, value);
}

export function isAdminContentType(value: unknown): value is AdminContentType {
  return (
    isContentType(value) &&
    CONTENT_TYPE_DEFINITIONS[value].adminVisible
  );
}

export function isAdminCreatableContentType(value: unknown): value is AdminContentType {
  return (
    isContentType(value) &&
    CONTENT_TYPE_DEFINITIONS[value].adminCreatable
  );
}

export function canAdminChangeContentType(from: PostType, to: PostType) {
  if (from === to) return true;
  return (
    CONTENT_TYPE_DEFINITIONS[from].adminVisible &&
    CONTENT_TYPE_DEFINITIONS[to].adminCreatable
  );
}

export function getContentTypeDefinition(type: PostType) {
  return CONTENT_TYPE_DEFINITIONS[type];
}

export function contentHref(type: PostType, slug: string) {
  return `${CONTENT_TYPE_DEFINITIONS[type].routePrefix}/${slug}`;
}
