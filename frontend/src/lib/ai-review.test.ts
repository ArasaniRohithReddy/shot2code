jest.mock("../config", () => ({
  HTTP_BACKEND_URL: "http://backend.test",
  WS_BACKEND_URL: "ws://backend.test",
}));

import { requestAiReview } from "./ai-review";
import { DEFAULT_COPILOT_SDK_BYOK_SETTINGS } from "./copilot-sdk-byok";
import { DEFAULT_WEB_SEARCH_SETTINGS } from "./web-search";
import { DEFAULT_IMAGE_GENERATION_SETTINGS } from "./image-providers";
import { DEFAULT_FREE_IMAGE_SEARCH_SETTINGS } from "./free-image-search";
import { EditorTheme, type Settings } from "../types";
import { CodeGenerationModel } from "./models";
import { Stack } from "./stacks";

const settings: Settings = {
  openAiApiKey: "openai-secret",
  openAiBaseURL: null,
  anthropicApiKey: null,
  geminiApiKey: null,
  replicateApiKey: null,
  screenshotOneApiKey: null,
  figmaAccessToken: "figma-secret",
  stitchApiKey: "stitch-secret",
  isImageGenerationEnabled: false,
  copilotWebSearchEnabled: false,
  editorTheme: EditorTheme.COBALT,
  generatedCodeConfig: Stack.HTML_CSS,
  codeGenerationModel: CodeGenerationModel.GPT_5_4_MINI_LOW,
  selectedDesignSystemId: null,
  copilotGithubToken: null,
  copilotUseLoggedInUser: true,
  copilotModels: [],
  selectedModels: [],
  projectContext: null,
  copilotSdkByok: DEFAULT_COPILOT_SDK_BYOK_SETTINGS,
  mcpServers: [],
  webSearch: DEFAULT_WEB_SEARCH_SETTINGS,
  imageGeneration: DEFAULT_IMAGE_GENERATION_SETTINGS,
  freeImageSearch: DEFAULT_FREE_IMAGE_SEARCH_SETTINGS,
};

test("AI review sends only model credentials and no capture secrets", async () => {
  const fetchMock = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      model: "gpt-5.4-mini (low thinking)",
      findings: [],
    }),
  });
  global.fetch = fetchMock as unknown as typeof fetch;

  await requestAiReview({
    source: "<main>Hello</main>",
    sourcePath: "index.html",
    viewportWidths: [390, 1440],
    model: "gpt-5.4-mini (low thinking)",
    settings,
  });

  const body = JSON.stringify(JSON.parse(fetchMock.mock.calls[0][1].body));
  expect(body).toContain("openai-secret");
  expect(body).not.toContain("figma-secret");
  expect(body).not.toContain("stitch-secret");
  expect(body).not.toContain("screenshotOneApiKey");
});
