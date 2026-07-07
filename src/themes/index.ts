import { manjyunConsoleTheme } from "@/themes/manjyun-console";
import type { ThemeDefinition } from "@/themes/types";

const themes = [manjyunConsoleTheme] satisfies ThemeDefinition[];

export function getThemes() {
  return themes;
}

export function getTheme(id: string | null | undefined) {
  return themes.find((theme) => theme.meta.id === id) ?? manjyunConsoleTheme;
}
