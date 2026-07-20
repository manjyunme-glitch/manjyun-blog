import crypto from "node:crypto";
import { get, run, transaction } from "@/lib/db/client";

const completedRetentionMs = 30 * 24 * 60 * 60 * 1000;
const abandonedRetentionMs = 7 * 24 * 60 * 60 * 1000;
const maxCompletedPerScope = 5_000;
const maxProcessingPerScope = 100;

type StoredIdempotencyRequest = {
  scope: string;
  idempotencyKey: string;
  requestHash: string;
  state: "processing" | "completed";
  operationJson: string;
  responseJson: string | null;
  createdAt: string;
  updatedAt: string;
};

export class InvalidIdempotencyKeyError extends Error {
  readonly code = "INVALID_IDEMPOTENCY_KEY";

  constructor(readonly reason: "required" | "format") {
    super(
      reason === "required"
        ? "An Idempotency-Key header is required."
        : "Idempotency-Key must be 16-128 ASCII letters, digits, dots, colons, underscores, or hyphens."
    );
    this.name = "InvalidIdempotencyKeyError";
  }
}

export class IdempotencyConflictError extends Error {
  readonly code = "IDEMPOTENCY_CONFLICT";

  constructor() {
    super("This idempotency key was already used for a different request.");
    this.name = "IdempotencyConflictError";
  }
}

export class IdempotencyInProgressError extends Error {
  readonly code = "IDEMPOTENCY_IN_PROGRESS";

  constructor() {
    super("An operation with this idempotency key is still in progress.");
    this.name = "IdempotencyInProgressError";
  }
}

export class IdempotencyCapacityError extends Error {
  readonly code = "IDEMPOTENCY_CAPACITY";

  constructor() {
    super("Too many idempotent operations are currently in progress.");
    this.name = "IdempotencyCapacityError";
  }
}

export function parseIdempotencyKey(value: string | null) {
  if (!value) throw new InvalidIdempotencyKeyError("required");
  if (
    value.length < 16 ||
    value.length > 128 ||
    !/^[A-Za-z0-9._:-]+$/.test(value)
  ) {
    throw new InvalidIdempotencyKeyError("format");
  }
  return value;
}

export function hashIdempotencyPayload(payload: string | Uint8Array) {
  return crypto.createHash("sha256").update(payload).digest("hex");
}

function getRequest(scope: string, key: string) {
  return get<StoredIdempotencyRequest>(
    `SELECT
       scope,
       idempotency_key AS idempotencyKey,
       request_hash AS requestHash,
       state,
       operation_json AS operationJson,
       response_json AS responseJson,
       created_at AS createdAt,
       updated_at AS updatedAt
     FROM idempotency_requests
     WHERE scope = ? AND idempotency_key = ?`,
    [scope, key]
  );
}

function parseStoredJson<T>(value: string | null, label: string): T {
  if (value === null) {
    throw new Error(`Stored idempotency ${label} is missing.`);
  }
  try {
    return JSON.parse(value) as T;
  } catch (error) {
    throw new Error(`Stored idempotency ${label} is invalid.`, {
      cause: error
    });
  }
}

/**
 * Lazy retention keeps this self-hosted SQLite table bounded without a cron
 * service. Recent completed results remain replayable for 30 days.
 */
export function pruneIdempotencyRequests(scope: string, now = Date.now()) {
  const completedCutoff = new Date(now - completedRetentionMs).toISOString();
  const abandonedCutoff = new Date(now - abandonedRetentionMs).toISOString();
  run(
    `DELETE FROM idempotency_requests
     WHERE scope = ? AND state = 'completed' AND updated_at < ?`,
    [scope, completedCutoff]
  );
  run(
    `DELETE FROM idempotency_requests
     WHERE scope = ? AND state = 'processing' AND updated_at < ?`,
    [scope, abandonedCutoff]
  );
  run(
    `DELETE FROM idempotency_requests
     WHERE rowid IN (
       SELECT rowid
       FROM idempotency_requests
       WHERE scope = ? AND state = 'completed'
       ORDER BY updated_at DESC, rowid DESC
       LIMIT -1 OFFSET ?
     )`,
    [scope, maxCompletedPerScope]
  );
}

export type ReservedIdempotentOperation<TResponse, TOperation> =
  | {
      state: "completed";
      response: TResponse;
      operation: TOperation;
      replayed: true;
    }
  | {
      state: "processing";
      operation: TOperation;
      replayed: boolean;
      updatedAt: string;
    };

export function reserveIdempotentOperation<TResponse, TOperation>(
  scope: string,
  key: string,
  requestHash: string,
  operation: TOperation
): ReservedIdempotentOperation<TResponse, TOperation> {
  return transaction(() => {
    pruneIdempotencyRequests(scope);
    const existing = getRequest(scope, key);
    if (existing) {
      if (existing.requestHash !== requestHash) {
        throw new IdempotencyConflictError();
      }
      const storedOperation = parseStoredJson<TOperation>(
        existing.operationJson,
        "operation"
      );
      if (existing.state === "completed") {
        return {
          state: "completed",
          response: parseStoredJson<TResponse>(
            existing.responseJson,
            "response"
          ),
          operation: storedOperation,
          replayed: true
        };
      }
      return {
        state: "processing",
        operation: storedOperation,
        replayed: true,
        updatedAt: existing.updatedAt
      };
    }

    const active = get<{ count: number }>(
      `SELECT COUNT(*) AS count
       FROM idempotency_requests
       WHERE scope = ? AND state = 'processing'`,
      [scope]
    )?.count ?? 0;
    if (active >= maxProcessingPerScope) {
      throw new IdempotencyCapacityError();
    }

    const now = new Date().toISOString();
    run(
      `INSERT INTO idempotency_requests (
         scope, idempotency_key, request_hash, state,
         operation_json, response_json, created_at, updated_at
       ) VALUES (?, ?, ?, 'processing', ?, NULL, ?, ?)`,
      [scope, key, requestHash, JSON.stringify(operation), now, now]
    );
    return {
      state: "processing",
      operation,
      replayed: false,
      updatedAt: now
    };
  });
}

export function completeReservedIdempotentOperation<TResponse>(
  scope: string,
  key: string,
  requestHash: string,
  operation: () => TResponse
): { response: TResponse; replayed: boolean } {
  return transaction(() => {
    const existing = getRequest(scope, key);
    if (!existing) {
      throw new Error("The idempotent operation reservation is missing.");
    }
    if (existing.requestHash !== requestHash) {
      throw new IdempotencyConflictError();
    }
    if (existing.state === "completed") {
      return {
        response: parseStoredJson<TResponse>(
          existing.responseJson,
          "response"
        ),
        replayed: true
      };
    }

    const response = operation();
    const now = new Date().toISOString();
    const result = run(
      `UPDATE idempotency_requests
       SET state = 'completed', response_json = ?, updated_at = ?
       WHERE scope = ? AND idempotency_key = ?
         AND request_hash = ? AND state = 'processing'`,
      [JSON.stringify(response), now, scope, key, requestHash]
    );
    if (result.changes !== 1) {
      throw new IdempotencyInProgressError();
    }
    pruneIdempotencyRequests(scope);
    return { response, replayed: false };
  });
}

export function executeIdempotently<TResponse>(
  scope: string,
  key: string,
  requestHash: string,
  operation: () => TResponse
): { response: TResponse; replayed: boolean } {
  return transaction(() => {
    pruneIdempotencyRequests(scope);
    const existing = getRequest(scope, key);
    if (existing) {
      if (existing.requestHash !== requestHash) {
        throw new IdempotencyConflictError();
      }
      if (existing.state === "completed") {
        return {
          response: parseStoredJson<TResponse>(
            existing.responseJson,
            "response"
          ),
          replayed: true
        };
      }
      throw new IdempotencyInProgressError();
    }

    const active = get<{ count: number }>(
      `SELECT COUNT(*) AS count
       FROM idempotency_requests
       WHERE scope = ? AND state = 'processing'`,
      [scope]
    )?.count ?? 0;
    if (active >= maxProcessingPerScope) {
      throw new IdempotencyCapacityError();
    }

    const now = new Date().toISOString();
    run(
      `INSERT INTO idempotency_requests (
         scope, idempotency_key, request_hash, state,
         operation_json, response_json, created_at, updated_at
       ) VALUES (?, ?, ?, 'processing', '{}', NULL, ?, ?)`,
      [scope, key, requestHash, now, now]
    );
    const response = operation();
    run(
      `UPDATE idempotency_requests
       SET state = 'completed', response_json = ?, updated_at = ?
       WHERE scope = ? AND idempotency_key = ?`,
      [JSON.stringify(response), now, scope, key]
    );
    pruneIdempotencyRequests(scope);
    return { response, replayed: false };
  });
}
