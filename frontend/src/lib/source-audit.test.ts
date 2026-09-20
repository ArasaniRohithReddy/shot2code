import { auditComposedPreviewSource } from "./source-audit";

const VALID_DOCUMENT = `<!doctype html>
<html lang="en">
  <head>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Account settings</title>
    <style>.content { width: 60rem; max-width: 100%; }</style>
  </head>
  <body>
    <header><nav aria-label="Primary"><a href="/">Home</a></nav></header>
    <main>
      <h1>Account settings</h1>
      <h2>Profile</h2>
      <img src="avatar.png" alt="Riley's profile">
      <label for="display-name">Display name</label>
      <input id="display-name">
      <button type="button"><img src="save.svg" alt="">Save</button>
      <table>
        <caption>Recent sign-ins</caption>
        <tr><th scope="col">Device</th><th scope="col">Date</th></tr>
        <tr><td>Phone</td><td>Today</td></tr>
      </table>
    </main>
  </body>
</html>`;

describe("automated composed-source audit", () => {
  it("returns no findings for a semantically complete static document", () => {
    expect(
      auditComposedPreviewSource({
        html: VALID_DOCUMENT,
        sourcePath: "index.html",
        viewportWidths: [1440, 768, 390],
      })
    ).toEqual([]);
  });

  it("finds every required deterministic rule category", () => {
    const html = `<!doctype html>
<html>
  <head></head>
  <body>
    <header><h2>Dashboard</h2><h4>Details</h4></header>
    <main><main>
      <img src="chart.png">
      <input id="reused" tabindex="2">
      <textarea id="reused"></textarea>
      <button><a href=""></a></button>
      <table><tr><td>42</td></tr></table>
      <div class="w-[900px]">Wide</div>
    </main></main>
  </body>
</html>`;

    const findings = auditComposedPreviewSource({
      html,
      sourcePath: "pages/dashboard.html",
      viewportWidths: [390, 768, 1440],
    });
    const ruleIds = new Set(findings.map((finding) => finding.ruleId));

    expect(ruleIds).toEqual(
      new Set([
        "document-html-lang",
        "document-title",
        "document-viewport",
        "heading-structure",
        "landmark-main",
        "image-alt",
        "form-control-name",
        "interactive-name",
        "duplicate-id",
        "positive-tabindex",
        "nested-interactive",
        "table-caption",
        "table-headers",
        "fixed-width-overflow",
      ])
    );
    expect(
      findings.every(
        (finding) =>
          finding.evidence.length > 0 &&
          finding.guidance.length > 0 &&
          finding.affectedFile === "pages/dashboard.html"
      )
    ).toBe(true);
  });

  it("recognizes native labels, nested labels, and ARIA names", () => {
    const html = VALID_DOCUMENT.replace(
      '<label for="display-name">Display name</label>\n      <input id="display-name">',
      `<label>Display name <input></label>
      <input aria-label="Search">
      <span id="email-label">Email</span><input aria-labelledby="email-label">`
    ).replace(
      '<button type="button"><img src="save.svg" alt="">Save</button>',
      `<button type="button" aria-label="Save"></button>
      <a href="/help" aria-labelledby="help-label"></a><span id="help-label">Help</span>`
    );

    const findings = auditComposedPreviewSource({
      html,
      sourcePath: "index.html",
      viewportWidths: [390],
    });

    expect(
      findings.filter((finding) => finding.ruleId === "form-control-name")
    ).toEqual([]);
    expect(
      findings.filter((finding) => finding.ruleId === "interactive-name")
    ).toEqual([]);
  });

  it("preserves source nesting so invalid interactive markup is visible", () => {
    const findings = auditComposedPreviewSource({
      html: VALID_DOCUMENT.replace(
        '<a href="/">Home</a>',
        '<a href="/"><button type="button">Home</button></a>'
      ),
      sourcePath: "index.html",
      viewportWidths: [390],
    });

    const nested = findings.find(
      (finding) => finding.ruleId === "nested-interactive"
    );
    expect(nested?.severity).toBe("error");
    expect(nested?.evidence).toContain("<button");
    expect(nested?.evidence).toContain("<a");
  });

  it("attributes inlined CSS risks to the originating project file", () => {
    const html = VALID_DOCUMENT.replace(
      '<style>.content { width: 60rem; max-width: 100%; }</style>',
      '<style data-shot2code-path="styles/layout.css">.hero { min-width: 720px; }</style>'
    );
    const findings = auditComposedPreviewSource({
      html,
      sourcePath: "index.html",
      viewportWidths: [390, 1440],
    });

    expect(
      findings.find(
        (finding) => finding.ruleId === "fixed-width-overflow"
      )
    ).toMatchObject({
      affectedFile: "styles/layout.css",
      severity: "warning",
    });
  });

  it("does not flag fixed widths at or below the smallest viewport or fluid-capped widths", () => {
    const html = VALID_DOCUMENT.replace(
      '<style>.content { width: 60rem; max-width: 100%; }</style>',
      `<style>
        .small { width: 320px; }
        .fluid { width: 1200px; max-width: 100%; }
      </style>`
    );
    const findings = auditComposedPreviewSource({
      html,
      sourcePath: "index.html",
      viewportWidths: [390, 768],
    });

    expect(
      findings.filter(
        (finding) => finding.ruleId === "fixed-width-overflow"
      )
    ).toEqual([]);
  });

  it("is deterministic for the same source and viewport set", () => {
    const input = {
      html: "<html><body><img><button></button></body></html>",
      sourcePath: "index.html",
      viewportWidths: [390, 768],
    };

    expect(auditComposedPreviewSource(input)).toEqual(
      auditComposedPreviewSource(input)
    );
  });
});
