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

interface Props {
  code: string;
  device: "mobile" | "desktop";
  onScaleChange?: (scale: number) => void;
  viewMode?: "fit" | "actual";
  refreshToken?: number;
}

const MOBILE_VIEWPORT_WIDTH = 375;
export const DESKTOP_VIEWPORT_WIDTH = 1366;

function PreviewComponent({
  code,
  device,
  onScaleChange,
  viewMode,
  refreshToken = 0,
}: Props) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const previewIdRef = useRef(`${device}-${nanoid(10)}`);
  const previousNonceRef = useRef<string | null>(null);
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
    const updateScale = () => {
      const wrapper = wrapperRef.current;
      const iframe = iframeRef.current;
      if (!wrapper || !iframe) return;

      const viewportWidth = wrapper.clientWidth;
      const viewportHeight = wrapper.clientHeight;

      if (device === "desktop") {
        const scaleValue =
          activeMode === "fit"
            ? Math.min(1, viewportWidth / DESKTOP_VIEWPORT_WIDTH)
            : 1;
        const iframeHeight =
          scaleValue > 0 ? viewportHeight / scaleValue : viewportHeight;

        onScaleChange?.(scaleValue);
        iframe.style.width = `${DESKTOP_VIEWPORT_WIDTH}px`;
        iframe.style.height = `${iframeHeight}px`;
        iframe.style.transform = `scale(${scaleValue})`;
        iframe.style.transformOrigin = "top left";
        return;
      }

      onScaleChange?.(1);
      iframe.style.width = `${MOBILE_VIEWPORT_WIDTH}px`;
      iframe.style.height = `${viewportHeight}px`;
      iframe.style.transform = "scale(1)";
      iframe.style.transformOrigin = "top left";
    };

    updateScale();
    window.addEventListener("resize", updateScale);
    const resizeObserver = new ResizeObserver(updateScale);
    if (wrapperRef.current) resizeObserver.observe(wrapperRef.current);

    return () => {
      window.removeEventListener("resize", updateScale);
      resizeObserver.disconnect();
    };
  }, [activeMode, device, onScaleChange]);

  return (
    <div
      className={`flex-1 min-h-0 relative ${
        device === "mobile"
          ? "flex justify-center overflow-hidden bg-gray-100 dark:bg-zinc-900"
          : activeMode === "fit"
            ? "flex justify-center overflow-hidden"
            : "overflow-auto"
      }`}
    >
      <div
        ref={wrapperRef}
        className={`w-full h-full ${device === "mobile" ? "flex justify-center" : ""}`}
      >
        <iframe
          id={`preview-${device}`}
          ref={iframeRef}
          title="Preview"
          className="border-0 bg-white"
          sandbox={PREVIEW_SANDBOX}
          referrerPolicy="no-referrer"
          allow="camera 'none'; microphone 'none'; geolocation 'none'; display-capture 'none'"
          srcDoc={sandboxedDocument.html}
          onLoad={postBridgeState}
        />
      </div>
    </div>
  );
}

export default PreviewComponent;
