import { useEffect, useRef, useState, useCallback } from "react";
import { LuMinus, LuPlus, LuX } from "react-icons/lu";
import { Dialog, DialogContent, DialogTitle } from "./ui/dialog";

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 10;
const DEFAULT_DISPLAY_WIDTH = 1000;

interface ImageLightboxProps {
  image: string | null;
  onClose: () => void;
}

function ImageLightbox({ image, onClose }: ImageLightboxProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  const [naturalSize, setNaturalSize] = useState<{
    width: number;
    height: number;
  } | null>(null);
  const [fitScale, setFitScale] = useState(1);
  const initialZoomSet = useRef(false);

  const dragRef = useRef({
    isDragging: false,
    startX: 0,
    startY: 0,
    scrollLeft: 0,
    scrollTop: 0,
    didDrag: false,
  });

  // Reset state when image changes
  useEffect(() => {
    setZoom(1);
    setNaturalSize(null);
    setFitScale(1);
    initialZoomSet.current = false;
  }, [image]);

  const recomputeFitScale = useCallback(() => {
    if (!viewportRef.current || !naturalSize) return;

    // Subtract p-8 padding (32px each side)
    const viewportWidth = viewportRef.current.clientWidth - 64;
    const viewportHeight = viewportRef.current.clientHeight - 64;
    if (viewportWidth <= 0 || viewportHeight <= 0) return;

    const scale = Math.min(
      viewportWidth / naturalSize.width,
      viewportHeight / naturalSize.height,
      1
    );
    setFitScale(scale);

    // Set initial zoom to target DEFAULT_DISPLAY_WIDTH (only clamp to viewport width)
    if (!initialZoomSet.current) {
      initialZoomSet.current = true;
      const targetScale = DEFAULT_DISPLAY_WIDTH / naturalSize.width;
      const maxWidthScale = viewportWidth / naturalSize.width;
      const clampedScale = Math.min(targetScale, maxWidthScale);
      setZoom(Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, clampedScale / scale)));
    }
  }, [naturalSize]);

  useEffect(() => {
    if (!image) return;
    recomputeFitScale();

    const handleResize = () => recomputeFitScale();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [image, recomputeFitScale]);

  useEffect(() => {
    recomputeFitScale();
  }, [recomputeFitScale]);

  const zoomIn = () => {
    setZoom((z) => Math.min(MAX_ZOOM, Math.round((z + 0.5) * 100) / 100));
  };

  const zoomOut = () => {
    setZoom((z) => Math.max(MIN_ZOOM, Math.round((z - 0.5) * 100) / 100));
  };

  const zoomToFit = () => setZoom(1);

  const zoomToDefault = () => {
    if (!naturalSize || fitScale <= 0 || !viewportRef.current) return;
    const viewportWidth = viewportRef.current.clientWidth - 64;
    const targetScale = DEFAULT_DISPLAY_WIDTH / naturalSize.width;
    const maxWidthScale = viewportWidth / naturalSize.width;
    const clampedScale = Math.min(targetScale, maxWidthScale);
    setZoom(Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, clampedScale / fitScale)));
  };

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (!viewportRef.current || e.button !== 0) return;
    dragRef.current = {
      isDragging: true,
      startX: e.clientX,
      startY: e.clientY,
      scrollLeft: viewportRef.current.scrollLeft,
      scrollTop: viewportRef.current.scrollTop,
      didDrag: false,
    };
    viewportRef.current.style.cursor = "grabbing";
    e.preventDefault();
  }, []);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    const drag = dragRef.current;
    if (!drag.isDragging || !viewportRef.current) return;

    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;

    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
      drag.didDrag = true;
    }

    viewportRef.current.scrollLeft = drag.scrollLeft - dx;
    viewportRef.current.scrollTop = drag.scrollTop - dy;
  }, []);

  const handleMouseUp = useCallback(() => {
    dragRef.current.isDragging = false;
    if (viewportRef.current) {
      viewportRef.current.style.cursor = "";
    }
  }, []);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    if (!viewportRef.current) return;
    viewportRef.current.scrollTop += e.deltaY;
    viewportRef.current.scrollLeft += e.deltaX;
  }, []);

  const handleViewportClick = useCallback(() => {
    if (dragRef.current.didDrag) {
      dragRef.current.didDrag = false;
      return;
    }
    onClose();
  }, [onClose]);

  const handleViewportKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (!viewportRef.current) return;

      const scrollDistance = event.shiftKey ? 240 : 64;
      switch (event.key) {
        case "ArrowUp":
          event.preventDefault();
          viewportRef.current.scrollBy({ top: -scrollDistance });
          break;
        case "ArrowDown":
          event.preventDefault();
          viewportRef.current.scrollBy({ top: scrollDistance });
          break;
        case "ArrowLeft":
          event.preventDefault();
          viewportRef.current.scrollBy({ left: -scrollDistance });
          break;
        case "ArrowRight":
          event.preventDefault();
          viewportRef.current.scrollBy({ left: scrollDistance });
          break;
        case "+":
        case "=":
          event.preventDefault();
          zoomIn();
          break;
        case "-":
          event.preventDefault();
          zoomOut();
          break;
        case "0":
          event.preventDefault();
          zoomToFit();
          break;
      }
    },
    []
  );

  const effectiveScale = fitScale * zoom;
  const displayWidth = naturalSize
    ? Math.max(1, Math.round(naturalSize.width * effectiveScale))
    : undefined;
  const displayHeight = naturalSize
    ? Math.max(1, Math.round(naturalSize.height * effectiveScale))
    : undefined;

  return (
    <Dialog open={!!image} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="inset-0 left-0 top-0 h-dvh w-screen max-w-none translate-x-0 translate-y-0 gap-0 overflow-hidden border-0 bg-black/90 p-0 shadow-none backdrop-blur-md [&>button]:hidden">
        <DialogTitle className="sr-only">Reference image preview</DialogTitle>
        <div
          ref={viewportRef}
          tabIndex={0}
          aria-label="Zoomed reference image. Use arrow keys to pan, plus and minus to zoom, zero to fit, and Escape to close."
          className="h-full w-full cursor-grab overflow-auto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white"
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          onWheel={handleWheel}
          onClick={handleViewportClick}
          onKeyDown={handleViewportKeyDown}
        >
          <div className="flex min-h-full min-w-full p-4 sm:p-8">
            {image && (
              <img
                src={image}
                alt="Reference image"
                className="m-auto shrink-0 select-none rounded-lg shadow-2xl"
                draggable={false}
                onClick={(event) => event.stopPropagation()}
                style={
                  displayWidth && displayHeight
                    ? {
                        width: `${displayWidth}px`,
                        height: `${displayHeight}px`,
                        maxWidth: "none",
                        maxHeight: "none",
                      }
                    : { visibility: "hidden" as const }
                }
                onLoad={(event) => {
                  setNaturalSize({
                    width: event.currentTarget.naturalWidth,
                    height: event.currentTarget.naturalHeight,
                  });
                }}
              />
            )}
          </div>
        </div>

        <div
          className="absolute bottom-4 left-1/2 z-10 flex max-w-[calc(100vw-2rem)] -translate-x-1/2 items-center gap-1 rounded-full bg-black/70 px-2 py-1 shadow-lg backdrop-blur-md sm:bottom-6 sm:px-3"
          onClick={(event) => event.stopPropagation()}
          onMouseDown={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            onClick={zoomOut}
            className="flex h-11 w-11 items-center justify-center rounded-full text-white/80 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-30"
            disabled={zoom <= MIN_ZOOM}
            aria-label="Zoom out"
            title="Zoom out"
          >
            <LuMinus className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={zoomToDefault}
            className="min-h-11 min-w-14 rounded-full px-2 text-center text-xs font-medium text-white/80 transition-colors hover:bg-white/10 hover:text-white"
            aria-label={`Reset zoom. Current zoom ${Math.round(zoom * 100)} percent`}
            title="Reset zoom"
          >
            {Math.round(zoom * 100)}%
          </button>
          <button
            type="button"
            onClick={zoomIn}
            className="flex h-11 w-11 items-center justify-center rounded-full text-white/80 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-30"
            disabled={zoom >= MAX_ZOOM}
            aria-label="Zoom in"
            title="Zoom in"
          >
            <LuPlus className="h-4 w-4" />
          </button>
          <div className="mx-1 hidden h-4 w-px bg-white/20 sm:block" />
          <button
            type="button"
            onClick={zoomToFit}
            className="min-h-11 rounded-full px-3 text-xs font-medium text-white/80 transition-colors hover:bg-white/10 hover:text-white"
            title="Fit to screen"
          >
            Fit
          </button>
          <div className="mx-1 hidden h-4 w-px bg-white/20 sm:block" />
          <button
            type="button"
            onClick={onClose}
            className="flex h-11 w-11 items-center justify-center rounded-full text-white/80 transition-colors hover:bg-white/10 hover:text-white"
            aria-label="Close reference image"
            title="Close"
          >
            <LuX className="h-4 w-4" />
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default ImageLightbox;
