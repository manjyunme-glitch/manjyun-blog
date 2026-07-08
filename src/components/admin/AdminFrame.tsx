import Link from "next/link";
import { logoutAction } from "@/app/admin/actions";

type Breadcrumb = {
  label: string;
  href?: string;
};

const primaryLinks = [
  ["/admin", "概览"],
  ["/admin/media", "媒体库"],
  ["/admin/settings", "站点设置"],
  ["/admin/themes", "主题"]
] as const;

const contentLinks = [
  ["/admin/posts", "全部文章"],
  ["/admin/posts?status=published", "已发布"],
  ["/admin/posts?status=draft", "草稿"],
  ["/admin/posts?status=trashed", "回收站"],
  ["/admin/posts/new", "新建文章"]
] as const;

export function AdminFrame({
  title,
  subtitle,
  breadcrumbs = [],
  activeNav,
  action,
  children
}: {
  title: string;
  subtitle?: string;
  breadcrumbs?: Breadcrumb[];
  activeNav?: string;
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
            <div className="admin-menu-group">
              <span className="admin-menu-label">总览</span>
              <Link className={activeNav === "/admin" ? "is-active" : ""} href="/admin">概览</Link>
            </div>
            <div className="admin-menu-group">
              <span className="admin-menu-label">内容</span>
              {contentLinks.map(([href, label]) => (
                <Link key={href} className={activeNav === href ? "is-active" : ""} href={href}>
                  {label}
                </Link>
              ))}
            </div>
            <div className="admin-menu-group">
              <span className="admin-menu-label">系统</span>
              {primaryLinks.slice(1).map(([href, label]) => (
                <Link key={href} className={activeNav === href ? "is-active" : ""} href={href}>
                  {label}
                </Link>
              ))}
            </div>
          </nav>
          <form action={logoutAction} style={{ marginTop: "auto" }}>
            <button className="btn ghost admin-logout" type="submit">退出登录</button>
          </form>
        </aside>
        <main className="admin-main">
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
        </main>
      </div>
    </div>
  );
}
