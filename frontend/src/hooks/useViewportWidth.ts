import { useEffect, useState } from "react";

/**
 * Tracks the viewport width so pane constraints can follow the window.
 *
 * Returns `Infinity` where there is no window (tests, server rendering), which
 * the sizing helpers read as "unknown, do not constrain" instead of clamping
 * every pane down to its minimum.
 */
export function useViewportWidth(): number {
  const [width, setWidth] = useState(() =>
    typeof window === "undefined" ? Number.POSITIVE_INFINITY : window.innerWidth
  );

  useEffect(() => {
    if (typeof window === "undefined") return;

    let frame = 0;
    const handleResize = () => {
      // Resize fires faster than paint; one measurement per frame is enough
      // and keeps a dragged window edge from thrashing React.
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => setWidth(window.innerWidth));
    };

    setWidth(window.innerWidth);
    window.addEventListener("resize", handleResize);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", handleResize);
    };
  }, []);

  return width;
}

export default useViewportWidth;
