import { buildFeedbackReport } from "./feedback";

describe("feedback report", () => {
  it("builds a prefilled fixed-repository issue without private attachments", () => {
    const report = buildFeedbackReport({
      type: "bug",
      title: "  Preview   is blank ",
      details: "The preview is empty.",
      steps: "Generate a page.",
      expected: "A rendered page.",
      actual: "A blank pane.",
      includeSystemDetails: false,
    });

    expect(report.title).toBe("[shot2code Bug] Preview is blank");
    expect(report.body).toContain("## Steps to reproduce");
    expect(report.body).toContain("No logs, project files");
    expect(report.body).not.toMatch(/history\.sqlite3|api[_ -]?key/i);
    const url = new URL(report.issueUrl);
    expect(url.hostname).toBe("github.com");
    expect(url.pathname).toBe(
      "/ArasaniRohithReddy/app-releases/issues/new"
    );
    expect(url.searchParams.get("title")).toBe(report.title);
    expect(url.searchParams.get("body")).toBe(report.body);
  });

  it("includes bug-only fields only for bug reports", () => {
    const report = buildFeedbackReport({
      type: "feature",
      title: "Add a comparison view",
      details: "Compare two generated variants.",
      steps: "This must not be included.",
      expected: "",
      actual: "",
      includeSystemDetails: true,
    });

    expect(report.body).not.toContain("Steps to reproduce");
    expect(report.body).toContain("version, operating system, and architecture");
  });

  it("bounds the browser fallback while preserving the complete local report", () => {
    const report = buildFeedbackReport({
      type: "feedback",
      title: "Long report",
      details: "A".repeat(10_000),
      steps: "",
      expected: "",
      actual: "",
      includeSystemDetails: false,
    });

    expect(report.body.length).toBeGreaterThan(9_000);
    expect(report.issueUrl.length).toBeLessThan(2_000);
    expect(new URL(report.issueUrl).searchParams.get("body")).toContain(
      "browser-prefilled copy was shortened"
    );
  });
});
