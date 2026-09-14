import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  clamp,
  describePaneWidth,
  PANE_RESIZE_LARGE_STEP,
  PANE_RESIZE_STEP,
  resizeWidthForKey,
} from "../../lib/pane-sizing";

export interface PaneResizerProps {
  /** Human name of the pane being sized, e.g. "Chat panel width". */
  label: string;
  /** `id` of the element this separator resizes. */
  controls: string;
  width: number;
  min: number;
  max: number;
  defaultWidth: number;
  onWidthChange: (width: number) => void;
  /** Positioning is the caller's job; the separator only sizes itself. */
  className?: string;
  style?: CSSProperties;
  testId?: string;
}

/**
 * A draggable, focusable separator between two panes.
 *
 * Sizing lives in `lib/pane-sizing`; this component is the event surface:
 *
 * - Pointer capture means a fast drag keeps working over the preview iframe,
 *   which would otherwise swallow the events the moment the cursor left the
 *   handle.
 * - The `workspace-resizing` body class kills text selection and iframe hit
 *   testing for the duration, and is removed by the effect cleanup, so an
 *   unmount mid-drag cannot leave the page unselectable.
 * - The element is a 44px gutter between the two panes rather than an overlay
 *   on top of them, so a comfortable target never costs a click on a
 *   scrollbar, a tab, a tree row, or the preview itself. At rest it shows
 *   nothing; the divider stays the neighbouring pane's hairline border.
 */
export function PaneResizer({
  label,
  controls,
  width,
  min,
  max,
  defaultWidth,
  onWidthChange,
  className = "",
  style,
  testId,
}: PaneResizerProps) {
  const dragRef = useRef<{
    pointerId: number;
    originX: number;
    originWidth: number;
  } | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const helpId = `${controls}-resizer-help`;

  const stopDragging = useCallback(() => {
    dragRef.current = null;
    setIsDragging(false);
  }, []);

  // Text selection and iframe hit testing are disabled globally rather than on
  // the handle, because the pointer spends the drag outside it.
  useEffect(() => {
    if (!isDragging || typeof document === "undefined") return;
    const { body } = document;
    body.classList.add("workspace-resizing");
    return () => body.classList.remove("workspace-resizing");
  }, [isDragging]);

  // Escape abandons the drag and puts the width back where it started.
  useEffect(() => {
    if (!isDragging || typeof window === "undefined") return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      const drag = dragRef.current;
      stopDragging();
      if (drag) onWidthChange(clamp(drag.originWidth, min, max));
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isDragging, max, min, onWidthChange, stopDragging]);

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      originX: event.clientX,
      originWidth: width,
    };
    setIsDragging(true);
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const next = clamp(
      drag.originWidth + (event.clientX - drag.originX),
      min,
      max
    );
    if (next !== width) onWidthChange(next);
  };

  const handlePointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    stopDragging();
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const next = resizeWidthForKey(event.key, {
      width,
      min,
      max,
      defaultWidth,
      shiftKey: event.shiftKey,
    });
    if (next === null) return;
    event.preventDefault();
    if (next !== width) onWidthChange(next);
  };

  return (
    <>
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label={label}
        aria-controls={controls}
        aria-describedby={helpId}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={Math.round(width)}
        aria-valuetext={describePaneWidth(label, width)}
        aria-keyshortcuts="ArrowLeft ArrowRight Home End Enter"
        tabIndex={0}
        data-testid={testId}
        data-dragging={isDragging ? "true" : "false"}
        title={`${label}. Drag, or use the arrow keys. Double-click to reset.`}
        style={style}
        className={`group flex w-11 cursor-col-resize touch-none select-none items-center justify-start focus:outline-none focus-visible:outline-none ${className}`}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onLostPointerCapture={stopDragging}
        onDoubleClick={() => onWidthChange(clamp(defaultWidth, min, max))}
        onKeyDown={handleKeyDown}
      >
        {/* Sits on the neighbouring pane's own border, so hovering anywhere in
            the gutter highlights the divider the user already sees. The grip
            is positioned against this rule rather than the separator, whose
            `position` belongs to the caller. */}
        <span
          aria-hidden="true"
          className="pointer-events-none relative h-full w-px bg-transparent transition-colors duration-150 group-hover:bg-violet-400 group-focus-visible:bg-violet-500 group-data-[dragging=true]:bg-violet-500 dark:group-hover:bg-violet-500 dark:group-focus-visible:bg-violet-400 dark:group-data-[dragging=true]:bg-violet-400"
        >
          <span className="absolute left-1/2 top-1/2 h-10 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-violet-500 opacity-0 shadow-sm transition-opacity duration-150 group-hover:opacity-90 group-focus-visible:opacity-100 group-focus-visible:ring-2 group-focus-visible:ring-violet-300 group-data-[dragging=true]:opacity-100 dark:bg-violet-400 dark:group-focus-visible:ring-violet-700" />
        </span>
      </div>
      <span id={helpId} className="sr-only">
        {`Drag to resize, or press the left and right arrow keys to move in ${PANE_RESIZE_STEP} pixel steps. Hold Shift for ${PANE_RESIZE_LARGE_STEP} pixel steps. Home is the narrowest width, End the widest, and Enter or a double-click restores the default.`}
      </span>
    </>
  );
}

export default PaneResizer;
