import { Readable } from "node:stream";

export type ByteRange = {
  end: number;
  length: number;
  start: number;
};

export class RangeNotSatisfiableError extends Error {
  constructor() {
    super("The requested byte range is not satisfiable.");
    this.name = "RangeNotSatisfiableError";
  }
}

function safeByteOffset(value: string) {
  if (!/^\d+$/.test(value)) throw new RangeNotSatisfiableError();
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new RangeNotSatisfiableError();
  }
  return parsed;
}

/**
 * Parses the standard single byte-range forms: start-end, start-, and
 * -suffix. Multiple ranges are deliberately rejected because the media route
 * does not generate multipart/byteranges responses.
 */
export function parseSingleByteRange(
  header: string | null,
  size: number
): ByteRange | null {
  if (header === null) return null;
  if (!Number.isSafeInteger(size) || size < 0) {
    throw new RangeNotSatisfiableError();
  }

  const match = /^bytes=([^,]+)$/i.exec(header.trim());
  if (!match || size === 0) throw new RangeNotSatisfiableError();
  const specification = match[1].trim();
  const separator = specification.indexOf("-");
  if (
    separator < 0 ||
    specification.indexOf("-", separator + 1) >= 0
  ) {
    throw new RangeNotSatisfiableError();
  }

  const startText = specification.slice(0, separator);
  const endText = specification.slice(separator + 1);
  if (!startText && !endText) throw new RangeNotSatisfiableError();

  let start: number;
  let end: number;
  if (!startText) {
    const suffixLength = safeByteOffset(endText);
    if (suffixLength === 0) throw new RangeNotSatisfiableError();
    start = suffixLength >= size ? 0 : size - suffixLength;
    end = size - 1;
  } else {
    start = safeByteOffset(startText);
    end = endText ? safeByteOffset(endText) : size - 1;
    if (start >= size || end < start) {
      throw new RangeNotSatisfiableError();
    }
    end = Math.min(end, size - 1);
  }

  return {
    start,
    end,
    length: end - start + 1
  };
}

export function monitoredWebStream(
  readable: Readable,
  onError: (error: Error) => void
) {
  let canceled = false;
  readable.once("error", (error: unknown) => {
    const code =
      error && typeof error === "object" && "code" in error
        ? String(error.code)
        : "";
    const name =
      error && typeof error === "object" && "name" in error
        ? String(error.name)
        : "";
    if (!canceled && name !== "AbortError" && code !== "ABORT_ERR") {
      onError(
        error instanceof Error
          ? error
          : new Error("The media read stream failed.")
      );
    }
  });
  const converted = (
    Readable.toWeb(readable) as ReadableStream<Uint8Array>
  ).getReader();
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    try {
      converted.releaseLock();
    } catch {
      // A pending read releases the lock when it settles.
    }
  };

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const result = await converted.read();
        if (result.done) {
          controller.close();
          release();
        } else {
          controller.enqueue(result.value);
        }
      } catch (error) {
        controller.error(error);
        release();
      }
    },
    async cancel(reason) {
      canceled = true;
      try {
        await converted.cancel(reason);
      } finally {
        release();
      }
    }
  });
}
