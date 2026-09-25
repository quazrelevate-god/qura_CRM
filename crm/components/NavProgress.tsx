'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';

/** Purple progress bar at the top of the page during route changes and form submits. */
export default function NavProgress() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [visible, setVisible] = useState(false);
  const [progress, setProgress] = useState(0);
  const timers = useRef<number[]>([]);

  // Clear all pending progress ticks
  const clearTimers = () => {
    timers.current.forEach((t) => window.clearTimeout(t));
    timers.current = [];
  };

  // Called on click / submit — start the bar
  const start = () => {
    clearTimers();
    setVisible(true);
    setProgress(15);
    // trickle up toward 80% over ~1.5s
    const steps: [number, number][] = [[120, 30], [280, 50], [500, 65], [900, 75], [1500, 82]];
    steps.forEach(([delay, target]) => {
      timers.current.push(window.setTimeout(() => setProgress((p) => (p < target ? target : p)), delay));
    });
  };

  // Hide the bar when the URL actually changes (navigation is done)
  useEffect(() => {
    if (!visible) return;
    clearTimers();
    setProgress(100);
    const t1 = window.setTimeout(() => setVisible(false), 220);
    const t2 = window.setTimeout(() => setProgress(0), 260);
    timers.current.push(t1, t2);
    return () => { window.clearTimeout(t1); window.clearTimeout(t2); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, searchParams]);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const el = e.target instanceof HTMLElement ? e.target.closest('a') : null;
      if (!el || !(el instanceof HTMLAnchorElement)) return;
      if (el.target && el.target !== '_self') return;
      if (el.hasAttribute('download')) return;
      const href = el.getAttribute('href');
      if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:') || href.startsWith('javascript:')) return;
      let url: URL;
      try { url = new URL(el.href, window.location.href); } catch { return; }
      if (url.origin !== window.location.origin) return;
      if (url.pathname === window.location.pathname && url.search === window.location.search && url.hash) return;
      start();
    };
    const onSubmit = (e: SubmitEvent) => {
      if (e.defaultPrevented) return;
      const form = e.target;
      if (!(form instanceof HTMLFormElement)) return;
      // React server-action forms use method="POST" with encType multipart/form-data; ordinary GET/POST navigations also apply
      start();
    };
    const onPop = () => start();
    document.addEventListener('click', onClick, true);
    document.addEventListener('submit', onSubmit, true);
    window.addEventListener('popstate', onPop);
    return () => {
      document.removeEventListener('click', onClick, true);
      document.removeEventListener('submit', onSubmit, true);
      window.removeEventListener('popstate', onPop);
    };
  }, []);

  return (
    <div className="nav-progress" aria-hidden data-visible={visible ? '1' : '0'}>
      <div className="nav-progress-bar" style={{ transform: `translateX(${progress - 100}%)` }} />
    </div>
  );
}
