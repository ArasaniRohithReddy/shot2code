import {
  PLAYWRIGHT_INSTALL_COMMAND,
  describePreviewRemediation,
  previewRuntimeOf,
} from "./screenshot-preview-help";

describe("screenshot preview remediation", () => {
  it("gives the source checkout the exact uv command and a restart", () => {
    const help = describePreviewRemediation(false);

    expect(help.runtime).toBe("source");
    expect(help.command).toBe(
      "cd backend && uv run playwright install chromium-headless-shell"
    );
    expect(help.command).toBe(PLAYWRIGHT_INSTALL_COMMAND);
    expect(help.followUp).toContain("Restart the backend");
    expect(help.followUp).toContain("Check again");
    expect(help.showLogAction).toBe(false);
  });

  it("never tells a packaged desktop user to install Playwright", () => {
    const help = describePreviewRemediation(true);

    expect(help.runtime).toBe("packaged");
    expect(help.command).toBeNull();

    const everything = `${help.title} ${help.body} ${help.followUp}`;
    expect(everything).not.toMatch(/playwright/i);
    expect(everything).not.toMatch(/\buv\b/);
    expect(everything).not.toMatch(/cd backend/i);
    expect(everything).not.toMatch(/pip|npm install/i);
  });

  it("tells the packaged app it is bundled, and offers restart plus the log", () => {
    const help = describePreviewRemediation(true);

    expect(help.body).toContain("ships with its own headless browser");
    expect(help.body).toContain("Nothing needs to be installed");
    expect(help.followUp).toContain("Restart shot2code");
    expect(help.followUp).toContain("reinstall");
    expect(help.followUp).toContain("diagnostic log");
    expect(help.showLogAction).toBe(true);
  });

  it("maps the runtime flag both ways", () => {
    expect(previewRuntimeOf(true)).toBe("packaged");
    expect(previewRuntimeOf(false)).toBe("source");
  });

  it("keeps the same headline so the card does not jump between runtimes", () => {
    expect(describePreviewRemediation(true).title).toBe(
      describePreviewRemediation(false).title
    );
  });
});
