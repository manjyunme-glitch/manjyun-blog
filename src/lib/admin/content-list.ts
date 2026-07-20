import {
  contentHref,
  isAdminContentType,
  type AdminContentType
} from "@/lib/content/content-types";
import type { PostStatus, PostType } from "@/types/blog";

export const ADMIN_CONTENT_PAGE_SIZE = 20;

export type AdminContentStatusFilter = "all" | PostStatus;
export type AdminContentTypeFilter = "all" | AdminContentType;

export function normalizeAdminContentStatus(
  value: string | undefined
): AdminContentStatusFilter {
  if (value === "published" || value === "draft" || value === "trashed") return value;
  if (value === "trash") return "trashed";
  return "all";
}

export function normalizeAdminContentType(
  value: string | undefined
): AdminContentTypeFilter {
  return isAdminContentType(value) ? value : "all";
}

export function normalizeAdminContentQuery(value: string | undefined) {
  return value?.trim().slice(0, 200) ?? "";
}

export function normalizeAdminContentPage(value: string | undefined) {
  if (!value) return 1;
  const page = Number(value);
  return Number.isSafeInteger(page) && page > 0 ? page : 1;
}

export function adminContentListHref({
  type = "all",
  status = "all",
  q = "",
  page = 1
}: {
  type?: AdminContentTypeFilter;
  status?: AdminContentStatusFilter;
  q?: string;
  page?: number;
}) {
  const params = new URLSearchParams();
  if (type !== "all") params.set("type", type);
  if (status !== "all") params.set("status", status);
  const query = normalizeAdminContentQuery(q);
  if (query) params.set("q", query);
  if (Number.isSafeInteger(page) && page > 1) params.set("page", String(page));
  const search = params.toString();
  return search ? `/admin/posts?${search}` : "/admin/posts";
}

export function adminPublicContentHref(input: {
  status: PostStatus;
  type: PostType;
  slug: string;
}) {
  return input.status === "published"
    ? contentHref(input.type, input.slug)
    : null;
}

export function adminPublicTagHref(status: PostStatus, slug: string) {
  return status === "published" ? `/tag/${slug}` : null;
}
