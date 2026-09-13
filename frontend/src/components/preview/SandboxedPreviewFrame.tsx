import {
  forwardRef,
  useMemo,
  type IframeHTMLAttributes,
} from "react";
import { nanoid } from "nanoid";
import { normalizeBabelCdn } from "../../lib/babelCdn";
import {
  createSandboxedPreviewDocument,
  PREVIEW_SANDBOX,
} from "../../lib/preview-bridge";

interface Props
  extends Omit<
    IframeHTMLAttributes<HTMLIFrameElement>,
    "sandbox" | "src" | "srcDoc" | "referrerPolicy"
  > {
  html: string;
}

const SandboxedPreviewFrame = forwardRef<HTMLIFrameElement, Props>(
  function SandboxedPreviewFrame({ html, ...props }, ref) {
    const srcDoc = useMemo(
      () =>
        createSandboxedPreviewDocument(
          normalizeBabelCdn(html),
          nanoid(32)
        ).html,
      [html]
    );

    return (
      <iframe
        {...props}
        ref={ref}
        sandbox={PREVIEW_SANDBOX}
        referrerPolicy="no-referrer"
        allow="camera 'none'; microphone 'none'; geolocation 'none'; display-capture 'none'"
        srcDoc={srcDoc}
      />
    );
  }
);

export default SandboxedPreviewFrame;
