"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { logoutAction } from "@/app/admin/actions";

const navigation = [
  { href: "/admin", label: "概览", exact: true },
  { href: "/admin/posts", label: "内容" },
  { href: "/admin/media", label: "媒体" },
  { href: "/admin/themes", label: "外观" },
  { href: "/admin/settings", label: "设置" }
] as const;

function isCurrent(pathname: string, href: string, exact?: boolean) {
  return exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
}

export function AdminShell({
  brandMark,
  variantLabel,
  decoration,
  fallbackMessage,
  children
}: {
  brandMark: React.ReactNode;
  variantLabel: string;
  decoration: React.ReactNode;
  fallbackMessage?: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const toggleRef = useRef<HTMLButtonElement | null>(null);
  const firstLinkRef = useRef<HTMLAnchorElement | null>(null);

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    firstLinkRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      toggleRef.current?.focus();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div className={`admin-shell ${open ? "is-nav-open" : ""}`}>
      {decoration}
      <header className="admin-mobile-header">
        <Link className="admin-mobile-brand" href="/admin">
          {brandMark}
          <span>ManJyun Admin</span>
          <small>{variantLabel}</small>
        </Link>
        <button
          ref={toggleRef}
          className="admin-nav-toggle"
          type="button"
          aria-expanded={open}
          aria-controls="admin-primary-navigation"
          aria-label={open ? "关闭后台导航" : "打开后台导航"}
          onClick={() => setOpen((current) => !current)}
        >
          <i /><i /><i />
        </button>
      </header>
      <button
        className="admin-nav-backdrop"
        type="button"
        aria-label="关闭后台导航"
        tabIndex={open ? 0 : -1}
        onClick={() => {
          setOpen(false);
          toggleRef.current?.focus();
        }}
      />
      <div className="admin-frame">
        <aside className="admin-sidebar" id="admin-primary-navigation">
          <Link className="admin-brand" href="/admin">
            {brandMark}
            <span className="admin-brand-copy">
              <b>ManJyun Admin</b>
              <small>{variantLabel}</small>
            </span>
          </Link>
          <Link className="admin-create-link" href="/admin/posts/new">
            <span aria-hidden="true">＋</span> 新建内容
          </Link>
          <nav className="admin-menu" aria-label="后台主导航">
            <span className="admin-menu-label">Workspace</span>
            {navigation.map((item, index) => (
              <Link
                ref={index === 0 ? firstLinkRef : undefined}
                key={item.href}
                className={isCurrent(pathname, item.href, "exact" in item ? item.exact : false) ? "is-active" : ""}
                href={item.href}
                aria-current={isCurrent(pathname, item.href, "exact" in item ? item.exact : false) ? "page" : undefined}
              >
                {item.label}
              </Link>
            ))}
          </nav>
          <div className="admin-sidebar-utilities">
            <Link href="/" target="_blank" rel="noreferrer">查看站点 ↗</Link>
            <form action={logoutAction}>
              <button className="admin-logout" type="submit">退出登录</button>
            </form>
          </div>
        </aside>
        <main className="admin-main">
          {fallbackMessage ? (
            <div className="admin-fallback-notice" role="status">
              {fallbackMessage}
            </div>
          ) : null}
          {children}
        </main>
      </div>
    </div>
  );
}
