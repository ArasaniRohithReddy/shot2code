jest.mock("nanoid", () => ({ nanoid: () => "preview-id" }));

import { renderToStaticMarkup } from "react-dom/server";
import { VariantSelectionButton } from "./Variants";

test("exposes option 3 as a keyboard-focusable selected control", () => {
  const html = renderToStaticMarkup(
    <VariantSelectionButton
      index={2}
      isSelected
      status="complete"
      onSelect={jest.fn()}
    />
  );

  expect(html).toContain('type="button"');
  expect(html).toContain('aria-pressed="true"');
  expect(html).toContain('aria-keyshortcuts="Alt+3"');
  expect(html).toContain('aria-label="Option 3, Complete, selected"');
  expect(html).toContain('data-testid="variant-option-3"');
});

test("keeps an unselected generating option keyboard accessible", () => {
  const html = renderToStaticMarkup(
    <VariantSelectionButton
      index={1}
      isSelected={false}
      status="generating"
      onSelect={jest.fn()}
    />
  );

  expect(html).toContain('type="button"');
  expect(html).toContain('aria-pressed="false"');
  expect(html).toContain('aria-label="Option 2, Generating"');
});
