import { renderToStaticMarkup } from "react-dom/server";
import DesignSystemSelector from "./DesignSystemSelector";

test("compact Chat control keeps the design-system purpose visible", () => {
  const html = renderToStaticMarkup(
    <DesignSystemSelector
      designSystems={[]}
      selectedDesignSystemId={null}
      setSelectedDesignSystemId={jest.fn()}
      onAddNew={jest.fn()}
      onManage={jest.fn()}
      compact
    />
  );

  expect(html).toContain("Design");
  expect(html).toContain('aria-label="Choose a design system"');
  expect(html).toContain('data-testid="design-system-select"');
});
