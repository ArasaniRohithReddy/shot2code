jest.mock("../../config", () => ({
  HTTP_BACKEND_URL: "http://127.0.0.1:7001",
  WS_BACKEND_URL: "ws://127.0.0.1:7001",
}));

import { renderToStaticMarkup } from "react-dom/server";
import WebSearchSettings from "./WebSearchSettings";
import {
  DEFAULT_WEB_SEARCH_SETTINGS,
  type WebSearchSettings as WebSearchConfig,
} from "../../lib/web-search";

const KEY = "tvly-super-secret-value";

function keyed(overrides: Partial<WebSearchConfig> = {}): WebSearchConfig {
  return {
    enabled: true,
    provider: "tavily",
    accessMode: "api-key",
    apiKey: KEY,
    ...overrides,
  };
}

function render(
  settings: WebSearchConfig = DEFAULT_WEB_SEARCH_SETTINGS,
  copilotBuiltInEnabled = false
) {
  return renderToStaticMarkup(
    <WebSearchSettings
      settings={settings}
      onChange={jest.fn()}
      copilotBuiltInEnabled={copilotBuiltInEnabled}
    />
  );
}

describe("disclosure", () => {
  test("query egress is stated before anything is switched on", () => {
    const markup = render();

    expect(markup).toContain("data-testid=\"web-search-egress\"");
    expect(markup).toContain("leave this device");
    expect(markup).toContain("api.tavily.com/search");
  });

  test("the default state is off", () => {
    const markup = render();

    expect(markup).toContain("data-state=\"unchecked\"");
  });

  test("the provider's own terms are shown, not a promise", () => {
    const markup = render(keyed());

    expect(markup).toContain("1,000 API credits a month");
    expect(markup).toContain("no credit card required");
  });

  test("the allowance is attributed to the provider and marked changeable", () => {
    const markup = render(keyed());

    expect(markup).toContain('data-testid="web-search-allowance-caveat"');
    expect(markup).toContain("set by the provider");
    expect(markup).toContain("can change at any time");
  });

  test("the provider's official pricing page is linked so a claim can be checked", () => {
    expect(render(keyed())).toContain(
      'href="https://docs.tavily.com/documentation/api-credits"'
    );
    expect(render(keyed({ provider: "exa", apiKey: "exa-key" }))).toContain(
      'href="https://exa.ai/docs/admin/pricing"'
    );
  });

  test("nothing is ever described as permanently free", () => {
    for (const settings of [
      DEFAULT_WEB_SEARCH_SETTINGS,
      keyed(),
      keyed({ provider: "exa", apiKey: "exa-key" }),
      keyed({ accessMode: "keyless", apiKey: null }),
    ]) {
      const markup = render(settings).toLowerCase();
      expect(markup).not.toContain("permanently free");
      expect(markup).not.toContain("always free");
      expect(markup).not.toContain("unlimited");
    }
  });

  test("the response and budget limits are visible", () => {
    const markup = render(keyed());

    expect(markup).toContain("5 titles");
    expect(markup).toContain("3 searches");
    expect(markup).toContain("10 per generation");
    expect(markup).toContain("no redirects");
  });
});

describe("credentials", () => {
  test("the key is rendered in a password field, never as text", () => {
    const markup = render(keyed());

    expect(markup).toContain('type="password"');
    // renderToStaticMarkup emits the value attribute, so the check that
    // matters is the input type plus the absence of the key anywhere else.
    const withoutValues = markup.replace(/value="[^"]*"/g, 'value=""');
    expect(withoutValues).not.toContain(KEY);
  });

  test("keyless hides the key field entirely", () => {
    const markup = render(keyed({ accessMode: "keyless", apiKey: null }));

    expect(markup).not.toContain('type="password"');
    expect(markup).toContain("keyless trial");
  });

  test("an enabled provider with no key says what is missing", () => {
    const markup = render(keyed({ apiKey: null }));

    expect(markup).toContain("data-testid=\"web-search-blocked\"");
    expect(markup).toContain("needs an API key");
  });
});

describe("test connection", () => {
  /** True when the test button itself carries `disabled`, order-independently. */
  function testButtonDisabled(markup: string): boolean {
    const button = markup.match(
      /<button[^>]*data-testid="web-search-test"[^>]*>/
    );
    // The Tailwind class list contains `disabled:` variants, so the check has
    // to be for the attribute (`disabled="`), not the bare word.
    return button !== null && button[0].includes('disabled="');
  }

  test("the button is offered and says what it costs", () => {
    const markup = render(keyed());

    expect(markup).toContain("data-testid=\"web-search-test\"");
    expect(markup).toContain("spends one provider credit");
    expect(testButtonDisabled(markup)).toBe(false);
  });

  test("the button is disabled while the configuration cannot search", () => {
    expect(testButtonDisabled(render(keyed({ apiKey: null })))).toBe(true);
    expect(testButtonDisabled(render(DEFAULT_WEB_SEARCH_SETTINGS))).toBe(true);
  });
});

describe("Copilot built-in collision", () => {
  test("a usable configuration warns that the built-in is superseded", () => {
    const markup = render(keyed(), true);

    expect(markup).toContain("data-testid=\"web-search-copilot-collision\"");
    expect(markup).toContain("one search tool per session");
  });

  test("nothing is said when the built-in is off", () => {
    expect(render(keyed(), false)).not.toContain(
      "web-search-copilot-collision"
    );
  });

  test("nothing is said when this card cannot search anyway", () => {
    expect(render(keyed({ apiKey: null }), true)).not.toContain(
      "web-search-copilot-collision"
    );
  });
});

describe("provider choice", () => {
  test("Exa is offered and has no keyless switch", () => {
    const markup = render(keyed({ provider: "exa", apiKey: "exa-key" }));

    expect(markup).toContain("api.exa.ai/search");
    expect(markup).not.toContain("keyless trial");
  });
});
