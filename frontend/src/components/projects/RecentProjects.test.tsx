jest.mock("../../config", () => ({
  HTTP_BACKEND_URL: "http://127.0.0.1:7001",
}));

import { renderToStaticMarkup } from "react-dom/server";
import RecentProjects from "./RecentProjects";

test("Recent projects exposes the cross-project Full history view", () => {
  const html = renderToStaticMarkup(
    <RecentProjects
      projects={[
        {
          id: "project-1",
          title: "Northwind Analytics",
          stack: "react_tailwind",
          inputMode: "text",
          createdAt: new Date("2026-10-01T10:00:00Z"),
          updatedAt: new Date("2026-10-04T12:00:00Z"),
          versionCount: 4,
        },
      ]}
      isLoading={false}
      error={null}
      busyProjectId={null}
      onOpen={jest.fn().mockResolvedValue(true)}
      onDelete={jest.fn().mockResolvedValue(true)}
      onNew={jest.fn()}
      onFullHistory={jest.fn()}
    />
  );

  expect(html).toContain("Recent projects");
  expect(html).toContain("4 versions");
  expect(html).toContain("Full history");
  expect(html).toContain("New project");
});
