import { renderToStaticMarkup } from "react-dom/server";
import { HelpCenterPanels } from "./HelpCenterDialog";
import {
  getHelpLinks,
  HELP_DOCS_BASE_URL,
  HELP_NEW_ISSUE_URL,
  HELP_PRODUCT_PAGE_URL,
  HELP_RELEASES_PAGE_URL,
  HELP_SECTIONS,
  HELP_SOURCE_REPOSITORY_URL,
} from "../../lib/help-resources";

function render(
  props: Partial<Parameters<typeof HelpCenterPanels>[0]> = {}
) {
  return renderToStaticMarkup(<HelpCenterPanels {...props} />);
}

describe("Help centre panels", () => {
  it("exposes four tabs, starting on Get started", () => {
    const html = render();

    expect(html).toContain('role="tablist"');
    expect(html).toContain('data-testid="help-tab-get-started"');
    expect(html).toContain('data-testid="help-tab-guides"');
    expect(html).toContain('data-testid="help-tab-support"');
    expect(html).toContain('data-testid="help-tab-shortcuts"');
    expect(html).toContain("Get started");
    expect(html).toContain("Keyboard shortcuts");
    expect(html.match(/role="tab"/g)).toHaveLength(4);
  });

  it("keeps every tab a 44px target", () => {
    const html = render();
    const triggers = html.match(/role="tab"[^>]*/g) ?? [];

    expect(triggers).toHaveLength(4);
    for (const trigger of triggers) {
      expect(trigger).toMatch(/\bmin-h-11\b/);
    }
  });

  it("walks a new user through setup on the first tab", () => {
    const html = render({ initialTab: "get-started" });

    expect(html).toContain("Connect a model");
    expect(html).toContain("Iterate in Chat");
    expect(html).toContain(`href="${HELP_PRODUCT_PAGE_URL}"`);
    expect(html).toContain(`href="${HELP_DOCS_BASE_URL}INSTALL.md"`);
    expect(html).toContain(`href="${HELP_DOCS_BASE_URL}USER-GUIDE.md"`);
    expect(html).toContain(`href="${HELP_RELEASES_PAGE_URL}"`);
  });

  it("lists the published guides on the Guides tab", () => {
    const html = render({ initialTab: "guides" });

    for (const file of [
      "ARCHITECTURE.md",
      "DATA-HANDLING.md",
      "SECURITY.md",
      "CHANGELOG.md",
      "RELEASING.md",
      "CONTRIBUTING.md",
    ]) {
      expect(html).toContain(`href="${HELP_DOCS_BASE_URL}${file}"`);
    }
  });

  it("routes support to the FAQ, troubleshooting, issues and the source", () => {
    const html = render({ initialTab: "support" });

    expect(html).toContain(`href="${HELP_DOCS_BASE_URL}FAQ.md"`);
    expect(html).toContain(`href="${HELP_DOCS_BASE_URL}TROUBLESHOOTING.md"`);
    expect(html).toContain(`href="${HELP_NEW_ISSUE_URL}"`);
    expect(html).toContain(`href="${HELP_SOURCE_REPOSITORY_URL}"`);
  });

  it("marks every external link so it is never a surprise", () => {
    for (const section of HELP_SECTIONS) {
      const html = render({ initialTab: section.id });
      for (const link of section.links) {
        const start = html.indexOf(`href="${link.href}"`);
        expect(start).toBeGreaterThan(-1);
        const row = html.slice(start, html.indexOf("</a>", start));

        expect(html).toContain(`data-testid="help-link-${link.id}"`);
        expect(row).toContain('target="_blank"');
        expect(row).toContain('rel="noreferrer"');
        expect(row).toContain("(opens in your browser)");
        expect(row).toContain(link.description);
      }
    }
    expect(getHelpLinks().length).toBeGreaterThan(10);
  });

  it("keeps link rows flat - no card inside a card", () => {
    const html = render({ initialTab: "guides" });
    const rows = html.match(/<a [^>]*data-testid="help-link-[^"]*"[^>]*/g) ?? [];

    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row).toMatch(/\bmin-h-11\b/);
      expect(row).not.toMatch(/\bborder\b/);
      expect(row).not.toMatch(/\bshadow\b/);
    }
  });

  it("disables the log action honestly when no desktop bridge is present", () => {
    const html = render({ initialTab: "support" });

    expect(html).toContain('data-testid="open-diagnostic-logs"');
    expect(html).toContain('aria-disabled="true"');
    expect(html).toContain("disabled=\"\"");
    expect(html).toContain("Only the desktop app writes a log file");
  });

  it("enables the log action when the desktop bridge is available", () => {
    const html = render({
      initialTab: "support",
      openDiagnosticLogs: async () => "",
    });

    expect(html).toContain('data-testid="open-diagnostic-logs"');
    expect(html).toContain('aria-disabled="false"');
    expect(html).not.toContain("Only the desktop app writes a log file");
    expect(html).toContain("Attach it to a bug report");
  });

  it("keeps every shortcut inside Help", () => {
    const html = render({ initialTab: "shortcuts" });

    expect(html).toContain("New project");
    expect(html).toContain("Export project");
    expect(html).toContain("Show History");
    expect(html).toContain("Open Help");
    // The pane dividers are focus-scoped rather than application shortcuts,
    // but a user looking for keys should still find them here.
    expect(html).toContain("Move a workspace divider");
    expect(html).toContain("Restore the default width");
    expect(html).toContain("Indent in the code editor");
  });
});
