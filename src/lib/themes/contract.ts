import {
  THEME_API_VERSION,
  THEME_CORE_VERSION,
  type ThemeCoreCompatibility
} from "@/themes/types";

export type ThemeContractDescriptor = {
  apiVersion: string;
  coreCompatibility: ThemeCoreCompatibility;
};

function parseVersion(value: string) {
  const match = value.trim().match(/^(\d+)\.(\d+)\.(\d+)$/);
  return match ? match.slice(1).map(Number) : null;
}

function compareVersions(left: number[], right: number[]) {
  for (let index = 0; index < 3; index += 1) {
    const difference = left[index] - right[index];
    if (difference !== 0) return difference;
  }
  return 0;
}

export function getThemeContractIssues(
  descriptor: ThemeContractDescriptor,
  coreVersion: string = THEME_CORE_VERSION
) {
  const issues: string[] = [];
  if (descriptor.apiVersion !== THEME_API_VERSION) {
    issues.push(
      `主题 API ${descriptor.apiVersion || "未声明"} 与当前 API ${THEME_API_VERSION} 不兼容。`
    );
  }

  const current = parseVersion(coreVersion);
  const minimum = parseVersion(descriptor.coreCompatibility.minimum);
  const maximum = descriptor.coreCompatibility.maximumExclusive
    ? parseVersion(descriptor.coreCompatibility.maximumExclusive)
    : null;

  if (!minimum) {
    issues.push("coreCompatibility.minimum 必须是完整语义版本号。");
  }
  if (descriptor.coreCompatibility.maximumExclusive && !maximum) {
    issues.push("coreCompatibility.maximumExclusive 必须是完整语义版本号。");
  }
  if (minimum && maximum && compareVersions(minimum, maximum) >= 0) {
    issues.push("coreCompatibility.maximumExclusive 必须高于 minimum。");
  }
  if (current && minimum && compareVersions(current, minimum) < 0) {
    issues.push(
      `主题要求核心版本不低于 ${descriptor.coreCompatibility.minimum}，当前为 ${coreVersion}。`
    );
  }
  if (current && maximum && compareVersions(current, maximum) >= 0) {
    issues.push(
      `主题要求核心版本低于 ${descriptor.coreCompatibility.maximumExclusive}，当前为 ${coreVersion}。`
    );
  }

  return issues;
}
