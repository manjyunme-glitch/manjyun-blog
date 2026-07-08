"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";

export function PublicInteractions() {
  const pathname = usePathname();
  const [visible, setVisible] = useState(false);
  const pendingTimerRef = useRef<number | null>(null);

  const clearPending = useCallback(() => {
    document.documentElement.classList.remove("route-pending");
    if (pendingTimerRef.current) window.clearTimeout(pendingTimerRef.current);
    pendingTimerRef.current = null;
  }, []);

  useEffect(() => {
    const nav = document.querySelector<HTMLElement>(".site-nav");
    document.documentElement.classList.add("scroll-nav-enabled");
    const update = () => {
      const active = window.scrollY > window.innerHeight * 0.28;
      setVisible(active);
      nav?.classList.toggle("is-visible", active);
      nav?.classList.toggle("is-scrolled", active);
      if (active) {
        nav?.removeAttribute("aria-hidden");
        nav?.removeAttribute("inert");
      } else {
        nav?.setAttribute("aria-hidden", "true");
        nav?.setAttribute("inert", "");
      }
    };
    update();
    window.addEventListener("scroll", update, { passive: true });
    return () => {
      window.removeEventListener("scroll", update);
      document.documentElement.classList.remove("scroll-nav-enabled");
    };
  }, []);

  useEffect(() => {
    clearPending();
  }, [pathname, clearPending]);

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
        return;
      }

      const link = (event.target as Element | null)?.closest<HTMLAnchorElement>(
        ".site-nav a[href]"
      );
      if (!link || link.target || link.origin !== window.location.origin) return;
      if (link.pathname === window.location.pathname && link.hash === window.location.hash) return;

      document.documentElement.classList.add("route-pending");
      if (pendingTimerRef.current) window.clearTimeout(pendingTimerRef.current);
      pendingTimerRef.current = window.setTimeout(clearPending, 280);
    };

    document.addEventListener("click", onClick, true);
    window.addEventListener("pageshow", clearPending);

    return () => {
      document.removeEventListener("click", onClick, true);
      window.removeEventListener("pageshow", clearPending);
      clearPending();
    };
  }, [clearPending]);

  return (
    <button
      className={`scroll-top ${visible ? "visible" : ""}`}
      type="button"
      aria-label="回到顶部"
      onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
    >
      ↑
    </button>
  );
}
