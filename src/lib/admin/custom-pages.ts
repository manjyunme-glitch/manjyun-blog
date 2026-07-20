import {
  executeIdempotently,
  hashIdempotencyPayload,
  parseIdempotencyKey
} from "@/lib/db/idempotency";
import { savePost } from "@/lib/db/queries";

export function customPageCreateOperation(title: string, slug: string) {
  return {
    type: "page" as const,
    title,
    slug,
    markdown: "",
    status: "draft" as const,
    tags: [] as string[]
  };
}

export function createCustomPageIdempotently(input: {
  idempotencyKey: string | null;
  title: string;
  slug: string;
}) {
  const operation = customPageCreateOperation(input.title, input.slug);
  const key = parseIdempotencyKey(input.idempotencyKey);
  return executeIdempotently(
    "page:create",
    key,
    hashIdempotencyPayload(JSON.stringify(operation)),
    () => ({ id: savePost(operation).id })
  );
}
