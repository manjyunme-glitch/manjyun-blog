export class RequestBodyTooLargeError extends Error {
  constructor() {
    super("Request body is too large");
    this.name = "RequestBodyTooLargeError";
  }
}

export async function readFormDataWithLimit(request: Request, maxBytes: number) {
  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new RequestBodyTooLargeError();
  }
  if (!request.body) return new FormData();

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      throw new RequestBodyTooLargeError();
    }
    chunks.push(value);
  }

  const boundedRequest = new Request(request.url, {
    method: request.method,
    headers: request.headers,
    body: Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), total)
  });
  return boundedRequest.formData();
}
