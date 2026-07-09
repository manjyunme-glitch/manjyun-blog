"use client";

import { useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import type { RenderedMarkdown } from "@/types/blog";

type TocItem = RenderedMarkdown["toc"][number];

function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function easeOutQuint(progress: number) {
  return 1 - Math.pow(1 - progress, 5);
}

function navOffset() {
  const nav = document.querySelector<HTMLElement>(".site-nav");
  if (!nav || getComputedStyle(nav).position !== "fixed") return 22;
  return nav.getBoundingClientRect().height + 22;
}

function tocActivationOffset() {
  return navOffset() + Math.min(260, window.innerHeight * 0.34);
}

function scrollWindowTo(
  target: number,
  onDone: () => void,
  frameRef: MutableRefObject<number | null>
) {
  if (frameRef.current) {
    cancelAnimationFrame(frameRef.current);
    frameRef.current = null;
  }

  if (prefersReducedMotion()) {
    window.scrollTo({ top: target, behavior: "auto" });
    onDone();
    return;
  }

  const start = window.scrollY;
  const distance = target - start;
  const duration = Math.min(1100, Math.max(520, Math.abs(distance) * 0.5));
  const startedAt = performance.now();

  function frame(now: number) {
    const progress = Math.min(1, (now - startedAt) / duration);
    window.scrollTo(0, start + distance * easeOutQuint(progress));
    if (progress < 1) {
      frameRef.current = requestAnimationFrame(frame);
      return;
    }

    frameRef.current = null;
    onDone();
  }

  frameRef.current = requestAnimationFrame(frame);
}

export function PostToc({ items }: { items: TocItem[] }) {
  const [activeId, setActiveId] = useState(items[0]?.id ?? "");
  const [visible, setVisible] = useState(false);
  const [indicator, setIndicator] = useState({
    top: 0,
    height: 22,
    moving: false,
    jumping: false,
    ready: false
  });
  const listRef = useRef<HTMLDivElement | null>(null);
  const linkRefs = useRef(new Map<string, HTMLAnchorElement>());
  const animationFrameRef = useRef<number | null>(null);
  const indicatorTimerRef = useRef<number | null>(null);
  const previousIndicatorRef = useRef<{ top: number; height: number } | null>(null);
  const previousActiveIndexRef = useRef(0);
  const lastIndicatorMoveAtRef = useRef(0);
  const programmaticTargetRef = useRef("");
  const ids = useMemo(() => items.map((item) => item.id), [items]);

  useEffect(() => {
    const update = () => {
      setVisible(window.scrollY > window.innerHeight * 0.28);
    };

    update();
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, []);

  useEffect(() => {
    if (!ids.length) return;

    let ticking = false;

    const update = () => {
      ticking = false;
      if (programmaticTargetRef.current) {
        setActiveId(programmaticTargetRef.current);
        return;
      }

      const scrollBottom = window.scrollY + window.innerHeight;
      const pageBottom = document.documentElement.scrollHeight - 2;
      if (scrollBottom >= pageBottom) {
        setActiveId(ids[ids.length - 1]);
        return;
      }

      const anchorY = window.scrollY + tocActivationOffset();
      let bestId = ids[0];

      for (const id of ids) {
        const heading = document.getElementById(id);
        if (!heading) continue;
        const headingTop = heading.getBoundingClientRect().top + window.scrollY;
        if (headingTop <= anchorY) {
          bestId = id;
        }
      }

      setActiveId(bestId);
    };

    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(update);
    };

    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [ids]);

  useEffect(() => {
    return () => {
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
      if (indicatorTimerRef.current) window.clearTimeout(indicatorTimerRef.current);
    };
  }, []);

  useEffect(() => {
    const list = listRef.current;
    const activeLink = linkRefs.current.get(activeId);
    if (!list || !activeLink) return;

    const markerHeight = Math.min(34, Math.max(20, activeLink.clientHeight - 8));
    const markerTop =
      activeLink.offsetTop + Math.max(3, (activeLink.clientHeight - markerHeight) / 2);
    const previous = previousIndicatorRef.current;
    const currentIndex = Math.max(0, ids.indexOf(activeId));

    if (indicatorTimerRef.current) {
      window.clearTimeout(indicatorTimerRef.current);
      indicatorTimerRef.current = null;
    }

    if (previous && !prefersReducedMotion() && Math.abs(previous.top - markerTop) > 4) {
      const now = performance.now();
      const distance = Math.abs(previous.top - markerTop);
      const indexDistance = Math.abs(currentIndex - previousActiveIndexRef.current);
      const rapid = now - lastIndicatorMoveAtRef.current < 220;

      if (distance > 96 || indexDistance > 2 || rapid) {
        setIndicator({
          top: previous.top,
          height: previous.height,
          moving: false,
          jumping: true,
          ready: false
        });
        indicatorTimerRef.current = window.setTimeout(() => {
          setIndicator({
            top: markerTop,
            height: markerHeight,
            moving: false,
            jumping: true,
            ready: true
          });
          indicatorTimerRef.current = window.setTimeout(() => {
            setIndicator({
              top: markerTop,
              height: markerHeight,
              moving: false,
              jumping: false,
              ready: true
            });
          }, 160);
        }, 92);
      } else {
        const stretchTop = Math.min(previous.top, markerTop);
        const stretchHeight = Math.min(distance + markerHeight, 76);
        setIndicator({
          top: stretchTop,
          height: stretchHeight,
          moving: true,
          jumping: false,
          ready: true
        });
        indicatorTimerRef.current = window.setTimeout(() => {
          setIndicator({
            top: markerTop,
            height: markerHeight,
            moving: false,
            jumping: false,
            ready: true
          });
        }, 170);
      }
      lastIndicatorMoveAtRef.current = now;
    } else {
      setIndicator({
        top: markerTop,
        height: markerHeight,
        moving: false,
        jumping: false,
        ready: true
      });
      lastIndicatorMoveAtRef.current = performance.now();
    }
    previousIndicatorRef.current = { top: markerTop, height: markerHeight };
    previousActiveIndexRef.current = currentIndex;

    const top = activeLink.offsetTop - list.clientHeight / 2 + activeLink.clientHeight / 2;
    list.scrollTo({
      top,
      behavior: prefersReducedMotion() ? "auto" : "smooth"
    });
  }, [activeId]);

  function jumpTo(item: TocItem) {
    const heading = document.getElementById(item.id);
    if (!heading) return;

    programmaticTargetRef.current = item.id;
    setActiveId(item.id);
    history.replaceState(null, "", `#${item.id}`);
    const target = Math.max(
      0,
      heading.getBoundingClientRect().top + window.scrollY - navOffset()
    );

    scrollWindowTo(
      target,
      () => {
        setActiveId(item.id);
        window.setTimeout(() => {
          if (programmaticTargetRef.current === item.id) {
            programmaticTargetRef.current = "";
          }
        }, 120);
      },
      animationFrameRef
    );
  }

  return (
    <nav
      className={`toc ${visible ? "is-visible" : ""}`}
      aria-label="Article sections"
      aria-hidden={!visible}
    >
      <div className="toc-title">目录</div>
      <div className="toc-links" ref={listRef}>
        <span
          className={`toc-indicator ${indicator.moving ? "is-moving" : ""} ${indicator.jumping ? "is-jumping" : ""}`}
          aria-hidden="true"
          style={{
            height: `${indicator.height}px`,
            opacity: indicator.ready ? 1 : 0,
            transform: `translateY(${indicator.top}px)`
          }}
        />
        {items.map((item) => (
          <a
            key={item.id}
            ref={(node) => {
              if (node) {
                linkRefs.current.set(item.id, node);
              } else {
                linkRefs.current.delete(item.id);
              }
            }}
            className={`toc-link toc-h${item.level} ${activeId === item.id ? "is-active" : ""}`}
            href={`#${item.id}`}
            aria-current={activeId === item.id ? "true" : undefined}
            onClick={(event) => {
              event.preventDefault();
              jumpTo(item);
            }}
          >
            {item.text}
          </a>
        ))}
      </div>
    </nav>
  );
}
