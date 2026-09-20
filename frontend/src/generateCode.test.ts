jest.mock("./config", () => ({
  HTTP_BACKEND_URL: "http://127.0.0.1:7001",
  WS_BACKEND_URL: "ws://127.0.0.1:7001",
}));

jest.mock("react-hot-toast", () => {
  const toast = Object.assign(jest.fn(), {
    error: jest.fn(),
    success: jest.fn(),
  });
  return { __esModule: true, default: toast };
});

import toast from "react-hot-toast";
import {
  GENERIC_GENERATION_ERROR,
  resolveGenerationError,
  generateCode,
} from "./generateCode";
import {
  APP_ERROR_WEB_SOCKET_CODE,
  USER_CLOSE_WEB_SOCKET_CODE,
} from "./constants";
import type { FullGenerationSettings } from "./types";

const ACTIONABLE =
  "No OpenAI API key found. Add one in Settings or set OPENAI_API_KEY in backend/.env.";

describe("resolveGenerationError", () => {
  it("keeps the backend's own close reason", () => {
    expect(resolveGenerationError(ACTIONABLE, null)).toBe(ACTIONABLE);
  });

  it("uses the streamed error when the close frame carries nothing", () => {
    expect(resolveGenerationError("", ACTIONABLE)).toBe(ACTIONABLE);
    expect(resolveGenerationError(undefined, ACTIONABLE)).toBe(ACTIONABLE);
    expect(resolveGenerationError(null, ACTIONABLE)).toBe(ACTIONABLE);
  });

  it("restores the full sentence when the close reason was truncated", () => {
    // Browsers cap a close reason at 123 UTF-8 bytes, so the tail is lost.
    const truncated = ACTIONABLE.slice(0, 60);
    expect(resolveGenerationError(truncated, ACTIONABLE)).toBe(ACTIONABLE);
  });

  it("prefers a close reason that says something different", () => {
    expect(
      resolveGenerationError("The model timed out after 300s.", ACTIONABLE)
    ).toBe("The model timed out after 300s.");
  });

  it("only reaches the generic message when there is no diagnosis at all", () => {
    expect(resolveGenerationError("", null)).toBe(GENERIC_GENERATION_ERROR);
    expect(resolveGenerationError("   ", "   ")).toBe(
      GENERIC_GENERATION_ERROR
    );
  });
});

/* -------------------------------------------------------------------------- */
/* The socket itself                                                           */
/* -------------------------------------------------------------------------- */

interface FakeSocket {
  listeners: Record<string, Array<(event: unknown) => void>>;
  addEventListener: (type: string, handler: (event: unknown) => void) => void;
  send: jest.Mock;
  close: jest.Mock;
  emit: (type: string, event: unknown) => void;
}

function installFakeSocket(): { socket: FakeSocket } {
  const socket: FakeSocket = {
    listeners: {},
    addEventListener(type, handler) {
      (socket.listeners[type] ??= []).push(handler);
    },
    send: jest.fn(),
    close: jest.fn(),
    emit(type, event) {
      for (const handler of socket.listeners[type] ?? []) handler(event);
    },
  };
  (globalThis as unknown as { WebSocket: unknown }).WebSocket = function () {
    return socket;
  } as unknown as typeof WebSocket;
  return { socket };
}

function run() {
  const { socket } = installFakeSocket();
  const callbacks = {
    onChange: jest.fn(),
    onSetCode: jest.fn(),
    onStatusUpdate: jest.fn(),
    onVariantComplete: jest.fn(),
    onVariantError: jest.fn(),
    onVariantCount: jest.fn(),
    onVariantModels: jest.fn(),
    onThinking: jest.fn(),
    onAssistant: jest.fn(),
    onToolStart: jest.fn(),
    onToolResult: jest.fn(),
    onCancel: jest.fn(),
    onComplete: jest.fn(),
  };
  generateCode(
    { current: null },
    {} as FullGenerationSettings,
    callbacks
  );
  return { socket, callbacks };
}

function sendServerError(socket: FakeSocket, value: string) {
  socket.emit("message", {
    data: JSON.stringify({ type: "error", value, variantIndex: 0 }),
  });
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe("a generation that ends in a known server error", () => {
  it("passes the actionable text to onCancel when the close frame is empty", () => {
    const { socket, callbacks } = run();

    sendServerError(socket, ACTIONABLE);
    socket.emit("close", { code: APP_ERROR_WEB_SOCKET_CODE, reason: "" });

    expect(callbacks.onCancel).toHaveBeenCalledWith(
      "request_failed",
      ACTIONABLE
    );
    expect(callbacks.onCancel).not.toHaveBeenCalledWith(
      "request_failed",
      GENERIC_GENERATION_ERROR
    );
  });

  it("restores the untruncated text when the close frame was cut short", () => {
    const { socket, callbacks } = run();

    sendServerError(socket, ACTIONABLE);
    socket.emit("close", {
      code: APP_ERROR_WEB_SOCKET_CODE,
      reason: ACTIONABLE.slice(0, 40),
    });

    expect(callbacks.onCancel).toHaveBeenCalledWith(
      "request_failed",
      ACTIONABLE
    );
  });

  it("keeps the diagnosis through an unexpected disconnect too", () => {
    const { socket, callbacks } = run();

    sendServerError(socket, ACTIONABLE);
    socket.emit("close", { code: 1006, reason: "" });

    expect(callbacks.onCancel).toHaveBeenCalledWith(
      "connection_error",
      ACTIONABLE
    );
  });

  it("does not bury the specific toast under the generic one", () => {
    const { socket } = run();

    sendServerError(socket, ACTIONABLE);
    socket.emit("close", { code: 1006, reason: "" });
    socket.emit("error", {});

    const messages = (toast.error as jest.Mock).mock.calls.map(
      (call) => call[0]
    );
    expect(messages).toContain(ACTIONABLE);
    expect(messages).not.toContain(GENERIC_GENERATION_ERROR);
  });

  it("still shows the generic message when nothing was diagnosed", () => {
    const { socket, callbacks } = run();

    socket.emit("close", { code: 1006, reason: "" });

    expect(toast.error).toHaveBeenCalledWith(GENERIC_GENERATION_ERROR);
    expect(callbacks.onCancel).toHaveBeenCalledWith(
      "connection_error",
      GENERIC_GENERATION_ERROR
    );
  });

  it("leaves per-variant errors and user cancellation untouched", () => {
    const { socket, callbacks } = run();

    socket.emit("message", {
      data: JSON.stringify({
        type: "variantError",
        value: "Variant 2 hit a content filter.",
        variantIndex: 1,
      }),
    });
    expect(callbacks.onVariantError).toHaveBeenCalledWith(
      1,
      "Variant 2 hit a content filter."
    );

    socket.emit("close", { code: USER_CLOSE_WEB_SOCKET_CODE, reason: "" });
    expect(callbacks.onCancel).toHaveBeenCalledWith("user_cancelled");
  });

  it("completes normally on a clean close", () => {
    const { socket, callbacks } = run();
    socket.emit("close", { code: 1000, reason: "" });
    expect(callbacks.onComplete).toHaveBeenCalled();
    expect(callbacks.onCancel).not.toHaveBeenCalled();
  });
});
