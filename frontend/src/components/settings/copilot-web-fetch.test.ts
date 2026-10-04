/**
 * Copilot's built-in `web_fetch`: the UI must say it is off, why, and point
 * at shot2code's bounded canonical replacement.
 *
 * The backend decision lives in `backend/integrations/copilot_sdk.py`
 * (`COPILOT_BUILTIN_WEB_FETCH_SUPPORTED = False`). A user who cannot see that
 * decision experiences it as "the model refuses to open links", so these
 * assertions keep the explanation present, specific and next to the switch it
 * relates to.
 *
 * SettingsTab owns too much I/O to mount in this repo's DOM-free harness, so
 * its copy is asserted against the source the way `settings-reliability.test.ts`
 * already does.
 */

import * as fs from "node:fs";
import * as path from "node:path";

const SETTINGS_SOURCE = fs.readFileSync(
  path.join(process.cwd(), "src", "components", "settings", "SettingsTab.tsx"),
  "utf8"
);

function blockFor(testId: string): string {
  const anchor = SETTINGS_SOURCE.indexOf(`data-testid="${testId}"`);
  expect(anchor).toBeGreaterThan(-1);
  const start = SETTINGS_SOURCE.lastIndexOf("<div", anchor);
  // The disclosure is the last thing in the Copilot card, so the card's
  // closing tag bounds it.
  const end = SETTINGS_SOURCE.indexOf("{/* Image Generation */}", anchor);
  expect(end).toBeGreaterThan(anchor);
  return SETTINGS_SOURCE.slice(start, end);
}

describe("the web_fetch disclosure", () => {
  const block = () => blockFor("copilot-web-fetch-unavailable");

  it("exists, next to the Copilot web-search switch", () => {
    expect(SETTINGS_SOURCE).toContain('data-testid="copilot-web-fetch-unavailable"');
    const fetchAt = SETTINGS_SOURCE.indexOf(
      'data-testid="copilot-web-fetch-unavailable"'
    );
    const switchAt = SETTINGS_SOURCE.indexOf('id="copilot-web-search"');
    expect(switchAt).toBeGreaterThan(-1);
    expect(fetchAt).toBeGreaterThan(switchAt);
  });

  it("names the tool, so the copy is searchable when a user wonders why", () => {
    expect(block()).toContain("web_fetch");
  });

  it("gives the real reason rather than calling it unsupported", () => {
    const text = block();
    expect(text).toContain("straight to the model");
    expect(text).toMatch(/cap that text|capped/);
    expect(text).toContain("untrusted");
  });

  it("points at the supported alternative", () => {
    expect(block()).toContain("Bounded page reading");
    expect(block()).toContain("Web research");
    expect(block()).toContain("caps bytes and text");
  });

  it("states that URL requests during a run are denied", () => {
    expect(block()).toMatch(/denied/);
  });

  it("never claims the tool is merely coming later", () => {
    const text = block().toLowerCase();
    expect(text).not.toContain("coming soon");
    expect(text).not.toContain("not yet supported");
  });
});

describe("the two search paths stay separate", () => {
  it("keeps one switch for Copilot's built-in search", () => {
    expect(SETTINGS_SOURCE).toContain('id="copilot-web-search"');
    expect(SETTINGS_SOURCE).toContain('aria-label="Allow Copilot web search"');
  });

  it("does not couple the fetch disclosure to the search switch state", () => {
    // The disclosure is unconditional: it is true whether or not built-in
    // search is on, and hiding it behind the switch would only surprise the
    // user who left the switch off.
    const block = blockFor("copilot-web-fetch-unavailable");
    expect(block).not.toContain("copilotWebSearchEnabled &&");
  });

  it("still explains that canonical search supersedes the built-in", () => {
    expect(SETTINGS_SOURCE).toContain(
      'data-testid="copilot-web-search-superseded"'
    );
  });
});
