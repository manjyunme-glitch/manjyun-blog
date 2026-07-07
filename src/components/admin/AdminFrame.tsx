import Link from "next/link";
import { logoutAction } from "@/app/admin/actions";

const links = [
  ["/admin", "概览"],
  ["/admin/posts", "文章"],
  ["/admin/media", "媒体库"],
  ["/admin/settings", "站点设置"],
  ["/admin/themes", "主题"]
] as const;

export function AdminFrame({
  title,
  subtitle,
  action,
  children
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="admin-shell">
      <div className="admin-frame">
        <aside className="admin-sidebar">
          <Link className="admin-brand" href="/admin">
            ManJyun<span>.</span>admin
          </Link>
          <nav className="admin-menu">
            {links.map(([href, label]) => (
              <Link key={href} href={href}>
                {label}
              </Link>
            ))}
          </nav>
          <form action={logoutAction} style={{ marginTop: "auto" }}>
            <button className="btn ghost admin-logout" type="submit">退出登录</button>
          </form>
        </aside>
        <main className="admin-main">
          <div className="admin-topbar">
            <div>
              <h1 className="admin-title">{title}</h1>
              {subtitle ? <p className="admin-subtitle">{subtitle}</p> : null}
            </div>
            {action}
          </div>
          {children}
        </main>
      </div>
    </div>
  );
}
