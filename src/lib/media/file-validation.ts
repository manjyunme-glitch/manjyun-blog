export type ValidatedMediaFile = {
  extension: string;
  kind: "image" | "audio" | "document";
  mime: string;
};

function ascii(bytes: Uint8Array, start: number, length: number) {
  return Buffer.from(bytes.subarray(start, start + length)).toString("ascii");
}

function startsWith(bytes: Uint8Array, signature: number[]) {
  return signature.every((value, index) => bytes[index] === value);
}

function isIsoBaseMedia(bytes: Uint8Array) {
  return bytes.length >= 12 && ascii(bytes, 4, 4) === "ftyp";
}

export function validateMediaFile(
  bytes: Uint8Array,
  options: { imageOnly?: boolean } = {}
): ValidatedMediaFile | null {
  const image = detectImage(bytes);
  if (image) return image;
  if (options.imageOnly) return null;

  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) {
    return { extension: ".pdf", kind: "document", mime: "application/pdf" };
  }
  if (ascii(bytes, 0, 4) === "fLaC") {
    return { extension: ".flac", kind: "audio", mime: "audio/flac" };
  }
  if (ascii(bytes, 0, 4) === "OggS") {
    return { extension: ".ogg", kind: "audio", mime: "audio/ogg" };
  }
  if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WAVE") {
    return { extension: ".wav", kind: "audio", mime: "audio/wav" };
  }
  if (
    ascii(bytes, 0, 3) === "ID3" ||
    (bytes.length >= 2 && bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0)
  ) {
    return { extension: ".mp3", kind: "audio", mime: "audio/mpeg" };
  }
  if (isIsoBaseMedia(bytes)) {
    return { extension: ".m4a", kind: "audio", mime: "audio/mp4" };
  }

  return null;
}

function detectImage(bytes: Uint8Array): ValidatedMediaFile | null {
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) {
    return { extension: ".jpg", kind: "image", mime: "image/jpeg" };
  }
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return { extension: ".png", kind: "image", mime: "image/png" };
  }
  if (ascii(bytes, 0, 6) === "GIF87a" || ascii(bytes, 0, 6) === "GIF89a") {
    return { extension: ".gif", kind: "image", mime: "image/gif" };
  }
  if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP") {
    return { extension: ".webp", kind: "image", mime: "image/webp" };
  }
  if (startsWith(bytes, [0x00, 0x00, 0x01, 0x00])) {
    return { extension: ".ico", kind: "image", mime: "image/x-icon" };
  }
  if (isIsoBaseMedia(bytes)) {
    const brands = ascii(bytes, 8, Math.min(bytes.length - 8, 32));
    if (brands.includes("avif") || brands.includes("avis")) {
      return { extension: ".avif", kind: "image", mime: "image/avif" };
    }
  }
  return null;
}
