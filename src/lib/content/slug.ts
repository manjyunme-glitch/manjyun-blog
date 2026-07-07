export function slugify(input: string, fallback = "post") {
  const slug = input
    .trim()
    .normalize("NFKD")
    .toLowerCase()
    .replace(/['"]/g, "")
    .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
    .replace(/^-+|-+$/g, "");

  return slug || fallback;
}

export function splitCommaList(input: string | null | undefined) {
  return (input ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}
