import { renderToStaticMarkup } from "react-dom/server";
import PaneResizer from "./PaneResizer";
import {
  CHAT_PANE_WIDTH,
  PANE_RESIZE_LARGE_STEP,
  PANE_RESIZE_STEP,
} from "../../lib/pane-sizing";

function render(overrides: Partial<Parameters<typeof PaneResizer>[0]> = {}) {
  return renderToStaticMarkup(
    <PaneResizer
      label="Chat panel width"
      controls="conversation-panel"
      testId="chat-pane-resizer"
      width={CHAT_PANE_WIDTH.default}
      min={CHAT_PANE_WIDTH.min}
      max={CHAT_PANE_WIDTH.max}
      defaultWidth={CHAT_PANE_WIDTH.default}
      onWidthChange={jest.fn()}
      {...overrides}
    />
  );
}

describe("PaneResizer accessibility", () => {
  it("exposes a focusable vertical separator with its range", () => {
    const html = render();

    expect(html).toContain('role="separator"');
    expect(html).toContain('aria-orientation="vertical"');
    expect(html).toContain('tabindex="0"');
    expect(html).toContain(`aria-valuemin="${CHAT_PANE_WIDTH.min}"`);
    expect(html).toContain(`aria-valuemax="${CHAT_PANE_WIDTH.max}"`);
    expect(html).toContain(`aria-valuenow="${CHAT_PANE_WIDTH.default}"`);
    expect(html).toContain(
      `aria-valuetext="Chat panel width: ${CHAT_PANE_WIDTH.default} pixels"`
    );
    expect(html).toContain('aria-label="Chat panel width"');
    expect(html).toContain('aria-controls="conversation-panel"');
  });

  it("reports the width it is actually showing", () => {
    const html = render({ width: 487 });

    expect(html).toContain('aria-valuenow="487"');
    expect(html).toContain('aria-valuetext="Chat panel width: 487 pixels"');
  });

  it("documents the keyboard and reset affordances", () => {
    const html = render();

    expect(html).toContain('aria-keyshortcuts="ArrowLeft ArrowRight Home End Enter"');
    expect(html).toContain('aria-describedby="conversation-panel-resizer-help"');
    expect(html).toContain('id="conversation-panel-resizer-help"');
    expect(html).toContain(`${PANE_RESIZE_STEP} pixel steps`);
    expect(html).toContain(`Hold Shift for ${PANE_RESIZE_LARGE_STEP} pixel steps`);
    expect(html).toContain("Home is the narrowest width");
    expect(html).toContain("Enter or a double-click restores the default");
    expect(html).toContain("Double-click to reset");
  });

  it("keeps a 44px pointer target and a col-resize cursor", () => {
    const html = render();

    // w-11 is Tailwind's 2.75rem / 44px.
    expect(html).toMatch(/class="[^"]*\bw-11\b/);
    expect(html).toMatch(/class="[^"]*\bcursor-col-resize\b/);
    expect(html).toMatch(/class="[^"]*\btouch-none\b/);
    expect(html).toMatch(/class="[^"]*\bselect-none\b/);
  });

  it("starts idle and carries hover, focus and drag styling hooks", () => {
    const html = render();

    expect(html).toContain('data-dragging="false"');
    expect(html).toContain("group-hover:bg-violet-400");
    expect(html).toContain("group-focus-visible:bg-violet-500");
    expect(html).toContain("group-data-[dragging=true]:bg-violet-500");
  });

  it("accepts caller positioning without losing its own classes", () => {
    const html = render({
      className: "hidden xl:flex",
      style: { left: "384px" },
    });

    expect(html).toMatch(/class="[^"]*\bhidden xl:flex\b/);
    expect(html).toContain("left:384px");
    expect(html).toMatch(/class="[^"]*\bw-11\b/);
  });

  it("marks its decoration as presentational", () => {
    const html = render();

    expect(html.match(/aria-hidden="true"/g)).toHaveLength(1);
  });
});
