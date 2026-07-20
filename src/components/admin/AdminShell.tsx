"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { logoutAction } from "@/app/admin/actions";

const navigation = [
  { href: "/admin", label: "概览", exact: true },
  { href: "/admin/posts", label: "内容" },
  { href: "/admin/pages", label: "页面" },
  { href: "/admin/media", label: "媒体" },
  { href: "/admin/themes", label: "外观" },
  { href: "/admin/settings", label: "设置" },
  { href: "/admin/account", label: "账号安全" }
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
  const [mobileNavigation, setMobileNavigation] = useState(false);
  const toggleRef = useRef<HTMLButtonElement | null>(null);
  const firstLinkRef = useRef<HTMLAnchorElement | null>(null);
  const sidebarRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const query = window.matchMedia("(max-width: 860px)");
    const sync = () => {
      setMobileNavigation(query.matches);
      if (!query.matches) setOpen(false);
    };
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!mobileNavigation || !open) return;
    const previousFocus =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusFrame = window.requestAnimationFrame(() => {
      firstLinkRef.current?.focus();
    });
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        return;
      }
      if (event.key !== "Tab") return;
      const sidebar = sidebarRef.current;
      if (!sidebar) return;
      const focusable = Array.from(
        sidebar.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )
      ).filter((element) => !element.hidden);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!sidebar.contains(document.activeElement)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, [mobileNavigation, open]);

  const closedMobileNavigation = mobileNavigation && !open;

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
        aria-hidden={!open}
        tabIndex={open ? 0 : -1}
        onClick={() => {
          setOpen(false);
        }}
      />
      <div className="admin-frame">
        <aside
          ref={sidebarRef}
          className="admin-sidebar"
          id="admin-primary-navigation"
          aria-hidden={closedMobileNavigation || undefined}
          inert={closedMobileNavigation || undefined}
        >
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
