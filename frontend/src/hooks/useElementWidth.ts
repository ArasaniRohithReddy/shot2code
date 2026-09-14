import { useEffect, useState, type RefObject } from "react";

/**
 * Measures an element's width and follows it.
 *
 * The Code tab sits inside the resizable main column, so its own constraints
 * depend on how wide it currently is rather than on the viewport. Returns
 * `Infinity` until the element is measured, which the sizing helpers read as
 * "unknown, do not constrain".
 */
export function useElementWidth(ref: RefObject<HTMLElement>): number {
  const [width, setWidth] = useState(Number.POSITIVE_INFINITY);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    if (typeof ResizeObserver === "undefined") {
      setWidth(element.getBoundingClientRect().width);
      return;
    }

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) setWidth(entry.contentRect.width);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);

  return width;
}

export default useElementWidth;
