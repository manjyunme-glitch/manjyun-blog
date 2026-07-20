"use server";

import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth/session";
import { createCustomPageIdempotently } from "@/lib/admin/custom-pages";
import {
  IdempotencyCapacityError,
  IdempotencyConflictError,
  IdempotencyInProgressError,
  InvalidIdempotencyKeyError
} from "@/lib/db/idempotency";

function pagesError(message: string) {
  redirect(`/admin/pages?error=${encodeURIComponent(message)}`);
}

export async function createCustomPageAction(formData: FormData) {
  await requireAdmin();

  const title = String(formData.get("title") ?? "").trim();
  const slug = String(formData.get("slug") ?? "").trim();
  if (!title) pagesError("页面标题不能为空。");
  if (title.length > 200) pagesError("页面标题不能超过 200 个字符。");
  if (slug.length > 200) pagesError("Slug 不能超过 200 个字符。");

  let pageId: number;
  try {
    const result = createCustomPageIdempotently({
      idempotencyKey:
        String(formData.get("idempotencyKey") ?? "") || null,
      title,
      slug
    });
    pageId = result.response.id;
  } catch (error) {
    if (error instanceof InvalidIdempotencyKeyError) {
      pagesError("创建请求标识无效，请刷新页面后重试。");
    }
    if (error instanceof IdempotencyConflictError) {
      pagesError("这次创建请求已用于其他页面，请刷新页面后重试。");
    }
    if (error instanceof IdempotencyInProgressError) {
      pagesError("页面正在创建中，请稍后刷新页面列表确认。");
    }
    if (error instanceof IdempotencyCapacityError) {
      pagesError("当前创建请求过多，请稍后重试。");
    }
    throw error;
  }
  redirect(`/admin/pages/${pageId}`);
}
