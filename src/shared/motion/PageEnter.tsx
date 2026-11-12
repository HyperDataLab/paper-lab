import { useRef, type ReactNode } from 'react';
import { gsap, motionAllowed, useGSAP } from './gsap';

/**
 * The one orchestrated moment on arrival: the page's first blocks rise a few pixels into place, in order.
 * The wrapper is `display: contents`, so it never changes the page's layout.
 */
export function PageEnter({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useGSAP(
    () => {
      const page = ref.current?.firstElementChild;
      if (!page || !motionAllowed()) return;
      const parts = Array.from(page.children)
        .filter((child) => !(child as HTMLElement).hidden)
        .slice(0, 6);
      if (parts.length === 0) return;
      gsap.from(parts, {
        // Opacity, not autoAlpha: content must stay in the accessibility tree while it fades in.
        opacity: 0,
        y: 8,
        duration: 0.32,
        stagger: 0.045,
        clearProps: 'opacity,transform',
      });
    },
    { scope: ref },
  );
  return (
    <div ref={ref} style={{ display: 'contents' }}>
      {children}
    </div>
  );
}
