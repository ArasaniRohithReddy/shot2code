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
  isImageGenerationEnabled: boolean;
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
  Omit<Settings, "copilotSdkByok" | "mcpServers"> & {
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
  };
