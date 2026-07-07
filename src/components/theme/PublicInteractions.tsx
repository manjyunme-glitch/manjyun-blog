"use client";

import { useEffect, useState } from "react";

export function PublicInteractions() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const nav = document.querySelector(".site-nav");
    const update = () => {
      const active = window.scrollY > window.innerHeight * 0.28;
      setVisible(active);
      nav?.classList.toggle("is-scrolled", window.scrollY > 8);
    };
    update();
    window.addEventListener("scroll", update, { passive: true });
    return () => window.removeEventListener("scroll", update);
  }, []);

  useEffect(() => {
    let timer: number | undefined;

    const clearPending = () => {
      document.documentElement.classList.remove("route-pending");
      if (timer) window.clearTimeout(timer);
      timer = undefined;
    };

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
      if (timer) window.clearTimeout(timer);
      timer = window.setTimeout(clearPending, 420);
    };

    document.addEventListener("click", onClick, true);
    window.addEventListener("pageshow", clearPending);

    return () => {
      document.removeEventListener("click", onClick, true);
      window.removeEventListener("pageshow", clearPending);
      clearPending();
    };
  }, []);

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
