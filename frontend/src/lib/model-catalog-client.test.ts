jest.mock("../config", () => ({ HTTP_BACKEND_URL: "http://backend.test" }));

import { fetchModelCatalog } from "./model-catalog-client";

afterEach(() => {
  // @ts-expect-error - restoring the global we replaced
  delete global.fetch;
});

test("posts the credentials and the current selection", async () => {
  const fetchMock = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ providers: [], stale_selection: [] }),
  });
  global.fetch = fetchMock as unknown as typeof fetch;

  await fetchModelCatalog(
    {
      openAiApiKey: "  sk-test  ",
      anthropicApiKey: "",
      geminiApiKey: null,
      copilotGithubToken: "github_pat",
    },
    { selectedModels: ["gpt-5.5 (high thinking)"], refresh: true }
  );

  const [url, init] = fetchMock.mock.calls[0];
  expect(String(url)).toBe("http://backend.test/api/models");
  expect(init.method).toBe("POST");
  expect(JSON.parse(init.body)).toEqual({
    openAiApiKey: "sk-test",
    anthropicApiKey: null,
    geminiApiKey: null,
    copilotGithubToken: "github_pat",
    selectedModels: ["gpt-5.5 (high thinking)"],
    refresh: true,
  });
});

test("defaults to no credentials, no selection and no refresh", async () => {
  const fetchMock = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ providers: [], stale_selection: [] }),
  });
  global.fetch = fetchMock as unknown as typeof fetch;

  await fetchModelCatalog({});

  expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
    openAiApiKey: null,
    anthropicApiKey: null,
    geminiApiKey: null,
    copilotGithubToken: null,
    selectedModels: [],
    refresh: false,
  });
});

test("parses the response into a catalog", async () => {
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      providers: [
        {
          id: "openai",
          available: true,
          models: [{ id: "gpt-5.5 (high thinking)", provider: "openai" }],
        },
      ],
      stale_selection: ["ghost"],
    }),
  }) as unknown as typeof fetch;

  const catalog = await fetchModelCatalog({ openAiApiKey: "sk" });

  expect(catalog.providers[0].models[0].id).toBe("gpt-5.5 (high thinking)");
  expect(catalog.stale_selection).toEqual(["ghost"]);
});

test("raises when the backend rejects the request", async () => {
  global.fetch = jest
    .fn()
    .mockResolvedValue({ ok: false, status: 503 }) as unknown as typeof fetch;

  await expect(fetchModelCatalog({})).rejects.toThrow("503");
});
