import { renderToStaticMarkup } from "react-dom/server";
import IconStrip from "./IconStrip";

const BASE_PROPS = {
  isHistoryOpen: false,
  isSettingsOpen: false,
  showHistory: true,
  showConversation: true,
  onToggleHistory: jest.fn(),
  onToggleConversation: jest.fn(),
  onLogoClick: jest.fn(),
  onNewProject: jest.fn(),
  onOpenHelp: jest.fn(),
  onOpenSettings: jest.fn(),
};

describe("IconStrip conversation control", () => {
  it("exposes a collapse control on desktop widths", () => {
    const html = renderToStaticMarkup(
      <IconStrip
        {...BASE_PROPS}
        canCollapseConversation
        isConversationOpen
      />
    );

    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain('aria-controls="conversation-panel"');
    expect(html).toContain('aria-label="Hide chat panel (Ctrl+3)"');
  });

  it("offers to reopen the panel once it is collapsed", () => {
    const html = renderToStaticMarkup(
      <IconStrip
        {...BASE_PROPS}
        canCollapseConversation
        isConversationOpen={false}
      />
    );

    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('aria-label="Show chat panel (Ctrl+3)"');
  });

  it("stays a plain chat switch below the desktop breakpoint", () => {
    const html = renderToStaticMarkup(
      <IconStrip
        {...BASE_PROPS}
        canCollapseConversation={false}
        isConversationOpen
      />
    );

    expect(html).toContain('aria-label="Chat (Ctrl+3)"');
    expect(html).not.toContain("aria-expanded");
  });

  it("labels the history rail entry as History", () => {
    const html = renderToStaticMarkup(
      <IconStrip
        {...BASE_PROPS}
        canCollapseConversation
        isConversationOpen={false}
      />
    );

    expect(html).toContain('aria-label="History (Ctrl+4)"');
    expect(html).toContain('data-testid="toggle-history"');
    expect(html).not.toContain("Versions");
  });

  it("hides the project controls before a project exists", () => {
    const html = renderToStaticMarkup(
      <IconStrip
        {...BASE_PROPS}
        showConversation={false}
        showHistory={false}
        canCollapseConversation
        isConversationOpen={false}
      />
    );

    expect(html).not.toContain('data-testid="toggle-conversation"');
    expect(html).not.toContain("History (Ctrl+4)");
    expect(html).toContain("Start a new project (Ctrl+Alt+N)");
  });

  it("offers Help rather than a shortcuts-only entry", () => {
    const html = renderToStaticMarkup(
      <IconStrip
        {...BASE_PROPS}
        canCollapseConversation
        isConversationOpen
      />
    );

    expect(html).toContain('data-testid="open-help"');
    expect(html).toContain('aria-label="Help (Ctrl+/)"');
    expect(html).toContain(">Help<");
    expect(html).not.toContain("Shortcuts");
  });
});
