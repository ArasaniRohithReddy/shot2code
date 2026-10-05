jest.mock("../../config", () => ({
  HTTP_BACKEND_URL: "http://127.0.0.1:7001",
}));

import { renderToStaticMarkup } from "react-dom/server";
import ModelSelector from "./ModelSelector";

describe("ModelSelector", () => {
  it("stays visible when no provider is configured", () => {
    const html = renderToStaticMarkup(
      <ModelSelector selectedModels={[]} setSelectedModels={jest.fn()} />
    );

    expect(html).toContain("Configure models");
    expect(html).toContain("Choose which models generate each option");
  });
});
