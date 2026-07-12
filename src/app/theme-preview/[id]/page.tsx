import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ThemeHost } from "@/components/theme/ThemeHost";
import { requireAdmin } from "@/lib/auth/session";
import { loadHomeThemeView } from "@/lib/themes/public-view-data";
import { getThemes } from "@/themes";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "主题预览",
  robots: { index: false, follow: false }
};

export default async function ThemePreviewPage({
  params
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAdmin();
  const { id } = await params;
  if (!getThemes().some((theme) => theme.meta.id === id)) notFound();

  const { view } = loadHomeThemeView();
  return <ThemeHost themeId={id} view={view} />;
}
