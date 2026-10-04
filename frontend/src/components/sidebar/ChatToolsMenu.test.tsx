jest.mock("../../config", () => ({
  HTTP_BACKEND_URL: "http://127.0.0.1:7001",
}));

import { renderToStaticMarkup } from "react-dom/server";
import ChatToolsMenu from "./ChatToolsMenu";
import {
  buildChatToolRows,
  type ChatToolAccess,
} from "./chat-tools";

const ACCESS: ChatToolAccess = {
  webSearchEnabled: true,
  pageFetchEnabled: true,
  freeImageSearchEnabled: true,
  generatedImagesEnabled: false,
  iconSearchEnabled: true,
  activeMcpServers: 2,
  writeEnabledMcpServers: 1,
};

test("summarizes consent, cost and write boundaries for Chat tools", () => {
  const rows = buildChatToolRows(ACCESS, true, 3);

  expect(rows.find((row) => row.name === "Web search")?.status).toBe("On");
  expect(rows.find((row) => row.name === "Generated images")?.status).toBe(
    "Off / unconfigured"
  );
  expect(rows.find((row) => row.name === "MCP servers")?.detail).toContain(
    "write tools"
  );
  expect(rows.find((row) => row.name === "Agent Skills")?.status).toBe(
    "3 enabled"
  );
});

test("exposes a visible Tools control without claiming everything is enabled", () => {
  const html = renderToStaticMarkup(
    <ChatToolsMenu access={ACCESS} onManage={jest.fn()} />
  );

  expect(html).toContain('data-testid="chat-tools-menu"');
  expect(html).toContain("Tools");
  expect(html).not.toContain("All tools enabled");
});
