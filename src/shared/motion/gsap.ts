import { gsap } from 'gsap';
import { useGSAP } from '@gsap/react';

gsap.registerPlugin(useGSAP);
gsap.defaults({ ease: 'power2.out', duration: 0.28 });

/**
 * Motion in PaperLab answers an action (a drawer opens, a tab moves, the analysis column folds) or marks one
 * arrival on a page. It never decorates. Anyone who asks the system for less motion gets none, and a browser
 * without matchMedia (tests, old engines) gets the end state directly.
 */
export function motionAllowed(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    !window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

export { gsap, useGSAP };
