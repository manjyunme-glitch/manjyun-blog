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
