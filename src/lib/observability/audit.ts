import crypto from "node:crypto";

type AuditScalar = string | number | boolean | null;

export type AuditEvent = {
  action: string;
  outcome: "success" | "rejected" | "failure";
  requestId?: string;
  source?: string;
  actorId?: number;
  resourceType?: string;
  resourceId?: string | number;
  code?: string;
  detail?: Record<string, AuditScalar>;
};

const sensitiveField =
  /(?:authorization|cookie|password|secret|token|markdown|content|body|payload)/i;
const safeIdentifier = /^[A-Za-z0-9._:-]{1,128}$/;

function safeText(value: string, maximum = 256) {
  return value
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .slice(0, maximum);
}

function safeDetail(detail: AuditEvent["detail"]) {
  if (!detail) return undefined;
  return Object.fromEntries(
    Object.entries(detail)
      .slice(0, 24)
      .map(([key, value]) => [
        safeText(key, 64),
        sensitiveField.test(key)
          ? "[REDACTED]"
          : typeof value === "string"
            ? safeText(value)
            : value
      ])
  );
}

export function auditRequestId(headers: Pick<Headers, "get">) {
  const supplied = headers.get("x-request-id")?.trim() ?? "";
  return safeIdentifier.test(supplied) ? supplied : crypto.randomUUID();
}

export function serializeAuditEvent(
  event: AuditEvent,
  timestamp = new Date().toISOString()
) {
  return JSON.stringify({
    timestamp,
    kind: "audit",
    action: safeText(event.action, 128),
    outcome: event.outcome,
    requestId: event.requestId
      ? safeText(event.requestId, 128)
      : crypto.randomUUID(),
    ...(event.source ? { source: safeText(event.source, 128) } : {}),
    ...(Number.isInteger(event.actorId) ? { actorId: event.actorId } : {}),
    ...(event.resourceType
      ? { resourceType: safeText(event.resourceType, 64) }
      : {}),
    ...(event.resourceId !== undefined
      ? {
          resourceId:
            typeof event.resourceId === "string"
              ? safeText(event.resourceId, 128)
              : event.resourceId
        }
      : {}),
    ...(event.code ? { code: safeText(event.code, 64) } : {}),
    ...(event.detail ? { detail: safeDetail(event.detail) } : {})
  });
}

/**
 * Emit one bounded JSON line to the container log. Callers pass identifiers
 * and result metadata only; secrets and content bodies are never accepted as
 * first-class fields, and suspicious detail keys are redacted defensively.
 */
export function auditLog(event: AuditEvent) {
  const line = serializeAuditEvent(event);
  if (event.outcome === "failure") {
    console.error(line);
  } else if (event.outcome === "rejected") {
    console.warn(line);
  } else {
    console.info(line);
  }
}
