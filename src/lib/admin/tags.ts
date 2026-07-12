export const COMMON_POST_TAGS = [
  "碎碎念",
  "教程",
  "留档",
  "私人",
  "折腾",
  "开发笔记",
  "踩坑记录",
  "工具推荐",
  "开源",
  "Docker",
  "NAS",
  "Linux",
  "网络",
  "自托管",
  "Homelab",
  "运维",
  "项目日志",
  "复盘",
  "阅读",
  "生活"
] as const;

function tagKey(tag: string) {
  return tag.normalize("NFKC").toLocaleLowerCase("zh-CN");
}

export function parseTagInput(input: string) {
  const seen = new Set<string>();
  const tags: string[] = [];

  for (const rawTag of input.split(/[,，\n]+/)) {
    const tag = rawTag.trim();
    const key = tagKey(tag);
    if (!tag || seen.has(key)) continue;
    seen.add(key);
    tags.push(tag);
  }

  return tags;
}

export function hasTag(input: string, tag: string) {
  const key = tagKey(tag.trim());
  return parseTagInput(input).some((item) => tagKey(item) === key);
}

export function toggleTag(input: string, tag: string) {
  const target = tag.trim();
  if (!target) return parseTagInput(input).join(", ");

  const key = tagKey(target);
  const tags = parseTagInput(input);
  const isSelected = tags.some((item) => tagKey(item) === key);
  const next = isSelected ? tags.filter((item) => tagKey(item) !== key) : [...tags, target];

  return next.join(", ");
}
