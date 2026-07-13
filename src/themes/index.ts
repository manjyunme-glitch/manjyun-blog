import { manjyunConsoleTheme } from "@/themes/manjyun-console";
import { neonRiftTheme } from "@/themes/neon-rift";
import { paperAtlasTheme } from "@/themes/paper-atlas";
import { getThemeContractIssues } from "@/lib/themes/contract";
import type { ThemeDefinition } from "@/themes/types";

const themes = [manjyunConsoleTheme, paperAtlasTheme, neonRiftTheme] satisfies ThemeDefinition[];

export function getThemes() {
  return themes.filter((theme) => getThemeContractIssues(theme).length === 0);
}

export function getTheme(id: string | null | undefined) {
  const compatibleThemes = getThemes();
  const selected = compatibleThemes.find((theme) => theme.meta.id === id);
  const fallback = compatibleThemes[0];
  if (!fallback) {
    throw new Error("No compatible themes are registered for the current Theme API.");
  }
  return selected ?? fallback;
}
