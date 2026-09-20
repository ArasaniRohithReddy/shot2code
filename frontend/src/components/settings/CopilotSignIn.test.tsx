jest.mock("../../config", () => ({
  HTTP_BACKEND_URL: "http://127.0.0.1:7001",
  WS_BACKEND_URL: "ws://127.0.0.1:7001",
}));

import { renderToStaticMarkup } from "react-dom/server";
import CopilotSignIn from "./CopilotSignIn";
import {
  IDLE_COPILOT_LOGIN,
  type CopilotLoginState,
} from "../../lib/copilot-login";

function state(overrides: Partial<CopilotLoginState> = {}): CopilotLoginState {
  return { ...IDLE_COPILOT_LOGIN, ...overrides };
}

function render(initialState: CopilotLoginState = IDLE_COPILOT_LOGIN) {
  return renderToStaticMarkup(
    <CopilotSignIn onSignedIn={jest.fn()} initialState={initialState} />
  );
}

describe("the idle state", () => {
  it("offers an accessible sign-in action", () => {
    const html = render();

    expect(html).toContain('data-testid="copilot-signin-start"');
    expect(html).toContain("Sign in with GitHub");
    expect(html).toContain('type="button"');
    // 44px minimum target.
    expect(html).toContain("min-h-11");
    expect(html).not.toContain("disabled=\"\"");
  });

  it("says the official CLI stores the credential and shot2code never sees it", () => {
    const html = render();

    expect(html).toContain("official");
    expect(html).toContain("GitHub Copilot CLI");
    expect(html).toContain("in your browser");
    expect(html).toContain(
      "shot2code never receives or saves your token"
    );
  });

  it("shows no progress or cancel control before anything starts", () => {
    const html = render();
    expect(html).not.toContain('data-testid="copilot-signin-progress"');
    expect(html).not.toContain('data-testid="copilot-signin-cancel"');
  });
});

describe("while the flow is live", () => {
  it("reports starting and replaces the button with progress", () => {
    const html = render(state({ status: "starting", canCancel: true }));

    expect(html).toContain('data-testid="copilot-signin-progress"');
    expect(html).toContain("Starting the sign-in flow");
    expect(html).not.toContain('data-testid="copilot-signin-start"');
  });

  it("reports waiting and offers Cancel when the backend allows it", () => {
    const html = render(
      state({
        status: "waiting",
        method: "github-cli",
        canCancel: true,
        message: "Open the code page in your browser to continue.",
      })
    );

    expect(html).toContain("Waiting for you to finish in the browser");
    expect(html).toContain('data-testid="copilot-signin-cancel"');
    expect(html).toContain("Cancel");
    // The named CLI is used in the explanation.
    expect(html).toContain("GitHub CLI");
    expect(html).toContain("Open the code page in your browser to continue.");
  });

  it("hides Cancel when the backend says the flow cannot be cancelled", () => {
    const html = render(state({ status: "waiting", canCancel: false }));
    expect(html).toContain('data-testid="copilot-signin-progress"');
    expect(html).not.toContain('data-testid="copilot-signin-cancel"');
  });

  it("announces status changes politely", () => {
    expect(render(state({ status: "waiting" }))).toContain(
      'aria-live="polite"'
    );
  });
});

describe("terminal states", () => {
  it("never claims success on its own — it only shows the backend's message", () => {
    const html = render(
      state({
        status: "succeeded",
        login: "octocat",
        message: "Signed in as octocat.",
      })
    );

    expect(html).toContain("Signed in as octocat.");
    // The authoritative "Signed in" line lives in the card above and comes
    // from the real capability probe, not from this component.
    expect(html).not.toContain('data-testid="copilot-signin-progress"');
  });

  it("offers a retry after a failure and flags it to assistive tech", () => {
    const html = render(
      state({
        status: "failed",
        message: "The Copilot CLI exited before completing sign-in.",
      })
    );

    expect(html).toContain("Try signing in again");
    expect(html).toContain('role="alert"');
    expect(html).toContain(
      "The Copilot CLI exited before completing sign-in."
    );
  });

  it("offers a retry after a cancellation", () => {
    expect(render(state({ status: "cancelled" }))).toContain(
      "Try signing in again"
    );
  });
});

describe("when browser sign-in is unavailable", () => {
  const unavailable = state({
    status: "unavailable",
    message: "The Copilot CLI is not installed.",
    installUrl: "https://github.com/github/copilot-cli",
  });

  it("shows the backend message and a trusted https install link", () => {
    const html = render(unavailable);

    expect(html).toContain('data-testid="copilot-signin-unavailable"');
    expect(html).toContain("The Copilot CLI is not installed.");
    expect(html).toContain('data-testid="copilot-signin-install-link"');
    expect(html).toContain('href="https://github.com/github/copilot-cli"');
    expect(html).toContain('rel="noreferrer noopener"');
  });

  it("keeps pointing at the existing terminal and token ladder", () => {
    const html = render(unavailable);
    expect(html).toContain("sign in from a terminal");
    expect(html).toContain("paste a token below");
  });

  it("disables the action rather than pretending it can work", () => {
    const html = render(unavailable);
    expect(html).toContain('data-testid="copilot-signin-start"');
    expect(html).toContain('disabled=""');
  });

  it("drops an untrusted install link before it can be rendered", () => {
    const html = render(
      state({ status: "unavailable", installUrl: null })
    );
    expect(html).not.toContain('data-testid="copilot-signin-install-link"');
  });
});

it("never renders a token or credential-looking value", () => {
  const html = render(
    state({
      status: "succeeded",
      login: "octocat",
      message: "Signed in as octocat.",
    })
  );

  expect(html).not.toMatch(/gho_|ghp_|github_pat_/);
  expect(html).not.toMatch(/\btoken=/);
});
