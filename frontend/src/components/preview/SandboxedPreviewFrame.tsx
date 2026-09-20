import {
  forwardRef,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  type MutableRefObject,
  type IframeHTMLAttributes,
} from "react";
import { nanoid } from "nanoid";
import { normalizeBabelCdn } from "../../lib/babelCdn";
import {
  createRequestPreviewMetricsMessage,
  createSandboxedPreviewDocument,
  parsePreviewToHostMessage,
  PREVIEW_SANDBOX,
  type PreviewRuntimeMetrics,
} from "../../lib/preview-bridge";

interface Props
  extends Omit<
    IframeHTMLAttributes<HTMLIFrameElement>,
    "sandbox" | "src" | "srcDoc" | "referrerPolicy"
  > {
  html: string;
  refreshToken?: number;
  onRuntimeMetrics?: (metrics: PreviewRuntimeMetrics) => void;
}

const SandboxedPreviewFrame = forwardRef<HTMLIFrameElement, Props>(
  function SandboxedPreviewFrame(
    {
      html,
      refreshToken = 0,
      onRuntimeMetrics,
      onLoad,
      ...props
    },
    forwardedRef
  ) {
    const iframeRef = useRef<HTMLIFrameElement | null>(null);
    const metricsCallbackRef = useRef(onRuntimeMetrics);
    metricsCallbackRef.current = onRuntimeMetrics;
    const sandboxedDocument = useMemo(
      () =>
        createSandboxedPreviewDocument(
          normalizeBabelCdn(html),
          `${nanoid(24)}_${refreshToken}`
        ),
      [html, refreshToken]
    );

    const setIframeRef = useCallback(
      (node: HTMLIFrameElement | null) => {
        iframeRef.current = node;
        if (typeof forwardedRef === "function") {
          forwardedRef(node);
        } else if (forwardedRef) {
          (
            forwardedRef as MutableRefObject<HTMLIFrameElement | null>
          ).current = node;
        }
      },
      [forwardedRef]
    );

    useEffect(() => {
      const handleMessage = (event: MessageEvent) => {
        if (event.source !== iframeRef.current?.contentWindow) return;
        const message = parsePreviewToHostMessage(
          event.data,
          sandboxedDocument.nonce
        );
        if (message?.type === "runtime-metrics") {
          metricsCallbackRef.current?.(message.payload);
        }
      };

      window.addEventListener("message", handleMessage);
      if (metricsCallbackRef.current) {
        iframeRef.current?.contentWindow?.postMessage(
          createRequestPreviewMetricsMessage(sandboxedDocument.nonce),
          "*"
        );
      }
      return () => window.removeEventListener("message", handleMessage);
    }, [sandboxedDocument.nonce]);

    const requestRuntimeMetrics = useCallback(() => {
      if (!metricsCallbackRef.current) return;
      iframeRef.current?.contentWindow?.postMessage(
        createRequestPreviewMetricsMessage(sandboxedDocument.nonce),
        "*"
      );
    }, [sandboxedDocument.nonce]);

    return (
      <iframe
        {...props}
        ref={setIframeRef}
        sandbox={PREVIEW_SANDBOX}
        referrerPolicy="no-referrer"
        allow="camera 'none'; microphone 'none'; geolocation 'none'; display-capture 'none'"
        srcDoc={sandboxedDocument.html}
        onLoad={(event) => {
          requestRuntimeMetrics();
          onLoad?.(event);
        }}
      />
    );
  }
);

export default SandboxedPreviewFrame;
