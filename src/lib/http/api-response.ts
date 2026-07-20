import { NextResponse } from "next/server";

export type ApiErrorCode =
  | "UNAUTHORIZED"
  | "NOT_FOUND"
  | "INVALID_REQUEST"
  | "VALIDATION_ERROR"
  | "VERSION_CONFLICT"
  | "INVALID_IDEMPOTENCY_KEY"
  | "IDEMPOTENCY_CONFLICT"
  | "IDEMPOTENCY_IN_PROGRESS"
  | "MEDIA_IN_USE"
  | "STORAGE_UNAVAILABLE"
  | "WRITE_FAILED";

export function apiError(
  status: number,
  code: ApiErrorCode,
  error: string,
  details: Record<string, unknown> = {}
) {
  return NextResponse.json(
    {
      ok: false as const,
      code,
      error,
      ...details
    },
    { status }
  );
}
