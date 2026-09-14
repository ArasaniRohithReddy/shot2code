import { useEffect, useState } from "react";

/**
 * Tracks a CSS media query so layout state can follow the same breakpoints as
 * the Tailwind classes. Falls back to `false` where `matchMedia` is missing
 * (server rendering, older test environments) rather than throwing.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => {
    if (typeof window === "undefined" || !window.matchMedia) return false;
    return window.matchMedia(query).matches;
  });

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;

    const mediaQuery = window.matchMedia(query);
    const handleChange = (event: MediaQueryListEvent) =>
      setMatches(event.matches);

    setMatches(mediaQuery.matches);

    if (mediaQuery.addEventListener) {
      mediaQuery.addEventListener("change", handleChange);
      return () => mediaQuery.removeEventListener("change", handleChange);
    }

    mediaQuery.addListener(handleChange);
    return () => mediaQuery.removeListener(handleChange);
  }, [query]);

  return matches;
}

/** Matches Tailwind's `xl` breakpoint, where the workspace gains side rails. */
export const XL_MEDIA_QUERY = "(min-width: 1280px)";

/** Matches Tailwind's `sm` breakpoint, the smallest width with room for
 *  secondary toolbar controls. */
export const SM_MEDIA_QUERY = "(min-width: 640px)";

export default useMediaQuery;
