import { useEffect, useRef, useState } from 'react';
import { interpolateCount, prefersReducedMotion } from './motion';

/**
 * Animate a number toward `target` (ease-out, ~600ms — the shared
 * --anim-slow tempo). Starts from the previously displayed value, so a
 * refresh glides between readings instead of restarting at zero. Returns
 * the value to render; callers format it (formatSp, formatIsk, …).
 */
export function useCountUp(target: number, durationMs = 600): number {
  const [display, setDisplay] = useState(() => (prefersReducedMotion() ? target : 0));
  const displayRef = useRef(display);
  displayRef.current = display;

  useEffect(() => {
    if (prefersReducedMotion() || durationMs <= 0) {
      setDisplay(target);
      return;
    }
    const from = displayRef.current;
    if (from === target) return;

    let frame = 0;
    const startedAt = performance.now();
    const tick = (now: number): void => {
      const t = (now - startedAt) / durationMs;
      if (t >= 1) {
        setDisplay(target);
        return;
      }
      setDisplay(interpolateCount(from, target, t));
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target, durationMs]);

  return display;
}
