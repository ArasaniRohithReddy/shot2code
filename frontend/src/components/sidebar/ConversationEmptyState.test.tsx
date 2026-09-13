import { renderToStaticMarkup } from "react-dom/server";
import ConversationEmptyState from "./ConversationEmptyState";

describe("ConversationEmptyState", () => {
  it("teaches the panel and offers imported-project openers", () => {
    const html = renderToStaticMarkup(
      <ConversationEmptyState
        variant="imported"
        onUseStarter={jest.fn()}
        onOpenCode={jest.fn()}
      />
    );

    expect(html).toContain("Your project is loaded. What should change?");
    expect(html).toContain("Make the layout responsive");
    expect(html).toContain("Fix accessibility issues");
    expect(html).toContain("Polish spacing and typography");
    expect(html).toContain("Or read the source in Code");
    expect(html).toContain('data-testid="conversation-empty-state"');
  });

  it("switches the openers for a generated first version", () => {
    const html = renderToStaticMarkup(
      <ConversationEmptyState
        variant="generated"
        onUseStarter={jest.fn()}
        onOpenCode={jest.fn()}
      />
    );

    expect(html).toContain("First version is ready. What should change?");
    expect(html).toContain("Match the reference more closely");
    expect(html).not.toContain("Fix accessibility issues");
  });
});
