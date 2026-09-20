import toast from "react-hot-toast";
import { WS_BACKEND_URL } from "./config";
import {
  APP_ERROR_WEB_SOCKET_CODE,
  USER_CLOSE_WEB_SOCKET_CODE,
} from "./constants";
import { FullGenerationSettings } from "./types";

const ERROR_MESSAGE =
  "Error generating code. Check the Developer Console AND the backend logs for details. Feel free to open a Github issue.";

const CANCEL_MESSAGE = "Code generation cancelled";

export const GENERIC_GENERATION_ERROR = ERROR_MESSAGE;

/**
 * Pick the most useful wording for a generation that ended badly.
 *
 * The backend sends an `error` message and *then* closes the socket. Browsers
 * cap a close reason at 123 UTF-8 bytes and some proxies drop it entirely, so
 * the close frame on its own is not a reliable carrier for the actionable text:
 * falling back to the generic "check the console" line throws away a diagnosis
 * the user was already given, such as a missing key or an exhausted quota.
 *
 * When the close reason is merely a truncated prefix of the streamed error, the
 * full sentence wins - a cut-off message is worse than the whole one.
 */
export function resolveGenerationError(
  closeReason: string | undefined | null,
  lastServerError: string | null,
  fallback: string = ERROR_MESSAGE
): string {
  const reason = (closeReason ?? "").trim();
  const server = (lastServerError ?? "").trim();
  if (server && (reason.length === 0 || server.startsWith(reason))) {
    return server;
  }
  if (reason.length > 0) return reason;
  if (server.length > 0) return server;
  return fallback;
}

type WebSocketResponse = {
  type:
    | "chunk"
    | "status"
    | "setCode"
    | "error"
    | "variantComplete"
    | "variantError"
    | "variantCount"
    | "variantModels"
    | "thinking"
    | "assistant"
    | "toolStart"
    | "toolResult";
  value?: string;
  data?: any;
  eventId?: string;
  variantIndex: number;
};

interface CodeGenerationCallbacks {
  onChange: (chunk: string, variantIndex: number) => void;
  onSetCode: (code: string, variantIndex: number) => void;
  onStatusUpdate: (status: string, variantIndex: number) => void;
  onVariantComplete: (variantIndex: number) => void;
  onVariantError: (variantIndex: number, error: string) => void;
  onVariantCount: (count: number) => void;
  onVariantModels: (models: string[], notice?: string) => void;
  onThinking: (content: string, variantIndex: number, eventId?: string) => void;
  onAssistant: (content: string, variantIndex: number, eventId?: string) => void;
  onToolStart: (data: any, variantIndex: number, eventId?: string) => void;
  onToolResult: (data: any, variantIndex: number, eventId?: string) => void;
  onCancel: (
    reason: "user_cancelled" | "request_failed" | "connection_error",
    errorMessage?: string
  ) => void;
  onComplete: () => void;
}

export function generateCode(
  wsRef: React.MutableRefObject<WebSocket | null>,
  params: FullGenerationSettings,
  callbacks: CodeGenerationCallbacks
) {
  const wsUrl = `${WS_BACKEND_URL}/generate-code`;
  console.log("Connecting to backend @ ", wsUrl);

  const ws = new WebSocket(wsUrl);
  wsRef.current = ws;

  // The last diagnosis the backend actually sent, kept so a close frame that
  // arrives empty or truncated cannot downgrade it to the generic message.
  let lastServerError: string | null = null;

  ws.addEventListener("open", () => {
    ws.send(JSON.stringify(params));
  });

  ws.addEventListener("message", async (event: MessageEvent) => {
    const response = JSON.parse(event.data) as WebSocketResponse;
    if (response.type === "chunk") {
      callbacks.onChange(response.value || "", response.variantIndex);
    } else if (response.type === "status") {
      callbacks.onStatusUpdate(response.value || "", response.variantIndex);
    } else if (response.type === "setCode") {
      callbacks.onSetCode(response.value || "", response.variantIndex);
    } else if (response.type === "variantComplete") {
      callbacks.onVariantComplete(response.variantIndex);
    } else if (response.type === "variantError") {
      callbacks.onVariantError(response.variantIndex, response.value || "");
    } else if (response.type === "variantCount") {
      callbacks.onVariantCount(parseInt(response.value || "1"));
    } else if (response.type === "variantModels") {
      // The backend drops picks it cannot run (no key, retired model) and says
      // so here, so a silently shorter option list always has an explanation.
      const notice =
        typeof response.data?.notice === "string"
          ? response.data.notice
          : undefined;
      callbacks.onVariantModels(response.data?.models || [], notice);
      if (notice) toast(notice);
    } else if (response.type === "thinking") {
      callbacks.onThinking(response.value || "", response.variantIndex, response.eventId);
    } else if (response.type === "assistant") {
      callbacks.onAssistant(response.value || "", response.variantIndex, response.eventId);
    } else if (response.type === "toolStart") {
      callbacks.onToolStart(response.data, response.variantIndex, response.eventId);
    } else if (response.type === "toolResult") {
      callbacks.onToolResult(response.data, response.variantIndex, response.eventId);
    } else if (response.type === "error") {
      console.error("Error generating code", response.value);
      if (response.value) lastServerError = response.value;
      toast.error(response.value || ERROR_MESSAGE);
    }
  });

  ws.addEventListener("close", (event) => {
    console.log("Connection closed", event.code, event.reason);
    if (event.code === USER_CLOSE_WEB_SOCKET_CODE) {
      toast.success(CANCEL_MESSAGE);
      callbacks.onCancel("user_cancelled");
    } else if (event.code === APP_ERROR_WEB_SOCKET_CODE) {
      console.error("Known server error", event);
      callbacks.onCancel(
        "request_failed",
        resolveGenerationError(event.reason, lastServerError)
      );
    } else if (event.code !== 1000) {
      console.error("Unknown server or connection error", event);
      // A specific diagnosis was already toasted; repeating the generic line
      // would bury it under advice the user cannot act on.
      if (!lastServerError) toast.error(ERROR_MESSAGE);
      callbacks.onCancel(
        "connection_error",
        resolveGenerationError(event.reason, lastServerError)
      );
    } else {
      callbacks.onComplete();
    }
  });

  ws.addEventListener("error", (error) => {
    console.error("WebSocket error", error);
    if (!lastServerError) toast.error(ERROR_MESSAGE);
  });
}
