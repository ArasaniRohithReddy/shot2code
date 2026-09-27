import { useCallback, useEffect, useMemo, useRef } from "react";
import { nanoid } from "nanoid";
import useThrottle from "../../hooks/useThrottle";
import { useAppStore } from "../../store/app-store";
import { normalizeBabelCdn } from "../../lib/babelCdn";
import {
  createClearPreviewSelectionMessage,
  createPreviewHostMessage,
  createSandboxedPreviewDocument,
  parsePreviewToHostMessage,
  PREVIEW_SANDBOX,
} from "../../lib/preview-bridge";
import {
  resolvePreviewLayoutUpdate,
  type PreviewCanvasLayout,
  type PreviewViewMode,
} from "./preview-layout";

interface Props {
  code: string;
  device: "mobile" | "desktop";
  onScaleChange?: (scale: number) => void;
  viewMode?: PreviewViewMode;
  /** Explicit zoom ratio, honoured only while `viewMode` is `"custom"`. */
  customScale?: number;
  refreshToken?: number;
}

function PreviewComponent({
  code,
  device,
  onScaleChange,
  viewMode,
  customScale,
  refreshToken = 0,
}: Props) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const previewIdRef = useRef(`${device}-${nanoid(10)}`);
  const previousNonceRef = useRef<string | null>(null);
  // Last geometry actually written to the DOM. Comparing against it is what
  // stops an unchanged measurement from rewriting styles or re-reporting a
  // scale, which would re-render the toolbar on every observer callback.
  const appliedLayoutRef = useRef<PreviewCanvasLayout | null>(null);
  const layoutFrameRef = useRef<number | null>(null);
  const throttledCode = useThrottle(code, 200);
  const activeMode = viewMode ?? "fit";
  const {
    inSelectAndEditMode,
    selectedElement,
    setSelectedElement,
    disableInSelectAndEditMode,
  } = useAppStore();

  const sandboxedDocument = useMemo(
    () =>
      createSandboxedPreviewDocument(
        normalizeBabelCdn(throttledCode),
        `${nanoid(24)}_${refreshToken}`
      ),
    [refreshToken, throttledCode]
  );

  const postBridgeState = useCallback(() => {
    const target = iframeRef.current?.contentWindow;
    if (!target) return;

    target.postMessage(
      createPreviewHostMessage(
        sandboxedDocument.nonce,
        inSelectAndEditMode
      ),
      "*"
    );
    if (
      !selectedElement ||
      selectedElement.previewId !== previewIdRef.current
    ) {
      target.postMessage(
        createClearPreviewSelectionMessage(sandboxedDocument.nonce),
        "*"
      );
    }
  }, [inSelectAndEditMode, sandboxedDocument.nonce, selectedElement]);

  useEffect(() => {
    const previousNonce = previousNonceRef.current;
    previousNonceRef.current = sandboxedDocument.nonce;
    if (
      previousNonce &&
      previousNonce !== sandboxedDocument.nonce &&
      selectedElement?.previewId === previewIdRef.current
    ) {
      setSelectedElement(null);
    }
  }, [sandboxedDocument.nonce, selectedElement, setSelectedElement]);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.source !== iframeRef.current?.contentWindow) return;
      const message = parsePreviewToHostMessage(
        event.data,
        sandboxedDocument.nonce
      );
      if (!message) return;

      if (message.type === "selection") {
        setSelectedElement({
          ...message.payload,
          previewId: previewIdRef.current,
        });
      } else if (message.type === "exit-select-mode") {
        disableInSelectAndEditMode();
      } else if (message.type === "ready") {
        postBridgeState();
      }
    };

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [
    disableInSelectAndEditMode,
    postBridgeState,
    sandboxedDocument.nonce,
    setSelectedElement,
  ]);

  useEffect(() => {
    postBridgeState();
  }, [postBridgeState]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;

    const applyLayout = () => {
      layoutFrameRef.current = null;
      const canvas = canvasRef.current;
      const iframe = iframeRef.current;
      if (!canvas || !iframe) return;

      const rect = viewport.getBoundingClientRect();
      const update = resolvePreviewLayoutUpdate({
        device,
        viewMode: activeMode,
        customScale,
        box: {
          rectWidth: rect.width,
          rectHeight: rect.height,
          offsetWidth: viewport.offsetWidth,
          offsetHeight: viewport.offsetHeight,
          clientWidth: viewport.clientWidth,
          clientHeight: viewport.clientHeight,
        },
        applied: appliedLayoutRef.current,
      });
      if (update.action === "skip") return;

      const { layout } = update;
      appliedLayoutRef.current = layout;

      canvas.style.width = `${layout.canvasWidth}px`;
      canvas.style.height = `${layout.canvasHeight}px`;

      iframe.style.width = `${layout.iframeWidth}px`;
      iframe.style.height = `${layout.iframeHeight}px`;
      iframe.style.transform = `scale(${layout.scale})`;
      iframe.style.transformOrigin = "top left";

      // Reported last, and only for geometry that really changed, so the
      // toolbar percentage cannot feed a re-render back into this loop.
      onScaleChange?.(layout.scale);
    };

    const scheduleLayout = () => {
      if (layoutFrameRef.current !== null) return;
      layoutFrameRef.current = window.requestAnimationFrame(applyLayout);
    };

    // A view-mode or zoom change has to land in the same frame as the click,
    // so the first pass is synchronous; observer callbacks are coalesced.
    applyLayout();

    // No `window.resize` listener: the observer already fires for every box
    // change, including window resizes, pane collapses and scrollbar gutters.
    // Listening to both ran the layout pass twice per frame for one change.
    const observer =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(scheduleLayout);
    observer?.observe(viewport);

    return () => {
      if (layoutFrameRef.current !== null) {
        window.cancelAnimationFrame(layoutFrameRef.current);
        layoutFrameRef.current = null;
      }
      observer?.disconnect();
    };
  }, [activeMode, customScale, device, onScaleChange]);

  return (
    <div
      ref={viewportRef}
      data-testid={`preview-viewport-${device}`}
      className="relative min-h-0 flex-1 overflow-auto bg-gray-100 dark:bg-zinc-900"
    >
      {/* `w-fit min-w-full` centres the canvas while it is narrower than the
          viewport and falls back to scrolling instead of clipping once it is
          wider. */}
      <div className="flex min-h-full w-fit min-w-full justify-center">
        <div
          ref={canvasRef}
          data-testid={`preview-canvas-${device}`}
          className="shrink-0 overflow-hidden bg-white shadow-md ring-1 ring-black/10 dark:shadow-none dark:ring-white/10"
        >
          <iframe
            id={`preview-${device}`}
            ref={iframeRef}
            title="Preview"
            className="block border-0 bg-white"
            sandbox={PREVIEW_SANDBOX}
            referrerPolicy="no-referrer"
            allow="camera 'none'; microphone 'none'; geolocation 'none'; display-capture 'none'"
            srcDoc={sandboxedDocument.html}
            onLoad={postBridgeState}
          />
        </div>
      </div>
    </div>
  );
}

export default PreviewComponent;
