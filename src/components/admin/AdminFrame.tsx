import Link from "next/link";
import { AdminShell } from "@/components/admin/AdminShell";
import { getCurrentAdminTheme } from "@/components/admin/AdminThemeChrome";

type Breadcrumb = {
  label: string;
  href?: string;
};

export function AdminFrame({
  title,
  subtitle,
  breadcrumbs = [],
  action,
  children
}: {
  title: string;
  subtitle?: string;
  breadcrumbs?: Breadcrumb[];
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  const resolvedTheme = getCurrentAdminTheme();
  const BrandMark = resolvedTheme.theme.slots.BrandMark;
  const ShellDecoration = resolvedTheme.theme.slots.ShellDecoration;
  return (
    <AdminShell
      brandMark={<BrandMark />}
      variantLabel={resolvedTheme.theme.meta.variantLabel}
      decoration={<ShellDecoration />}
      fallbackMessage={resolvedTheme.isFallback
        ? `当前前台主题“${resolvedTheme.requestedId}”没有配套后台主题，已安全回退到 ManJyun Console。`
        : undefined}
    >
          {breadcrumbs.length ? (
            <nav className="admin-breadcrumbs" aria-label="后台路径">
              {breadcrumbs.map((item, index) => (
                item.href && index < breadcrumbs.length - 1 ? (
                  <Link key={`${item.href}-${item.label}`} href={item.href}>
                    {item.label}
                  </Link>
                ) : (
                  <span key={item.label}>{item.label}</span>
                )
              ))}
            </nav>
          ) : null}
          <div className="admin-topbar">
            <div>
              <h1 className="admin-title">{title}</h1>
              {subtitle ? <p className="admin-subtitle">{subtitle}</p> : null}
            </div>
            {action}
          </div>
          {children}
    </AdminShell>
  );
}
