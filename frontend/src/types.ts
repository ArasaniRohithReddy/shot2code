import { Stack } from "./lib/stacks";
import { CodeGenerationModel } from "./lib/models";
import type {
  CopilotSdkByokSettings,
  CopilotSdkByokWirePayload,
} from "./lib/copilot-sdk-byok";
import type { ModelSelectionEntry } from "./lib/integrations";
import type {
  McpServerConfig,
  McpServerWirePayload,
} from "./lib/mcp-servers";
import type {
  WebSearchSettings,
  WebSearchWirePayload,
} from "./lib/web-search";
import type {
  ImageGenerationSettings,
  ImageGenerationWirePayload,
} from "./lib/image-providers";
import type {
  FreeImageSearchSettings,
  FreeImageSearchWirePayload,
} from "./lib/free-image-search";

export enum EditorTheme {
  ESPRESSO = "espresso",
  COBALT = "cobalt",
}

export enum AppTheme {
  SYSTEM = "system",
  LIGHT = "light",
  DARK = "dark",
}

export interface Settings {
  openAiApiKey: string | null;
  openAiBaseURL: string | null;
  replicateApiKey: string | null;
  screenshotOneApiKey: string | null;
  figmaAccessToken: string | null;
  stitchApiKey: string | null;
  /** Optional fine-grained token for explicitly requested private repo imports. */
  githubRepositoryToken: string | null;
  isImageGenerationEnabled: boolean;
  /**
   * Allow Copilot SDK variants to use the built-in web_search tool.
   *
   * Superseded at run time by `webSearch` when that is usable: shot2code
   * enables one search tool per session, never both.
   */
  copilotWebSearchEnabled: boolean;
  editorTheme: EditorTheme;
  generatedCodeConfig: Stack;
  /**
   * @deprecated Superseded by `selectedModels`. Kept so a settings blob saved
   * by an older build can still be migrated on load.
   */
  codeGenerationModel: CodeGenerationModel;
  selectedDesignSystemId: string | null;
  anthropicApiKey: string | null;
  geminiApiKey: string | null;
  copilotGithubToken: string | null;
  /** Whether shot2code may reuse an existing Copilot/GitHub CLI login. */
  copilotUseLoggedInUser?: boolean;
  /**
   * @deprecated Superseded by `selectedModels`, which holds the same ids for
   * every provider rather than Copilot alone.
   */
  copilotModels: string[];
  /**
   * Model ids to generate with; empty means shot2code chooses.
   *
   * Holds native model ids and Copilot SDK BYOK run identities
   * (`sdk-byok/<provider>/<base model>`) in one ordered list. Both are kept
   * verbatim in Settings and in history: a native id and the BYOK identity of
   * that same base model are two separate picks that produce two separate
   * variants on two separate runtimes.
   */
  selectedModels: string[];
  projectContext: ProjectContext | null;
  /**
   * The Copilot SDK "bring your own key" connection.
   *
   * A separate, additive runtime with its own endpoint and key. It never
   * reads, replaces or re-routes `openAiApiKey`, `openAiBaseURL`,
   * `anthropicApiKey`, `geminiApiKey` or `replicateApiKey`.
   */
  copilotSdkByok: CopilotSdkByokSettings;
  /** MCP servers offered to Copilot and Copilot SDK BYOK runs. */
  mcpServers: McpServerConfig[];
  /**
   * The provider-neutral web search behind the canonical `search_web` tool.
   *
   * Off by default. Its API key is backend-only: it is read here at send time
   * and never written to history, a commit snapshot or a generation context.
   */
  webSearch: WebSearchSettings;
  /**
   * Which backend generates placeholder images.
   *
   * Additive: Replicate is the default and stays exactly as it was. Picking
   * Cloudflare Workers AI or an OpenAI-compatible endpoint brings its own
   * credentials and never reads, replaces or re-routes `replicateApiKey` -
   * which also remains the only background-removal backend. Those credentials
   * are backend-only: read here at send time, never written to history, a
   * commit snapshot or a generation context.
   */
  imageGeneration: ImageGenerationSettings;
  /**
   * Keyless, licence-aware free image search (Openverse).
   *
   * Additive and credential-free: it works with no image-generation provider
   * configured, and configuring one never switches it off or re-routes it. Off
   * by default, because it sends the model's query to a third party.
   */
  freeImageSearch: FreeImageSearchSettings;
}

export interface DesignSystem {
  id: string;
  name: string;
  content: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectComponentSummary {
  name: string;
  path: string;
  props: string[];
}

export interface ProjectContext {
  name: string;
  file_count: number;
  analyzed_file_count: number;
  component_count: number;
  components: ProjectComponentSummary[];
  dependencies: string[];
  tokens: string[];
  framework_hints: string[];
  summary: string;
}

export enum AppState {
  INITIAL = "INITIAL",
  CODING = "CODING",
  CODE_READY = "CODE_READY",
}

export enum ScreenRecorderState {
  INITIAL = "initial",
  RECORDING = "recording",
  FINISHED = "finished",
}

export type PromptMessageRole = "user" | "assistant";
export type PromptAssetType = "image" | "video";
export type MultiScreenshotMode =
  | "pages"
  | "responsive"
  | "states"
  | "references";

export type DesignSource = "figma" | "github" | "stitch";

export interface DesignSourceAsset {
  name: string;
  url: string;
  mimeType: string;
  source: DesignSource;
  kind: string;
}

export interface PromptAsset {
  id: string;
  type: PromptAssetType;
  dataUrl: string;
}

export interface PromptContent {
  text: string; // What the user typed (displayed in the UI)
  // Full instruction for the model when it differs from `text`
  // (e.g. includes the selected-element reference)
  fullText?: string;
  images: string[]; // Array of data URLs
  videos?: string[]; // Array of data URLs
  /**
   * Already-persisted assets imported from a design source.
   *
   * These are deliberately URLs plus bounded metadata, never credentials or
   * raw bytes. The backend includes them in the agent prompt so generated code
   * and later chat refinements can reuse the exact source assets.
   */
  sourceAssets?: DesignSourceAsset[];
  multiImageMode?: MultiScreenshotMode;
  selectedElementHtml?: string; // Raw HTML of selected element (for display only)
}

export interface PromptHistoryMessage {
  role: PromptMessageRole;
  text: string;
  images: string[];
  videos: string[];
  multiImageMode?: MultiScreenshotMode;
}

export interface CodeGenerationParams {
  generationType: "create" | "update";
  inputMode: "image" | "video" | "text";
  prompt: PromptContent;
  history?: PromptHistoryMessage[];
  fileState?: {
    path: string;
    content: string;
  };
  optionCodes?: string[];
  retryModels?: string[];
  isAssetExtractionEnabled?: boolean;
}
export type FullGenerationSettings = CodeGenerationParams &
  Omit<
    Settings,
    | "copilotSdkByok"
    | "mcpServers"
    | "webSearch"
    | "imageGeneration"
    | "freeImageSearch"
    | "screenshotOneApiKey"
    | "figmaAccessToken"
    | "stitchApiKey"
    | "githubRepositoryToken"
  > & {
    designSystem?: string | null;
    /**
     * The authoritative selection: one entry per pick, in order, each naming
     * its own run identity and runtime. `selectedModels` carries the same ids
     * for an older backend.
     */
    modelSelections: ModelSelectionEntry[];
    /** A retry replays the identities the original run recorded. */
    retryModelSelections?: ModelSelectionEntry[];
    /**
     * Wire shape of the integration settings.
     *
     * This describes what is *configured*, not what this run picked. The
     * runtime is decided per selection id, so sending this block never
     * re-routes a native pick. Secrets are read from the current Settings at
     * send time and are never persisted.
     */
    copilotSdkByok: CopilotSdkByokWirePayload;
    mcpServers: McpServerWirePayload[];
    /**
     * Web-search configuration for this run.
     *
     * Carries the search provider's key at send time only. Like the other
     * integration blocks it is never persisted into a commit or a snapshot.
     */
    webSearch: WebSearchWirePayload;
    /**
     * Image-provider configuration for this run.
     *
     * Carries the chosen provider's credentials at send time only, and never
     * the other providers'. Like the blocks above it is never persisted.
     */
    imageGeneration: ImageGenerationWirePayload;
    /** No credential, so this block is identical everywhere it appears. */
    freeImageSearch: FreeImageSearchWirePayload;
  };
