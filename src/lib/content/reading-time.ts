export function readingTime(markdown: string) {
  const clean = markdown
    .replace(/```[\s\S]*?```/g, "")
    .replace(/`[^`]+`/g, "")
    .replace(/<[^>]+>/g, " ");
  const cjk = clean.match(/[\u4e00-\u9fff]/g)?.length ?? 0;
  const words = clean
    .replace(/[\u4e00-\u9fff]/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
  const minutes = Math.max(1, Math.ceil(cjk / 500 + words / 220));
  return `${minutes} min read`;
}
