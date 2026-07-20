import assert from "node:assert/strict";
import test from "node:test";
import {
  auditRequestId,
  serializeAuditEvent
} from "@/lib/observability/audit";

test("audit events are one-line, bounded, and redact sensitive detail fields", () => {
  const line = serializeAuditEvent(
    {
      action: "post.update",
      outcome: "failure",
      requestId: "request-123",
      source: "127.0.0.1\nforged",
      actorId: 7,
      resourceType: "post",
      resourceId: 42,
      code: "WRITE_FAILED",
      detail: {
        status: "draft",
        password: "must-not-appear",
        authorizationHeader: "must-not-appear"
      }
    },
    "2026-07-20T00:00:00.000Z"
  );
  const parsed = JSON.parse(line) as Record<string, unknown>;

  assert.equal(line.includes("\n"), false);
  assert.equal(parsed.kind, "audit");
  assert.equal(parsed.requestId, "request-123");
  assert.equal(parsed.source, "127.0.0.1forged");
  assert.equal(JSON.stringify(parsed).includes("must-not-appear"), false);
  assert.deepEqual(parsed.detail, {
    status: "draft",
    password: "[REDACTED]",
    authorizationHeader: "[REDACTED]"
  });
});

test("request ids accept a constrained upstream id and replace unsafe values", () => {
  assert.equal(
    auditRequestId(new Headers({ "x-request-id": "edge:request-123" })),
    "edge:request-123"
  );
  assert.match(
    auditRequestId(new Headers({ "x-request-id": "bad request value" })),
    /^[0-9a-f-]{36}$/
  );
});
