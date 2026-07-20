export const PUBLIC_COLLECTION_PAGE_SIZE = 12;

export type PublicPageParam = string | string[] | undefined;

export function normalizePublicPageParam(value: PublicPageParam) {
  if (typeof value !== "string" || !/^\d{1,9}$/.test(value)) {
    return 1;
  }
  const page = Number(value);
  return Number.isSafeInteger(page) && page > 0 ? page : 1;
}

export function publicCollectionPageHref(baseHref: string, page: number) {
  return page <= 1 ? baseHref : `${baseHref}?page=${page}`;
}

export function isCanonicalPublicPageParam(
  value: PublicPageParam,
  actualPage: number
) {
  if (actualPage === 1) return value === undefined;
  return typeof value === "string" && value === String(actualPage);
}
