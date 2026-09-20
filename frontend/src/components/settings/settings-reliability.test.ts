import * as fs from "node:fs";
import * as path from "node:path";

const SETTINGS_SOURCE = fs.readFileSync(
  path.join(process.cwd(), "src", "components", "settings", "SettingsTab.tsx"),
  "utf8"
);

/**
 * SettingsTab owns too much I/O to mount in this repo's DOM-free harness, so
 * its wiring is asserted against the source the way `settings-layout.test.ts`
 * already does. The behaviour of each piece is covered by the component and
 * library suites; what matters here is that they are actually connected.
 */
function elementFor(id: string): string {
  const anchor = SETTINGS_SOURCE.indexOf(`id="${id}"`);
  expect(anchor).toBeGreaterThan(-1);
  const start = SETTINGS_SOURCE.lastIndexOf("<Input", anchor);
  const end = SETTINGS_SOURCE.indexOf("/>", anchor);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(anchor);
  return SETTINGS_SOURCE.slice(start, end);
}

describe("native provider key fields", () => {
  const ids = [
    "openai-api-key",
    "anthropic-api-key",
    "gemini-api-key",
    "replicate-api-key",
  ];

  it.each(ids)("masks %s and keeps it out of autofill", (id) => {
    const element = elementFor(id);
    expect(element).toContain('type="password"');
    expect(element).toContain('autoComplete="off"');
    expect(element).toContain("spellCheck={false}");
  });

  it("leaves the OpenAI base URL readable — it is not a secret", () => {
    const element = elementFor("openai-base-url");
    expect(element).not.toContain('type="password"');
  });

  it("keeps the existing Copilot token field masked", () => {
    expect(elementFor("copilot-github-token")).toContain('type="password"');
  });
});

describe("provider reliability wiring", () => {
  it("mounts the connection checks with the catalog and current selection", () => {
    expect(SETTINGS_SOURCE).toContain("<ProviderConnectionChecks");
    expect(SETTINGS_SOURCE).toContain("settings={settings}");
    expect(SETTINGS_SOURCE).toContain("catalog={catalog}");
    expect(SETTINGS_SOURCE).toContain("selectedModels={selectedModels}");
  });

  it("offers browser sign-in only when Copilot reports nobody signed in", () => {
    const branch = SETTINGS_SOURCE.slice(
      SETTINGS_SOURCE.indexOf("copilotAvailable === false"),
      SETTINGS_SOURCE.indexOf("GitHub token (optional)")
    );
    expect(branch).toContain("<CopilotSignIn");
    expect(branch).toContain("onSignedIn={refreshModelCatalog}");
    // The existing ladder survives beside it.
    expect(branch).toContain("gh auth login");
    expect(branch).toContain("copilot");
    expect(branch).toContain("paste a token below");
  });

  it("keeps the optional token field after adding sign-in", () => {
    expect(SETTINGS_SOURCE).toContain("GitHub token (optional)");
    expect(SETTINGS_SOURCE).toContain("copilotGithubToken");
  });
});

describe("the screenshot preview warning", () => {
  it("re-probes capabilities with refresh=true", () => {
    expect(SETTINGS_SOURCE).toContain(
      "`${HTTP_BACKEND_URL}/api/capabilities?refresh=true`"
    );
    expect(SETTINGS_SOURCE).toContain("recheckCapabilities");
    expect(SETTINGS_SOURCE).toContain(
      'data-testid="screenshot-preview-recheck"'
    );
    expect(SETTINGS_SOURCE).toContain("Check again");
  });

  it("takes its wording from the runtime rather than hard-coding a command", () => {
    expect(SETTINGS_SOURCE).toContain("describePreviewRemediation");
    expect(SETTINGS_SOURCE).toContain("isPackagedDesktopRuntime()");
    expect(SETTINGS_SOURCE).toContain("previewHelp.command");
    expect(SETTINGS_SOURCE).toContain("previewHelp.followUp");

    // The old unconditional instruction must be gone: it is wrong in the
    // packaged app, which bundles its own browser.
    expect(SETTINGS_SOURCE).not.toContain("playwright install chromium</code>");
    expect(SETTINGS_SOURCE).not.toMatch(
      /Install it with\{" "\}\s*<code/
    );
  });

  it("offers the diagnostic log only when the runtime says to", () => {
    expect(SETTINGS_SOURCE).toContain("previewHelp.showLogAction");
    expect(SETTINGS_SOURCE).toContain(
      'data-testid="screenshot-preview-open-logs"'
    );
    expect(SETTINGS_SOURCE).toContain("openLogs()");
  });
});
