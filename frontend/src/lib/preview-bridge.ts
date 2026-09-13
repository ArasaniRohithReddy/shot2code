export const PREVIEW_BRIDGE_CHANNEL = "shot2code-preview-v1";

export const PREVIEW_SANDBOX =
  "allow-scripts allow-forms allow-modals allow-downloads";

const MAX_SELECTION_HTML_LENGTH = 12_000;
const MAX_SELECTION_CONTEXT_LENGTH = 8_000;

export interface PreviewSelectionPayload {
  tagName: string;
  outerHTML: string;
  context: string;
}

export interface PreviewSelection extends PreviewSelectionPayload {
  previewId: string;
}

export type PreviewToHostMessage =
  | {
      channel: typeof PREVIEW_BRIDGE_CHANNEL;
      nonce: string;
      type: "ready";
    }
  | {
      channel: typeof PREVIEW_BRIDGE_CHANNEL;
      nonce: string;
      type: "selection";
      payload: PreviewSelectionPayload;
    }
  | {
      channel: typeof PREVIEW_BRIDGE_CHANNEL;
      nonce: string;
      type: "exit-select-mode";
    };

export type PreviewHostMessage =
  | {
      channel: typeof PREVIEW_BRIDGE_CHANNEL;
      nonce: string;
      type: "set-select-mode";
      payload: { enabled: boolean };
    }
  | {
      channel: typeof PREVIEW_BRIDGE_CHANNEL;
      nonce: string;
      type: "clear-selection";
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isValidTagName(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 64 &&
    /^[A-Z][A-Z0-9-]*$/.test(value)
  );
}

export function parsePreviewToHostMessage(
  value: unknown,
  expectedNonce: string
): PreviewToHostMessage | null {
  if (!isRecord(value)) return null;
  if (
    value.channel !== PREVIEW_BRIDGE_CHANNEL ||
    value.nonce !== expectedNonce ||
    typeof value.type !== "string"
  ) {
    return null;
  }

  if (value.type === "ready" || value.type === "exit-select-mode") {
    return {
      channel: PREVIEW_BRIDGE_CHANNEL,
      nonce: expectedNonce,
      type: value.type,
    };
  }

  if (value.type !== "selection" || !isRecord(value.payload)) return null;
  const { tagName, outerHTML, context } = value.payload;
  if (
    !isValidTagName(tagName) ||
    typeof outerHTML !== "string" ||
    outerHTML.length === 0 ||
    outerHTML.length > MAX_SELECTION_HTML_LENGTH ||
    typeof context !== "string" ||
    context.length > MAX_SELECTION_CONTEXT_LENGTH
  ) {
    return null;
  }

  return {
    channel: PREVIEW_BRIDGE_CHANNEL,
    nonce: expectedNonce,
    type: "selection",
    payload: { tagName, outerHTML, context },
  };
}

export function createPreviewHostMessage(
  nonce: string,
  enabled: boolean
): PreviewHostMessage {
  return {
    channel: PREVIEW_BRIDGE_CHANNEL,
    nonce,
    type: "set-select-mode",
    payload: { enabled },
  };
}

export function createClearPreviewSelectionMessage(
  nonce: string
): PreviewHostMessage {
  return {
    channel: PREVIEW_BRIDGE_CHANNEL,
    nonce,
    type: "clear-selection",
  };
}

function ensureHtmlDocument(content: string): string {
  if (!content.trim()) {
    return "<!doctype html><html><head></head><body></body></html>";
  }
  if (/<!doctype|<html(?:\s|>)/i.test(content)) return content;
  return `<!doctype html><html><head><meta charset="utf-8"></head><body>${content}</body></html>`;
}

function removeExistingCsp(html: string): string {
  return html.replace(
    /<meta\b(?=[^>]*\bhttp-equiv\s*=\s*(?:"content-security-policy"|'content-security-policy'|content-security-policy))[^>]*>/gi,
    ""
  );
}

function nonceScripts(html: string, nonce: string): string {
  return html.replace(/<script\b([^>]*)>/gi, (_tag, rawAttributes: string) => {
    const attributes = rawAttributes
      .replace(
        /(?:^|\s)nonce\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/i,
        ""
      )
      .trim();
    return `<script${attributes ? ` ${attributes}` : ""} nonce="${nonce}">`;
  });
}

function buildPreviewBridgeScript(nonce: string): string {
  return `(() => {
  "use strict";
  const channel = ${JSON.stringify(PREVIEW_BRIDGE_CHANNEL)};
  const nonce = ${JSON.stringify(nonce)};
  const hoverId = "__s2c-hover-overlay";
  const selectionId = "__s2c-selection-overlay";
  const cursorId = "__s2c-select-cursor";
  const maxHtmlLength = ${MAX_SELECTION_HTML_LENGTH};
  const maxContextLength = ${MAX_SELECTION_CONTEXT_LENGTH};
  let enabled = false;
  let hovered = null;
  let selected = null;

  const isRecord = (value) =>
    typeof value === "object" && value !== null && !Array.isArray(value);
  const createMemoryStorage = () => {
    const values = new Map();
    return {
      get length() { return values.size; },
      clear: () => values.clear(),
      getItem: (key) => values.has(String(key)) ? values.get(String(key)) : null,
      key: (index) => Array.from(values.keys())[index] ?? null,
      removeItem: (key) => values.delete(String(key)),
      setItem: (key, value) => values.set(String(key), String(value)),
    };
  };
  for (const storageName of ["localStorage", "sessionStorage"]) {
    try {
      void window[storageName];
    } catch {
      try {
        Object.defineProperty(window, storageName, {
          configurable: true,
          value: createMemoryStorage(),
        });
      } catch {
        // Storage remains unavailable, but the preview bridge still works.
      }
    }
  }
  const post = (type, payload) => {
    const message = { channel, nonce, type };
    if (payload !== undefined) message.payload = payload;
    window.parent.postMessage(message, "*");
  };
  const truncate = (value, limit) =>
    value.length <= limit
      ? value
      : value.slice(0, limit) + "\\n<!-- truncated by shot2code preview -->";
  const describeNode = (element) => {
    const tag = element.tagName.toLowerCase();
    const classes = (element.getAttribute("class") || "")
      .split(/\\s+/)
      .filter(Boolean)
      .slice(0, 3);
    return tag + classes.map((className) => "." + className).join("");
  };
  const describeContext = (element) => {
    const parts = [];
    let current = element;
    while (current && parts.length < 6) {
      if (current.tagName.toLowerCase() === "html") break;
      parts.unshift(describeNode(current));
      current = current.parentElement;
    }
    const lines = ["Element location: " + parts.join(" > ")];
    const identical = Array.from(
      element.ownerDocument.getElementsByTagName(element.tagName)
    ).filter((candidate) => candidate.outerHTML === element.outerHTML);
    if (identical.length > 1) {
      const position = identical.indexOf(element) + 1;
      lines.push(
        identical.length +
          " elements on the page share this exact markup; the user selected number " +
          position +
          " of " +
          identical.length +
          " in document order. Edit only that one and leave the other copies exactly as they are. Because the markup repeats, do not locate the element by its own markup alone - anchor the edit with unique surrounding context."
      );
    }
    return truncate(lines.join("\\n"), maxContextLength);
  };
  const ensureOverlay = (kind) => {
    const id = kind === "selection" ? selectionId : hoverId;
    let overlay = document.getElementById(id);
    if (overlay) return overlay;
    overlay = document.createElement("div");
    overlay.id = id;
    overlay.setAttribute("aria-hidden", "true");
    Object.assign(overlay.style, {
      position: "fixed",
      top: "0",
      left: "0",
      width: "0",
      height: "0",
      pointerEvents: "none",
      borderRadius: "4px",
      transition: "none",
      animation: "none",
      display: "none",
      zIndex: kind === "selection" ? "2147483645" : "2147483646",
      border:
        kind === "selection"
          ? "2.5px solid rgb(109, 40, 217)"
          : "1.5px solid rgba(124, 58, 237, 0.95)",
      background:
        kind === "selection"
          ? "rgba(124, 58, 237, 0.16)"
          : "rgba(139, 92, 246, 0.09)",
      boxShadow:
        kind === "selection"
          ? "0 0 0 2px rgba(255, 255, 255, 0.9), 0 2px 12px rgba(109, 40, 217, 0.45)"
          : "0 0 0 3px rgba(139, 92, 246, 0.15)",
    });
    const label = document.createElement("div");
    Object.assign(label.style, {
      position: "absolute",
      left: "-2px",
      padding: "2px 7px",
      color: "#fff",
      font: "600 11px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace",
      borderRadius: "4px",
      whiteSpace: "nowrap",
      boxShadow: "0 1px 4px rgba(0, 0, 0, 0.25)",
      background: kind === "selection" ? "rgb(91, 33, 182)" : "rgb(124, 58, 237)",
    });
    overlay.appendChild(label);
    document.documentElement.appendChild(overlay);
    return overlay;
  };
  const hideOverlay = (kind) => {
    const overlay = document.getElementById(
      kind === "selection" ? selectionId : hoverId
    );
    if (overlay) overlay.style.display = "none";
  };
  const removeOverlay = (kind) => {
    document
      .getElementById(kind === "selection" ? selectionId : hoverId)
      ?.remove();
  };
  const showOverlay = (element, kind) => {
    if (
      !element ||
      !element.isConnected ||
      element === document.documentElement ||
      element.id === hoverId ||
      element.id === selectionId
    ) {
      return;
    }
    const overlay = ensureOverlay(kind);
    const rect = element.getBoundingClientRect();
    const inset = kind === "selection" ? 3 : 0;
    overlay.style.display = "block";
    overlay.style.top = rect.top - inset + "px";
    overlay.style.left = rect.left - inset + "px";
    overlay.style.width = rect.width + inset * 2 + "px";
    overlay.style.height = rect.height + inset * 2 + "px";
    const label = overlay.firstElementChild;
    if (label) {
      label.textContent =
        (kind === "selection" ? "✓ " : "") +
        "<" +
        element.tagName.toLowerCase() +
        ">";
      label.style.top = rect.top - inset > 26 ? "-24px" : "3px";
    }
  };
  const applyCursor = () => {
    if (document.getElementById(cursorId)) return;
    const style = document.createElement("style");
    style.id = cursorId;
    style.textContent = "* { cursor: crosshair !important; }";
    (document.head || document.documentElement).appendChild(style);
  };
  const clearSelection = () => {
    selected = null;
    removeOverlay("selection");
  };
  const setMode = (nextEnabled) => {
    enabled = nextEnabled;
    if (enabled) {
      applyCursor();
      return;
    }
    hovered = null;
    selected = null;
    removeOverlay("hover");
    removeOverlay("selection");
    document.getElementById(cursorId)?.remove();
  };
  const suppress = (event) => {
    if (!enabled) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  };

  window.addEventListener("pointerdown", suppress, true);
  window.addEventListener("mousedown", suppress, true);
  window.addEventListener("mouseup", suppress, true);
  window.addEventListener("submit", suppress, true);
  window.addEventListener(
    "click",
    (event) => {
      if (!enabled) return;
      suppress(event);
      const target = event.target;
      if (!(target instanceof Element)) return;
      hovered = null;
      hideOverlay("hover");
      selected = target;
      showOverlay(selected, "selection");
      post("selection", {
        tagName: target.tagName,
        outerHTML: truncate(target.outerHTML, maxHtmlLength),
        context: describeContext(target),
      });
    },
    true
  );
  window.addEventListener(
    "mouseover",
    (event) => {
      if (!enabled) return;
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (selected && (target === selected || selected.contains(target))) {
        hovered = null;
        hideOverlay("hover");
        return;
      }
      hovered = target;
      showOverlay(target, "hover");
    },
    true
  );
  window.addEventListener(
    "mouseout",
    (event) => {
      if (!enabled || event.relatedTarget) return;
      hovered = null;
      hideOverlay("hover");
    },
    true
  );
  const reposition = () => {
    if (!enabled) return;
    if (hovered && hovered.isConnected) showOverlay(hovered, "hover");
    if (selected && selected.isConnected) showOverlay(selected, "selection");
  };
  window.addEventListener("scroll", reposition, true);
  window.addEventListener("resize", reposition);
  window.addEventListener(
    "keydown",
    (event) => {
      if (!enabled || event.key !== "Escape") return;
      suppress(event);
      post("exit-select-mode");
    },
    true
  );
  window.addEventListener("message", (event) => {
    if (event.source !== window.parent || !isRecord(event.data)) return;
    const data = event.data;
    if (data.channel !== channel || data.nonce !== nonce) return;
    if (
      data.type === "set-select-mode" &&
      isRecord(data.payload) &&
      typeof data.payload.enabled === "boolean"
    ) {
      setMode(data.payload.enabled);
      return;
    }
    if (data.type === "clear-selection") {
      clearSelection();
      return;
    }
  });
  post("ready");
})();`;
}

export interface SandboxedPreviewDocument {
  html: string;
  nonce: string;
}

export function createSandboxedPreviewDocument(
  sourceHtml: string,
  nonce: string
): SandboxedPreviewDocument {
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(nonce)) {
    throw new Error("Preview nonce must be a 16-128 character base64url token.");
  }

  const csp = [
    "default-src 'none'",
    "base-uri 'none'",
    "object-src 'none'",
    "manifest-src 'none'",
    `script-src 'nonce-${nonce}' 'unsafe-eval' https: http: data: blob:`,
    `script-src-elem 'nonce-${nonce}' https: http: data: blob:`,
    "script-src-attr 'unsafe-inline'",
    "style-src 'unsafe-inline' https: http: data: blob:",
    "img-src https: http: data: blob:",
    "font-src https: http: data: blob:",
    "media-src https: http: data: blob:",
    "connect-src https: http: ws: wss:",
    "worker-src blob:",
    "frame-src https: http:",
    "form-action 'none'",
  ].join("; ");
  const meta = `<meta http-equiv="Content-Security-Policy" content="${csp}">`;
  const bridge = `<script nonce="${nonce}" data-shot2code-preview-bridge>${buildPreviewBridgeScript(
    nonce
  ).replace(/<\/script/gi, "<\\/script")}</script>`;

  let html = nonceScripts(
    removeExistingCsp(ensureHtmlDocument(sourceHtml)),
    nonce
  );
  const headMatch = html.match(/<head\b[^>]*>/i);
  if (headMatch?.index !== undefined) {
    const insertAt = headMatch.index + headMatch[0].length;
    html = `${html.slice(0, insertAt)}${meta}${bridge}${html.slice(insertAt)}`;
  } else {
    html = html.replace(
      /<html\b[^>]*>/i,
      (tag) => `${tag}<head>${meta}${bridge}</head>`
    );
  }
  return { html, nonce };
}
