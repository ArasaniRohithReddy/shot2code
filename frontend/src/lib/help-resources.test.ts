import {
  getHelpLinks,
  HELP_ALLOWED_HOSTS,
  HELP_CONTEXTUAL_SHORTCUTS,
  HELP_DOCS_BASE_URL,
  HELP_GET_STARTED_STEPS,
  HELP_ISSUES_URL,
  HELP_NEW_ISSUE_URL,
  HELP_PRODUCT_PAGE_URL,
  HELP_RELEASES_PAGE_URL,
  HELP_SECTIONS,
  HELP_SOURCE_REPOSITORY_URL,
  isTrustedHelpUrl,
} from "./help-resources";

/**
 * The documents the Help centre promises to link. Spelled out here so removing
 * one from the catalogue fails a test instead of quietly shrinking Help.
 */
const REQUIRED_DOCUMENTS = [
  "INSTALL.md",
  "USER-GUIDE.md",
  "FAQ.md",
  "TROUBLESHOOTING.md",
  "ARCHITECTURE.md",
  "DATA-HANDLING.md",
  "SECURITY.md",
  "CHANGELOG.md",
  "RELEASING.md",
  "CONTRIBUTING.md",
];

describe("help resource catalogue", () => {
  const links = getHelpLinks();

  it("offers Get started, Guides and Support", () => {
    expect(HELP_SECTIONS.map((section) => section.id)).toEqual([
      "get-started",
      "guides",
      "support",
    ]);
    for (const section of HELP_SECTIONS) {
      expect(section.label.length).toBeGreaterThan(0);
      expect(section.intro.length).toBeGreaterThan(0);
      expect(section.links.length).toBeGreaterThan(0);
    }
  });

  it("links every published document exactly once", () => {
    for (const file of REQUIRED_DOCUMENTS) {
      const matches = links.filter(
        (link) => link.href === `${HELP_DOCS_BASE_URL}${file}`
      );
      expect(matches).toHaveLength(1);
    }
  });

  it("links the product page, the full release list, support and the source", () => {
    const hrefs = links.map((link) => link.href);

    expect(hrefs).toContain(HELP_PRODUCT_PAGE_URL);
    expect(hrefs).toContain(HELP_RELEASES_PAGE_URL);
    expect(hrefs).toContain(HELP_NEW_ISSUE_URL);
    expect(hrefs).toContain(HELP_ISSUES_URL);
    expect(hrefs).toContain(HELP_SOURCE_REPOSITORY_URL);
  });

  it("keeps the documented URL shapes", () => {
    expect(HELP_PRODUCT_PAGE_URL).toBe(
      "https://arasanirohithreddy.github.io/app-releases/shot2code/"
    );
    expect(HELP_RELEASES_PAGE_URL).toBe(
      "https://arasanirohithreddy.github.io/app-releases/shot2code/releases/"
    );
    expect(HELP_DOCS_BASE_URL).toBe(
      "https://github.com/ArasaniRohithReddy/app-releases/blob/main/products/shot2code/"
    );
  });

  it("points only at https URLs on hosts we publish", () => {
    for (const link of links) {
      expect(isTrustedHelpUrl(link.href)).toBe(true);
      expect(HELP_ALLOWED_HOSTS).toContain(new URL(link.href).hostname);
    }
  });

  it("rejects anything that is not one of our https pages", () => {
    for (const href of [
      "http://github.com/ArasaniRohithReddy/app-releases",
      "https://example.com/app-releases",
      "javascript:alert(1)",
      "file:///etc/passwd",
      "not a url",
      "",
    ]) {
      expect(isTrustedHelpUrl(href)).toBe(false);
    }
  });

  it("keeps ids and destinations unique so rows cannot collide", () => {
    expect(new Set(links.map((link) => link.id)).size).toBe(links.length);
    expect(new Set(links.map((link) => link.href)).size).toBe(links.length);
  });

  it("describes every link, so a row is never a bare URL", () => {
    for (const link of links) {
      expect(link.title.trim().length).toBeGreaterThan(0);
      expect(link.description.trim().length).toBeGreaterThan(10);
    }
  });

  it("walks a new user from a model to an export", () => {
    expect(HELP_GET_STARTED_STEPS.length).toBeGreaterThanOrEqual(3);
    expect(new Set(HELP_GET_STARTED_STEPS.map((step) => step.id)).size).toBe(
      HELP_GET_STARTED_STEPS.length
    );
    const joined = HELP_GET_STARTED_STEPS.map((step) => step.detail).join(" ");
    expect(joined).toContain("Settings");
    expect(joined).toContain("Code tab");
  });

  it("documents the focus-scoped keys that are not app shortcuts", () => {
    const ids = HELP_CONTEXTUAL_SHORTCUTS.map((shortcut) => shortcut.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain("resize-step");
    expect(ids).toContain("resize-reset");
    for (const shortcut of HELP_CONTEXTUAL_SHORTCUTS) {
      expect(shortcut.keys.length).toBeGreaterThan(0);
      expect(shortcut.label.trim().length).toBeGreaterThan(0);
    }
  });
});
