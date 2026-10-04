import {
  createClearPreviewSelectionMessage,
  createPreviewHostMessage,
  createRequestPreviewMetricsMessage,
  createSandboxedPreviewDocument,
  parsePreviewToHostMessage,
  PREVIEW_BRIDGE_CHANNEL,
  PREVIEW_SANDBOX,
} from "./preview-bridge";

const NONCE = "preview_nonce_1234567890";

describe("preview sandbox document", () => {
  it("uses an opaque-origin sandbox policy", () => {
    expect(PREVIEW_SANDBOX.split(/\s+/)).toEqual([
      "allow-scripts",
      "allow-forms",
      "allow-modals",
      "allow-downloads",
    ]);
    expect(PREVIEW_SANDBOX).not.toContain("allow-same-origin");
    expect(PREVIEW_SANDBOX).not.toContain("allow-top-navigation");
  });

  it("replaces source CSP, nonces scripts, and installs the bridge first", () => {
    const result = createSandboxedPreviewDocument(
      `<!doctype html><html><head>
        <meta http-equiv="Content-Security-Policy" content="default-src *">
        <script src="https://cdn.example/runtime.js"></script>
      </head><body><script>window.ready = true;</script></body></html>`,
      NONCE
    );

    expect(result.nonce).toBe(NONCE);
    expect(result.html).toContain("default-src 'none'");
    expect(result.html).toContain("form-action 'none'");
    expect(result.html).not.toContain("default-src *");
    expect(result.html.match(new RegExp(`nonce="${NONCE}"`, "g"))).toHaveLength(3);
    expect(result.html.indexOf("data-shot2code-preview-bridge")).toBeLessThan(
      result.html.indexOf("runtime.js")
    );
    expect(result.html).toContain("window.parent.postMessage");
    expect(result.html).toContain("request-runtime-metrics");
    expect(result.html).toContain("runtime-accessible-name");
    expect(result.html).toContain("runtime-keyboard-focus");
    expect(result.html).toContain("runtime-target-size");
    expect(result.html).toContain("runtime-image-load");
    expect(result.html).toContain("maxRuntimeElements = 2500");
    expect(result.html).toContain('href.startsWith("#")');
    expect(result.html).toContain("scrollIntoView");
    expect(result.html).not.toContain("window.parent.document");
  });

  it("rejects invalid nonces before interpolating them into markup", () => {
    expect(() => createSandboxedPreviewDocument("<main />", "bad nonce")).toThrow(
      "Preview nonce"
    );
  });
});

describe("preview message validation", () => {
  const selection = {
    channel: PREVIEW_BRIDGE_CHANNEL,
    nonce: NONCE,
    type: "selection",
    payload: {
      tagName: "BUTTON",
      outerHTML: '<button class="primary">Save</button>',
      context: "Element location: body > button.primary",
    },
  };

  it("accepts a bounded selection with the expected nonce", () => {
    expect(parsePreviewToHostMessage(selection, NONCE)).toEqual(selection);
  });

  test.each([
    ["wrong nonce", { ...selection, nonce: "another_nonce_123456" }],
    ["wrong channel", { ...selection, channel: "other" }],
    ["lowercase tag", { ...selection, payload: { ...selection.payload, tagName: "button" } }],
    ["non-string HTML", { ...selection, payload: { ...selection.payload, outerHTML: 42 } }],
    ["oversized HTML", { ...selection, payload: { ...selection.payload, outerHTML: "x".repeat(12_001) } }],
    ["oversized context", { ...selection, payload: { ...selection.payload, context: "x".repeat(8_001) } }],
  ])("rejects %s", (_label, message) => {
    expect(parsePreviewToHostMessage(message, NONCE)).toBeNull();
  });

  it("creates schema-valid host commands", () => {
    expect(createPreviewHostMessage(NONCE, true)).toEqual({
      channel: PREVIEW_BRIDGE_CHANNEL,
      nonce: NONCE,
      type: "set-select-mode",
      payload: { enabled: true },
    });
    expect(createClearPreviewSelectionMessage(NONCE)).toEqual({
      channel: PREVIEW_BRIDGE_CHANNEL,
      nonce: NONCE,
      type: "clear-selection",
    });
    expect(createRequestPreviewMetricsMessage(NONCE)).toEqual({
      channel: PREVIEW_BRIDGE_CHANNEL,
      nonce: NONCE,
      type: "request-runtime-metrics",
    });
  });

  it("accepts bounded runtime metrics from the expected frame nonce", () => {
    const metrics = {
      channel: PREVIEW_BRIDGE_CHANNEL,
      nonce: NONCE,
      type: "runtime-metrics",
      payload: {
        viewportWidth: 390,
        documentWidth: 642,
        horizontalOverflow: true,
        inspectedElementCount: 24,
        inspectionTruncated: false,
        findingsTruncated: false,
        findings: [
          {
            ruleId: "runtime-horizontal-overflow",
            severity: "warning",
            category: "responsive",
            message: "Rendered content extends beyond this viewport.",
            evidence: "<div.hero> extends 252px beyond the viewport.",
            guidance: "Use fluid sizing and wrapping.",
            sourcePath: "src/Hero.tsx",
          },
        ],
      },
    };

    expect(parsePreviewToHostMessage(metrics, NONCE)).toEqual(metrics);
    expect(
      parsePreviewToHostMessage(
        {
          ...metrics,
          payload: { ...metrics.payload, documentWidth: Number.NaN },
        },
        NONCE
      )
    ).toBeNull();
    expect(
      parsePreviewToHostMessage(
        {
          ...metrics,
          payload: { ...metrics.payload, horizontalOverflow: "yes" },
        },
        NONCE
      )
    ).toBeNull();
    expect(
      parsePreviewToHostMessage(
        {
          ...metrics,
          payload: {
            ...metrics.payload,
            findings: [
              {
                ...metrics.payload.findings[0],
                ruleId: "runtime-arbitrary-code",
              },
            ],
          },
        },
        NONCE
      )
    ).toBeNull();
    expect(
      parsePreviewToHostMessage(
        {
          ...metrics,
          payload: {
            ...metrics.payload,
            findings: Array.from({ length: 33 }, () =>
              metrics.payload.findings[0]
            ),
          },
        },
        NONCE
      )
    ).toBeNull();
    expect(
      parsePreviewToHostMessage(
        {
          ...metrics,
          payload: {
            ...metrics.payload,
            findings: [
              {
                ...metrics.payload.findings[0],
                evidence: "x".repeat(401),
              },
            ],
          },
        },
        NONCE
      )
    ).toBeNull();
  });

  it("keeps legacy overflow-only metrics compatible with an empty finding set", () => {
    expect(
      parsePreviewToHostMessage(
        {
          channel: PREVIEW_BRIDGE_CHANNEL,
          nonce: NONCE,
          type: "runtime-metrics",
          payload: {
            viewportWidth: 768,
            documentWidth: 768,
            horizontalOverflow: false,
          },
        },
        NONCE
      )
    ).toMatchObject({
      payload: {
        inspectedElementCount: 0,
        inspectionTruncated: false,
        findingsTruncated: false,
        findings: [],
      },
    });
  });
});
