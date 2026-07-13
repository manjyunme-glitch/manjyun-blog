import { resolveAdminTheme } from "@/admin/themes/registry";
import { getSiteSettings } from "@/lib/db/queries";

export function AdminThemeChrome({
  slot
}: {
  slot: "BrandMark" | "ShellDecoration" | "AuthDecoration";
}) {
  const resolved = resolveAdminTheme(getSiteSettings().activeTheme);
  const Slot = resolved.theme.slots[slot];
  return <Slot />;
}

export function getCurrentAdminTheme() {
  return resolveAdminTheme(getSiteSettings().activeTheme);
}
