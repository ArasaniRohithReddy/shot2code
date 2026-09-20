jest.mock("../config", () => ({
  WS_BACKEND_URL: "ws://127.0.0.1:7001",
  HTTP_BACKEND_URL: "http://127.0.0.1:7001",
}));
jest.mock("react-hot-toast", () => {
  const toast = Object.assign(jest.fn(), {
    error: jest.fn(),
    success: jest.fn(),
  });
  return { __esModule: true, default: toast };
});

import type { MutableRefObject } from "react";
import type {
  Commit,
  CommitGenerationContext,
} from "../components/commits/types";
import { generateCode } from "../generateCode";
import type { FullGenerationSettings, Settings } from "../types";
import { EditorTheme } from "../types";
import { CodeGenerationModel } from "./models";
import { Stack } from "./stacks";
import {
  DEFAULT_COPILOT_SDK_BYOK_SETTINGS,
  byokSelectionId,
} from "./copilot-sdk-byok";
import {
  buildGenerationIntegrationPayload,
  buildModelSelections,
} from "./integrations";
import { createMcpServer } from "./mcp-servers";
import {
  buildHistoryProjectSnapshot,
  commitToHistoryVersion,
  type ProjectHistorySnapshotState,
} from "./project-history";

/* Every credential this test hunts for in anything that gets written down. */
const DIRECT_OPENAI_KEY = "sk-direct-openai-value";
const DIRECT_ANTHROPIC_KEY = "sk-direct-anthropic-value";
const BYOK_KEY = "byok-dedicated-key-value";
const MCP_ENV_SECRET = "mcp-env-token-value";
const MCP_HEADER_SECRET = "mcp-header-token-value";
const SECRETS = [
  DIRECT_OPENAI_KEY,
  DIRECT_ANTHROPIC_KEY,
  BYOK_KEY,
  MCP_ENV_SECRET,
  MCP_HEADER_SECRET,
];

const OPENAI_BASE = "gpt-5.6-sol (high thinking)";
/** The same base model, picked twice: once natively and once through BYOK. */
const BYOK_ID = byokSelectionId("azure", OPENAI_BASE);
const MIXED_SELECTION = [OPENAI_BASE, BYOK_ID, "copilot/claude-opus-5"];

function settingsFixture(): Settings {
  return {
    openAiApiKey: DIRECT_OPENAI_KEY,
    openAiBaseURL: "https://proxy.example.com/v1",
    replicateApiKey: "replicate-value",
    screenshotOneApiKey: null,
    isImageGenerationEnabled: true,
    editorTheme: EditorTheme.COBALT,
    generatedCodeConfig: Stack.HTML_TAILWIND,
    codeGenerationModel: CodeGenerationModel.GEMINI_3_FLASH_PREVIEW_MINIMAL,
    selectedDesignSystemId: null,
    anthropicApiKey: DIRECT_ANTHROPIC_KEY,
    geminiApiKey: null,
    copilotGithubToken: null,
    copilotModels: [],
    selectedModels: [...MIXED_SELECTION],
    projectContext: null,
    copilotSdkByok: {
      ...DEFAULT_COPILOT_SDK_BYOK_SETTINGS,
      enabled: true,
      provider: "azure",
      baseUrl: "https://r.openai.azure.com",
      apiKey: BYOK_KEY,
      azureApiVersion: "2024-10-21",
    },
    mcpServers: [
      createMcpServer({
        id: "docs",
        name: "Docs",
        enabled: true,
        trusted: true,
        transport: "stdio",
        command: "npx",
        args: ["-y", "@example/mcp-docs"],
        env: { API_TOKEN: MCP_ENV_SECRET },
      }),
      createMcpServer({
        id: "remote",
        name: "Remote",
        enabled: true,
        trusted: true,
        transport: "http",
        url: "https://mcp.example.com/messages",
        headers: { Authorization: MCP_HEADER_SECRET },
      }),
    ],
  };
}

/**
 * The same object App.tsx hands the socket.
 *
 * Keeping the construction here in one place is what lets the assertions below
 * be about behaviour rather than about a hand-written literal.
 */
function generationParams(
  settings: Settings,
  overrides: Partial<FullGenerationSettings> = {}
): FullGenerationSettings {
  const integrations = buildGenerationIntegrationPayload(
    {
      copilotSdkByok: settings.copilotSdkByok,
      mcpServers: settings.mcpServers,
    },
    settings.selectedModels
  );
  const { copilotSdkByok, mcpServers, ...directSettings } = settings;
  void copilotSdkByok;
  void mcpServers;
  return {
    ...directSettings,
    generationType: "create",
    inputMode: "image",
    prompt: { text: "Build it", images: [] },
    modelSelections: integrations.modelSelections,
    selectedModels: integrations.selectedModels,
    copilotModels: integrations.selectedModels,
    copilotSdkByok: integrations.copilotSdkByok,
    mcpServers: integrations.mcpServers,
    ...(overrides.retryModels
      ? { retryModelSelections: buildModelSelections(overrides.retryModels) }
      : {}),
    ...overrides,
  };
}

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  sent: string[] = [];
  private listeners: Record<string, ((event: unknown) => void)[]> = {};

  constructor(public url: string) {
    FakeWebSocket.instances.push(this);
  }

  addEventListener(type: string, handler: (event: unknown) => void) {
    (this.listeners[type] ??= []).push(handler);
  }

  send(payload: string) {
    this.sent.push(payload);
  }

  close() {}

  open() {
    (this.listeners.open ?? []).forEach((handler) => handler({}));
  }
}

function sendAndCapture(
  params: FullGenerationSettings
): Record<string, unknown> {
  FakeWebSocket.instances = [];
  const original = (globalThis as { WebSocket?: unknown }).WebSocket;
  (globalThis as { WebSocket?: unknown }).WebSocket = FakeWebSocket;
  try {
    const ref: MutableRefObject<WebSocket | null> = { current: null };
    generateCode(ref, params, {
      onChange: jest.fn(),
      onSetCode: jest.fn(),
      onStatusUpdate: jest.fn(),
      onVariantComplete: jest.fn(),
      onVariantError: jest.fn(),
      onVariantCount: jest.fn(),
      onVariantModels: jest.fn(),
      onThinking: jest.fn(),
      onAssistant: jest.fn(),
      onToolStart: jest.fn(),
      onToolResult: jest.fn(),
      onCancel: jest.fn(),
      onComplete: jest.fn(),
    });
    const socket = FakeWebSocket.instances[0];
    socket.open();
    return JSON.parse(socket.sent[0]);
  } finally {
    (globalThis as { WebSocket?: unknown }).WebSocket = original;
  }
}

type WireSelection = { id: string; baseModel: string; runtime: string };

describe("the WebSocket generation payload", () => {
  test("names a runtime per pick, so one base model can run twice", () => {
    const payload = sendAndCapture(generationParams(settingsFixture()));
    const selections = payload.modelSelections as WireSelection[];

    expect(selections).toEqual([
      { id: OPENAI_BASE, baseModel: OPENAI_BASE, runtime: "native" },
      { id: BYOK_ID, baseModel: OPENAI_BASE, runtime: "copilot-byok" },
      {
        id: "copilot/claude-opus-5",
        baseModel: "copilot/claude-opus-5",
        runtime: "native",
      },
    ]);
    // Two entries share a base model and differ only by identity/runtime.
    expect(
      selections.filter((entry) => entry.baseModel === OPENAI_BASE)
    ).toHaveLength(2);
  });

  test("preserves the order the user arranged", () => {
    const settings = settingsFixture();
    settings.selectedModels = [BYOK_ID, "copilot/claude-opus-5", OPENAI_BASE];
    const payload = sendAndCapture(generationParams(settings));

    expect((payload.modelSelections as WireSelection[]).map((e) => e.id)).toEqual(
      [BYOK_ID, "copilot/claude-opus-5", OPENAI_BASE]
    );
  });

  test("still sends the plain id list for an older backend", () => {
    const payload = sendAndCapture(generationParams(settingsFixture()));

    expect(payload.selectedModels).toEqual(MIXED_SELECTION);
    expect(payload.copilotModels).toEqual(MIXED_SELECTION);
  });

  test("carries the configured connection and MCP servers", () => {
    const payload = sendAndCapture(generationParams(settingsFixture()));

    expect(payload.copilotSdkByok).toEqual({
      enabled: true,
      provider: "azure",
      wireApi: "responses",
      baseUrl: "https://r.openai.azure.com",
      apiKey: BYOK_KEY,
      azureApiVersion: "2024-10-21",
    });
    expect(payload.mcpServers).toHaveLength(2);
  });

  test("a native-only run still sends the connection, and stays native", () => {
    const settings = settingsFixture();
    settings.selectedModels = [OPENAI_BASE];
    const payload = sendAndCapture(generationParams(settings));

    // Nothing is gated: the runtime is chosen per selection, so a native pick
    // stays native regardless of what is configured.
    expect((payload.copilotSdkByok as { enabled: boolean }).enabled).toBe(true);
    expect((payload.modelSelections as WireSelection[])[0].runtime).toBe(
      "native"
    );
  });

  test("leaves every existing credential exactly where it was", () => {
    const payload = sendAndCapture(generationParams(settingsFixture()));

    expect(payload.openAiApiKey).toBe(DIRECT_OPENAI_KEY);
    expect(payload.openAiBaseURL).toBe("https://proxy.example.com/v1");
    expect(payload.anthropicApiKey).toBe(DIRECT_ANTHROPIC_KEY);
    expect(payload.replicateApiKey).toBe("replicate-value");
  });

  test("a retry replays each identity with its own runtime", () => {
    const settings = settingsFixture();
    const payload = sendAndCapture(
      generationParams(settings, { retryModels: [BYOK_ID, OPENAI_BASE] })
    );

    // The identity of each variant survives a retry: the BYOK variant replays
    // on the SDK, not on the provider whose model it borrowed.
    expect(payload.retryModelSelections).toEqual([
      { id: BYOK_ID, baseModel: OPENAI_BASE, runtime: "copilot-byok" },
      { id: OPENAI_BASE, baseModel: OPENAI_BASE, runtime: "native" },
    ]);
    expect(payload.retryModels).toEqual([BYOK_ID, OPENAI_BASE]);
    expect((payload.copilotSdkByok as { apiKey: string }).apiKey).toBe(BYOK_KEY);
    expect(payload.mcpServers).toHaveLength(2);
  });
});

/* -------------------------------------------------------------------------- */
/* Nothing written down may hold a credential                                  */
/* -------------------------------------------------------------------------- */

const createdAt = new Date("2026-09-12T20:00:00.000Z");

function generationContext(): CommitGenerationContext {
  const settings = settingsFixture();
  // Exactly what App.tsx records on a commit.
  return {
    inputMode: "image",
    stack: settings.generatedCodeConfig,
    selectedModels: [...settings.selectedModels],
    designSystem: null,
    baseCommitHash: null,
    baseVariantIndex: null,
  };
}

function commitFixture(): Commit {
  return {
    hash: "root",
    parentHash: null,
    dateCreated: createdAt,
    isCommitted: true,
    selectedVariantIndex: 0,
    type: "ai_create",
    generationContext: generationContext(),
    inputs: { text: "Build it", images: [], videos: [] },
    variants: [
      {
        code: "<main>Native</main>",
        history: [],
        status: "complete",
        // `variantModels` streams selection ids, so a BYOK variant records the
        // identity it ran as rather than the base model it borrowed.
        model: OPENAI_BASE,
        stack: Stack.HTML_TAILWIND,
      },
      {
        code: "<main>BYOK</main>",
        history: [],
        status: "complete",
        model: BYOK_ID,
        stack: Stack.HTML_TAILWIND,
      },
    ],
  };
}

function snapshotState(commit: Commit): ProjectHistorySnapshotState {
  return {
    projectId: "project-1",
    projectTitle: "Landing page",
    projectCreatedAt: createdAt,
    projectStack: Stack.HTML_TAILWIND,
    inputMode: "image",
    referenceImages: [],
    initialPrompt: "Build it",
    multiScreenshotMode: "pages",
    assetsById: {},
    commits: { [commit.hash]: commit },
    head: commit.hash,
    latestCommitHash: commit.hash,
  };
}

describe("commit and history snapshots hold no credentials", () => {
  test("the recorded generation context has no credential-bearing field", () => {
    const context = generationContext();

    expect(Object.keys(context).sort()).toEqual([
      "baseCommitHash",
      "baseVariantIndex",
      "designSystem",
      "inputMode",
      "selectedModels",
      "stack",
    ]);
    expect(context).not.toHaveProperty("copilotSdkByok");
    expect(context).not.toHaveProperty("mcpServers");
    expect(context).not.toHaveProperty("openAiApiKey");
  });

  test("a serialized version carries no secret from any provider", () => {
    const commit = commitFixture();
    const serialized = JSON.stringify(
      commitToHistoryVersion(commit, snapshotState(commit))
    );

    for (const secret of SECRETS) {
      expect(serialized).not.toContain(secret);
    }
  });

  test("a serialized version carries no MCP env value, header or endpoint", () => {
    const commit = commitFixture();
    const serialized = JSON.stringify(
      commitToHistoryVersion(commit, snapshotState(commit))
    );

    expect(serialized).not.toContain("API_TOKEN");
    expect(serialized).not.toContain("Authorization");
    expect(serialized).not.toContain("mcp.example.com");
    expect(serialized).not.toContain("r.openai.azure.com");
  });

  test("a project snapshot carries no secret either", () => {
    const commit = commitFixture();
    const serialized = JSON.stringify(
      buildHistoryProjectSnapshot(snapshotState(commit), commit)
    );

    for (const secret of SECRETS) {
      expect(serialized).not.toContain(secret);
    }
    expect(serialized).not.toContain("copilotSdkByok");
    expect(serialized).not.toContain("mcpServers");
  });

  test("history keeps the synthetic id rather than the base model", () => {
    const commit = commitFixture();
    const version = commitToHistoryVersion(commit, snapshotState(commit));
    const serialized = JSON.stringify(version);

    // Both picks survive, so a retry can rebuild both runtimes.
    expect(serialized).toContain(BYOK_ID);
    expect(serialized).toContain(OPENAI_BASE);
    expect(version.variants?.map((variant) => variant.model)).toEqual([
      OPENAI_BASE,
      BYOK_ID,
    ]);
  });

  test("a recorded selection rebuilds the same runtimes on retry", () => {
    const replayed = buildModelSelections(
      commitFixture().generationContext!.selectedModels
    );

    expect(replayed.map((entry) => entry.runtime)).toEqual([
      "native",
      "copilot-byok",
      "native",
    ]);
    expect(replayed.map((entry) => entry.id)).toEqual(MIXED_SELECTION);
  });
});
