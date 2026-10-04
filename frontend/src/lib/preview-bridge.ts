export const PREVIEW_BRIDGE_CHANNEL = "shot2code-preview-v1";

export const PREVIEW_SANDBOX =
  "allow-scripts allow-forms allow-modals allow-downloads";

const MAX_SELECTION_HTML_LENGTH = 12_000;
const MAX_SELECTION_CONTEXT_LENGTH = 8_000;
const MAX_RUNTIME_FINDINGS = 32;
const MAX_RUNTIME_TEXT_LENGTH = 400;
const MAX_RUNTIME_SOURCE_PATH_LENGTH = 512;

const RUNTIME_RULE_IDS = new Set([
  "runtime-horizontal-overflow",
  "runtime-accessible-name",
  "runtime-keyboard-focus",
  "runtime-target-size",
  "runtime-image-alt",
  "runtime-image-load",
  "runtime-heading-structure",
  "runtime-main-landmark",
]);

export interface PreviewSelectionPayload {
  tagName: string;
  outerHTML: string;
  context: string;
}

export interface PreviewSelection extends PreviewSelectionPayload {
  previewId: string;
}

export type PreviewRuntimeSeverity = "error" | "warning" | "info";
export type PreviewRuntimeCategory =
  | "accessibility"
  | "structure"
  | "responsive";

export interface PreviewRuntimeFinding {
  ruleId: string;
  severity: PreviewRuntimeSeverity;
  category: PreviewRuntimeCategory;
  message: string;
  evidence: string;
  guidance: string;
  sourcePath?: string;
}

export interface PreviewRuntimeMetrics {
  viewportWidth: number;
  documentWidth: number;
  horizontalOverflow: boolean;
  inspectedElementCount: number;
  inspectionTruncated: boolean;
  findingsTruncated: boolean;
  findings: PreviewRuntimeFinding[];
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
    }
  | {
      channel: typeof PREVIEW_BRIDGE_CHANNEL;
      nonce: string;
      type: "runtime-metrics";
      payload: PreviewRuntimeMetrics;
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
    }
  | {
      channel: typeof PREVIEW_BRIDGE_CHANNEL;
      nonce: string;
      type: "request-runtime-metrics";
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

function isBoundedRuntimeText(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_RUNTIME_TEXT_LENGTH
  );
}

function parsePreviewRuntimeFinding(
  value: unknown
): PreviewRuntimeFinding | null {
  if (!isRecord(value)) return null;
  const {
    ruleId,
    severity,
    category,
    message,
    evidence,
    guidance,
    sourcePath,
  } = value;
  if (
    typeof ruleId !== "string" ||
    !RUNTIME_RULE_IDS.has(ruleId) ||
    !["error", "warning", "info"].includes(String(severity)) ||
    !["accessibility", "structure", "responsive"].includes(
      String(category)
    ) ||
    !isBoundedRuntimeText(message) ||
    !isBoundedRuntimeText(evidence) ||
    !isBoundedRuntimeText(guidance) ||
    (sourcePath !== undefined &&
      (typeof sourcePath !== "string" ||
        sourcePath.length === 0 ||
        sourcePath.length > MAX_RUNTIME_SOURCE_PATH_LENGTH))
  ) {
    return null;
  }
  return {
    ruleId,
    severity: severity as PreviewRuntimeSeverity,
    category: category as PreviewRuntimeCategory,
    message,
    evidence,
    guidance,
    ...(typeof sourcePath === "string" ? { sourcePath } : {}),
  };
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

  if (value.type === "runtime-metrics" && isRecord(value.payload)) {
    const {
      viewportWidth,
      documentWidth,
      horizontalOverflow,
      inspectedElementCount = 0,
      inspectionTruncated = false,
      findingsTruncated = false,
      findings: rawFindings = [],
    } = value.payload;
    if (
      typeof viewportWidth !== "number" ||
      !Number.isFinite(viewportWidth) ||
      viewportWidth < 0 ||
      viewportWidth > 100_000 ||
      typeof documentWidth !== "number" ||
      !Number.isFinite(documentWidth) ||
      documentWidth < 0 ||
      documentWidth > 1_000_000 ||
      typeof horizontalOverflow !== "boolean" ||
      typeof inspectedElementCount !== "number" ||
      !Number.isInteger(inspectedElementCount) ||
      inspectedElementCount < 0 ||
      inspectedElementCount > 10_000 ||
      typeof inspectionTruncated !== "boolean" ||
      typeof findingsTruncated !== "boolean" ||
      !Array.isArray(rawFindings) ||
      rawFindings.length > MAX_RUNTIME_FINDINGS
    ) {
      return null;
    }
    const findings = rawFindings.map(parsePreviewRuntimeFinding);
    if (findings.some((finding) => finding === null)) return null;
    return {
      channel: PREVIEW_BRIDGE_CHANNEL,
      nonce: expectedNonce,
      type: "runtime-metrics",
      payload: {
        viewportWidth,
        documentWidth,
        horizontalOverflow,
        inspectedElementCount,
        inspectionTruncated,
        findingsTruncated,
        findings: findings as PreviewRuntimeFinding[],
      },
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

export function createRequestPreviewMetricsMessage(
  nonce: string
): PreviewHostMessage {
  return {
    channel: PREVIEW_BRIDGE_CHANNEL,
    nonce,
    type: "request-runtime-metrics",
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
  const maxRuntimeFindings = ${MAX_RUNTIME_FINDINGS};
  const maxRuntimeTextLength = ${MAX_RUNTIME_TEXT_LENGTH};
  const maxRuntimeSourcePathLength = ${MAX_RUNTIME_SOURCE_PATH_LENGTH};
  const maxRuntimeElements = 2500;
  const minTargetSize = 24;
  const metricsThrottleMs = 250;
  let enabled = false;
  let hovered = null;
  let selected = null;
  let metricsFrame = 0;
  let metricsTimer = 0;
  let metricsEnabled = false;
  let lastMetricsAt = 0;
  let lastMetricsSignature = "";

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
  const normalizeRuntimeText = (value) =>
    String(value || "").replace(/\\s+/g, " ").trim();
  const truncateRuntimeText = (value, limit = maxRuntimeTextLength) => {
    const normalized = normalizeRuntimeText(value);
    return normalized.length <= limit
      ? normalized
      : normalized.slice(0, Math.max(0, limit - 3)) + "...";
  };
  const cleanRuntimeToken = (value) =>
    String(value || "")
      .replace(/[^A-Za-z0-9_-]/g, "_")
      .slice(0, 32);
  const describeRuntimeElement = (element) => {
    const tag = element.tagName.toLowerCase();
    const id = cleanRuntimeToken(element.id);
    const classes = [];
    for (let index = 0; index < Math.min(element.classList.length, 2); index += 1) {
      const className = cleanRuntimeToken(element.classList.item(index));
      if (className) classes.push(className);
    }
    return (
      "<" +
      tag +
      (id ? "#" + id : "") +
      classes.map((className) => "." + className).join("") +
      ">"
    );
  };
  const runtimeSourcePath = (element) => {
    let current = element;
    let depth = 0;
    while (current && depth < 20) {
      const path = current.getAttribute("data-shot2code-path");
      if (path) return truncateRuntimeText(path, maxRuntimeSourcePathLength);
      current = current.parentElement;
      depth += 1;
    }
    return "";
  };
  const isBridgeElement = (element) =>
    element.id === hoverId ||
    element.id === selectionId ||
    element.id === cursorId ||
    Boolean(element.closest("#" + hoverId + ", #" + selectionId));
  const isSemanticallyHidden = (element) => {
    let current = element;
    let depth = 0;
    while (current && depth < 30) {
      if (
        current.hasAttribute("hidden") ||
        current.getAttribute("aria-hidden") === "true"
      ) {
        return true;
      }
      const style = window.getComputedStyle(current);
      if (
        style.display === "none" ||
        style.visibility === "hidden" ||
        style.visibility === "collapse"
      ) {
        return true;
      }
      current = current.parentElement;
      depth += 1;
    }
    return false;
  };
  const renderedRect = (element) => {
    if (isBridgeElement(element) || isSemanticallyHidden(element)) return null;
    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    return rect;
  };
  const boundedElementText = (element) => {
    if (!element) return "";
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    const parts = [];
    let node = walker.nextNode();
    let visited = 0;
    let length = 0;
    while (node && visited < 40 && length < 240) {
      const value = truncateRuntimeText(node.nodeValue || "", 240 - length);
      if (value) {
        parts.push(value);
        length += value.length;
      }
      visited += 1;
      node = walker.nextNode();
    }
    return truncateRuntimeText(parts.join(" "), 240);
  };
  const descendantAlternativeText = (element) => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_ELEMENT);
    const parts = [];
    let candidate = walker.nextNode();
    let visited = 0;
    while (candidate && visited < 100 && parts.length < 4) {
      const tag = candidate.tagName.toLowerCase();
      const type = (candidate.getAttribute("type") || "").toLowerCase();
      if (tag === "img" || (tag === "input" && type === "image")) {
        const alt = normalizeRuntimeText(candidate.getAttribute("alt"));
        if (alt) parts.push(alt);
      }
      visited += 1;
      candidate = walker.nextNode();
    }
    return truncateRuntimeText(parts.join(" "), 240);
  };
  const hasAccessibleName = (element) => {
    if (normalizeRuntimeText(element.getAttribute("aria-label"))) return true;
    const labelledBy = truncateRuntimeText(
      element.getAttribute("aria-labelledby"),
      512
    )
      .split(" ")
      .filter(Boolean);
    if (
      labelledBy
        .slice(0, 8)
        .some((id) => boundedElementText(document.getElementById(id)))
    ) {
      return true;
    }
    if (element.labels) {
      const labelParts = [];
      for (
        let index = 0;
        index < Math.min(element.labels.length, 4);
        index += 1
      ) {
        labelParts.push(boundedElementText(element.labels.item(index)));
      }
      if (normalizeRuntimeText(labelParts.join(" "))) return true;
    }
    if (normalizeRuntimeText(element.getAttribute("title"))) return true;

    const tag = element.tagName.toLowerCase();
    if (tag === "input") {
      const type = (element.getAttribute("type") || "text").toLowerCase();
      if (type === "image") {
        return Boolean(normalizeRuntimeText(element.getAttribute("alt")));
      }
      if (["button", "submit", "reset"].includes(type)) {
        if (normalizeRuntimeText(element.value)) return true;
        return type === "submit" || type === "reset";
      }
      return Boolean(normalizeRuntimeText(element.getAttribute("placeholder")));
    }
    if (["select", "textarea"].includes(tag)) return false;

    if (descendantAlternativeText(element)) return true;

    const role = (element.getAttribute("role") || "").toLowerCase();
    return (
      ["button", "a", "summary"].includes(tag) ||
      [
        "button",
        "link",
        "checkbox",
        "radio",
        "switch",
        "tab",
        "menuitem",
        "option",
      ].includes(role)
    )
      ? Boolean(boundedElementText(element))
      : false;
  };
  const isNativeInteractive = (element) => {
    const tag = element.tagName.toLowerCase();
    if (["button", "select", "textarea", "summary"].includes(tag)) return true;
    if (tag === "a") return element.hasAttribute("href");
    if (tag !== "input") return false;
    return (element.getAttribute("type") || "text").toLowerCase() !== "hidden";
  };
  const interactiveSelector = [
    "button",
    "a[href]",
    "input:not([type='hidden'])",
    "select",
    "textarea",
    "summary",
    "[role='button']",
    "[role='link']",
    "[role='checkbox']",
    "[role='radio']",
    "[role='switch']",
    "[role='tab']",
    "[role='menuitem']",
    "[role='option']",
    "[role='slider']",
    "[role='textbox']",
    "[contenteditable]:not([contenteditable='false'])",
  ].join(",");
  const collectRuntimeMetrics = () => {
    const root = document.documentElement;
    const body = document.body;
    const viewportWidth = Math.max(
      0,
      Math.round(root ? root.clientWidth : window.innerWidth)
    );
    const documentWidth = Math.max(
      viewportWidth,
      Math.ceil(root ? root.scrollWidth : 0),
      Math.ceil(body ? body.scrollWidth : 0)
    );
    const horizontalOverflow = documentWidth > viewportWidth + 1;
    const collectedElements = [];
    const elementWalker = document.createTreeWalker(
      document.documentElement,
      NodeFilter.SHOW_ELEMENT
    );
    let inspectedElement = elementWalker.currentNode;
    while (
      inspectedElement &&
      collectedElements.length <= maxRuntimeElements
    ) {
      collectedElements.push(inspectedElement);
      inspectedElement = elementWalker.nextNode();
    }
    const inspectionTruncated =
      collectedElements.length > maxRuntimeElements;
    const elements = collectedElements.slice(0, maxRuntimeElements);
    const findings = [];
    let findingsTruncated = false;
    const addFinding = ({
      ruleId,
      severity,
      category,
      message,
      evidence,
      guidance,
      element,
    }) => {
      if (findings.length >= maxRuntimeFindings) {
        findingsTruncated = true;
        return;
      }
      const finding = {
        ruleId,
        severity,
        category,
        message: truncateRuntimeText(message),
        evidence: truncateRuntimeText(evidence),
        guidance: truncateRuntimeText(guidance),
      };
      const sourcePath = element ? runtimeSourcePath(element) : "";
      if (sourcePath) finding.sourcePath = sourcePath;
      findings.push(finding);
    };

    if (horizontalOverflow) {
      const overflowCandidates = [];
      for (const element of elements) {
        if (element === root || element === body || isBridgeElement(element)) {
          continue;
        }
        const rect = renderedRect(element);
        if (!rect) continue;
        const leftExcess = Math.max(0, -rect.left);
        const rightExcess = Math.max(0, rect.right - viewportWidth);
        const excess = Math.max(leftExcess, rightExcess);
        if (excess > 1) overflowCandidates.push({ element, rect, excess });
      }
      overflowCandidates
        .sort((left, right) => right.excess - left.excess)
        .slice(0, 4)
        .forEach(({ element, rect, excess }) =>
          addFinding({
            ruleId: "runtime-horizontal-overflow",
            severity: "warning",
            category: "responsive",
            message: "Rendered content extends beyond this viewport.",
            evidence:
              describeRuntimeElement(element) +
              " spans x=" +
              Math.round(rect.left) +
              " to " +
              Math.round(rect.right) +
              " CSS px, " +
              Math.ceil(excess) +
              "px outside a " +
              viewportWidth +
              "px viewport. The document is " +
              documentWidth +
              "px wide.",
            guidance:
              "Use fluid sizing, wrapping, or a scoped scroll container; verify whether a two-dimensional layout exception is genuinely required.",
            element,
          })
        );
      if (overflowCandidates.length === 0) {
        addFinding({
          ruleId: "runtime-horizontal-overflow",
          severity: "warning",
          category: "responsive",
          message: "The rendered document is wider than this viewport.",
          evidence:
            "The document is " +
            documentWidth +
            "px wide in a " +
            viewportWidth +
            "px viewport; no single bounded offender was identified.",
          guidance:
            "Inspect fixed widths, absolute positioning, transforms, and non-wrapping content at this viewport.",
        });
      }
    }

    const interactive = elements.filter(
      (element) =>
        !isBridgeElement(element) && element.matches(interactiveSelector)
    );
    const renderedTargets = [];
    for (const element of interactive) {
      const rect = renderedRect(element);
      if (!rect) continue;
      renderedTargets.push({ element, rect });
      if (!hasAccessibleName(element)) {
        addFinding({
          ruleId: "runtime-accessible-name",
          severity: "error",
          category: "accessibility",
          message: "A rendered interactive control has no detectable accessible name.",
          evidence:
            describeRuntimeElement(element) +
            " has no label, non-empty ARIA name, title, or supported visible/native name in the rendered DOM.",
          guidance:
            "Prefer a native control with visible text or associate an accurate label with aria-label or aria-labelledby only when needed.",
          element,
        });
      }
      const role = (element.getAttribute("role") || "").toLowerCase();
      const disabled =
        element.hasAttribute("disabled") ||
        element.getAttribute("aria-disabled") === "true";
      const managedComposite = element.closest(
        "[role='toolbar'], [role='menu'], [role='tablist'], [role='radiogroup'], [role='listbox'], [role='tree'], [role='grid']"
      );
      if (
        !disabled &&
        !managedComposite &&
        !isNativeInteractive(element) &&
        ["button", "link"].includes(role) &&
        !element.hasAttribute("tabindex") &&
        element.tabIndex < 0
      ) {
        addFinding({
          ruleId: "runtime-keyboard-focus",
          severity: "warning",
          category: "accessibility",
          message: "A custom interactive role is not reachable in the normal tab order.",
          evidence:
            describeRuntimeElement(element) +
            ' uses role="' +
            role +
            '" with tabIndex ' +
            element.tabIndex +
            ".",
          guidance:
            "Use a native button or link when possible; otherwise provide keyboard focus and equivalent Enter/Space behavior.",
          element,
        });
      }
    }

    for (const element of elements) {
      if (element.tagName.toLowerCase() !== "img" || isBridgeElement(element)) {
        continue;
      }
      const rect = renderedRect(element);
      if (!rect) continue;
      if (!element.hasAttribute("alt")) {
        addFinding({
          ruleId: "runtime-image-alt",
          severity: "error",
          category: "accessibility",
          message: "A rendered image has no alt attribute.",
          evidence: describeRuntimeElement(element) + " omits alt in the rendered DOM.",
          guidance:
            'Provide concise alternative text for informative images or alt="" for decorative images.',
          element,
        });
      }
      const requestedSource =
        element.currentSrc || element.getAttribute("src") || "";
      if (requestedSource && element.complete && element.naturalWidth === 0) {
        addFinding({
          ruleId: "runtime-image-load",
          severity: "warning",
          category: "accessibility",
          message: "A rendered image failed to decode or load.",
          evidence:
            describeRuntimeElement(element) +
            " is complete but has a natural width of 0 CSS pixels.",
          guidance:
            "Verify the image URL or local asset, MIME type, and fallback content without relying on the broken image icon.",
          element,
        });
      }
    }

    const headings = elements.filter(
      (element) =>
        /^H[1-6]$/.test(element.tagName) &&
        !isBridgeElement(element) &&
        !isSemanticallyHidden(element)
    );
    if (headings.length === 0) {
      addFinding({
        ruleId: "runtime-heading-structure",
        severity: "warning",
        category: "structure",
        message: "The rendered page has no exposed semantic heading.",
        evidence: "No h1 through h6 is exposed in the inspected rendered DOM.",
        guidance:
          "Use semantic headings that describe each section; do not substitute styled generic elements.",
      });
    } else {
      const firstLevel = Number(headings[0].tagName.slice(1));
      if (firstLevel !== 1) {
        addFinding({
          ruleId: "runtime-heading-structure",
          severity: "warning",
          category: "structure",
          message: "The rendered heading outline does not start with an h1.",
          evidence:
            describeRuntimeElement(headings[0]) +
            " is the first exposed heading and is level " +
            firstLevel +
            ".",
          guidance:
            "Start the page hierarchy with a descriptive h1 and use levels to represent nested sections.",
          element: headings[0],
        });
      }
      for (let index = 1; index < headings.length; index += 1) {
        const previousLevel = Number(headings[index - 1].tagName.slice(1));
        const level = Number(headings[index].tagName.slice(1));
        if (level <= previousLevel + 1) continue;
        addFinding({
          ruleId: "runtime-heading-structure",
          severity: "warning",
          category: "structure",
          message: "The rendered heading outline skips a level.",
          evidence:
            describeRuntimeElement(headings[index]) +
            " is h" +
            level +
            " after h" +
            previousLevel +
            ".",
          guidance:
            "Use heading levels to represent hierarchy without skipping intermediate levels.",
          element: headings[index],
        });
      }
    }

    const mainLandmarks = elements.filter(
      (element) =>
        (element.tagName.toLowerCase() === "main" ||
          (element.getAttribute("role") || "").toLowerCase() === "main") &&
        !isBridgeElement(element) &&
        !isSemanticallyHidden(element)
    );
    if (mainLandmarks.length !== 1) {
      addFinding({
        ruleId: "runtime-main-landmark",
        severity: "warning",
        category: "structure",
        message:
          mainLandmarks.length === 0
            ? "The rendered page has no exposed main landmark."
            : "The rendered page has multiple exposed main landmarks.",
        evidence:
          mainLandmarks.length === 0
            ? "No <main> or role=main is exposed in the inspected rendered DOM."
            : mainLandmarks.length +
              " main landmarks are exposed: " +
              mainLandmarks.slice(0, 4).map(describeRuntimeElement).join(", ") +
              ".",
        guidance:
          "Expose one primary main landmark and keep repeated or nested main landmarks out of the accessibility tree.",
        element: mainLandmarks[1] || mainLandmarks[0],
      });
    }

    for (const { element, rect } of renderedTargets) {
      if (rect.width >= minTargetSize && rect.height >= minTargetSize) continue;
      const style = window.getComputedStyle(element);
      if (
        element.tagName.toLowerCase() === "a" &&
        style.display === "inline"
      ) {
        continue;
      }
      addFinding({
        ruleId: "runtime-target-size",
        severity: "info",
        category: "accessibility",
        message: "A rendered pointer target is smaller than 24 by 24 CSS pixels.",
        evidence:
          describeRuntimeElement(element) +
          " has rendered bounds of " +
          Math.round(rect.width * 10) / 10 +
          " by " +
          Math.round(rect.height * 10) / 10 +
          " CSS pixels. Spacing, inline, equivalent, user-agent, and essential exceptions require manual review.",
        guidance:
          "Increase the target to at least 24 by 24 CSS pixels or verify and document an applicable WCAG 2.5.8 exception and sufficient spacing.",
        element,
      });
    }

    return {
      viewportWidth,
      documentWidth,
      horizontalOverflow,
      inspectedElementCount: elements.length,
      inspectionTruncated,
      findingsTruncated,
      findings,
    };
  };
  const postRuntimeMetrics = () => {
    metricsFrame = 0;
    lastMetricsAt = Date.now();
    const payload = collectRuntimeMetrics();
    const signature = JSON.stringify(payload);
    if (signature === lastMetricsSignature) return;
    lastMetricsSignature = signature;
    post("runtime-metrics", payload);
  };
  const queueRuntimeMetrics = () => {
    if (!metricsEnabled || metricsFrame || metricsTimer) return;
    const wait = Math.max(0, metricsThrottleMs - (Date.now() - lastMetricsAt));
    if (wait > 0) {
      metricsTimer = window.setTimeout(() => {
        metricsTimer = 0;
        queueRuntimeMetrics();
      }, wait);
      return;
    }
    metricsFrame = window.requestAnimationFrame(postRuntimeMetrics);
  };
  const enableRuntimeMetrics = () => {
    if (!metricsEnabled) {
      metricsEnabled = true;
      if (typeof ResizeObserver === "function") {
        const resizeObserver = new ResizeObserver(queueRuntimeMetrics);
        resizeObserver.observe(document.documentElement);
        if (document.body) resizeObserver.observe(document.body);
      }
      if (typeof MutationObserver === "function") {
        const mutationObserver = new MutationObserver(queueRuntimeMetrics);
        mutationObserver.observe(document.documentElement, {
          attributes: true,
          characterData: true,
          childList: true,
          subtree: true,
        });
      }
      window.addEventListener("load", queueRuntimeMetrics, true);
      window.addEventListener("error", queueRuntimeMetrics, true);
    }
    queueRuntimeMetrics();
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

  // A srcdoc document inherits the packaged app's file:// base URL. Without
  // this guard, an ordinary in-page link such as href="#pricing" tries to load
  // renderer/index.html#pricing and Electron reports a blocked local-resource
  // error. Keep fragment navigation entirely inside the preview instead.
  window.addEventListener(
    "click",
    (event) => {
      if (enabled) return;
      const target = event.target;
      if (!(target instanceof Element)) return;
      const anchor = target.closest("a[href]");
      if (!anchor) return;
      const href = anchor.getAttribute("href") || "";
      if (!href.startsWith("#")) return;
      event.preventDefault();
      const rawId = href.slice(1);
      if (!rawId) return;
      let id = rawId;
      try {
        id = decodeURIComponent(rawId);
      } catch {
        // Use the literal fragment when it is not valid percent encoding.
      }
      const escaped =
        typeof CSS !== "undefined" && typeof CSS.escape === "function"
          ? CSS.escape(id)
          : id.replace(/["\\\\]/g, "\\\\$&");
      const destination =
        document.getElementById(id) ||
        document.querySelector('[name="' + escaped + '"]');
      destination?.scrollIntoView({ behavior: "smooth", block: "start" });
    },
    true
  );

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
  window.addEventListener("resize", () => {
    reposition();
    queueRuntimeMetrics();
  });
  window.addEventListener("load", queueRuntimeMetrics);
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
    if (data.type === "request-runtime-metrics") {
      enableRuntimeMetrics();
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
