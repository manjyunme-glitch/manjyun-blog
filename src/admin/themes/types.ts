import type { ComponentType, CSSProperties } from "react";

export type AdminThemeTokens = {
  background: string;
  surface: string;
  raisedSurface: string;
  strongSurface: string;
  border: string;
  strongBorder: string;
  text: string;
  softText: string;
  mutedText: string;
  accent: string;
  success: string;
  danger: string;
};

export type AdminThemeArtworkProps = {
  compact?: boolean;
};

export type AdminThemeDefinition = {
  meta: {
    id: string;
    name: string;
    variantLabel: string;
    version: string;
    description: string;
  };
  tokens: AdminThemeTokens;
  slots: {
    BrandMark: ComponentType<AdminThemeArtworkProps>;
    ShellDecoration: ComponentType<AdminThemeArtworkProps>;
    AuthDecoration: ComponentType<AdminThemeArtworkProps>;
    Preview: ComponentType<AdminThemeArtworkProps>;
  };
};

export type ResolvedAdminTheme = {
  requestedId: string;
  theme: AdminThemeDefinition;
  isFallback: boolean;
};

export function adminThemeTokenStyle(tokens: AdminThemeTokens): CSSProperties {
  return {
    "--admin-bg": tokens.background,
    "--admin-surface": tokens.surface,
    "--admin-surface-raised": tokens.raisedSurface,
    "--admin-surface-strong": tokens.strongSurface,
    "--admin-border": tokens.border,
    "--admin-border-strong": tokens.strongBorder,
    "--admin-text": tokens.text,
    "--admin-text-soft": tokens.softText,
    "--admin-muted": tokens.mutedText,
    "--admin-accent": tokens.accent,
    "--admin-green": tokens.success,
    "--admin-red": tokens.danger
  } as CSSProperties;
}
