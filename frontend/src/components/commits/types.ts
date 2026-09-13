import {
  MultiScreenshotMode,
  PromptContent,
  PromptMessageRole,
} from "../../types";
import type { ProjectFileMap } from "../../lib/project-files";
import type { Stack } from "../../lib/stacks";

export type CommitHash = string;

export type VariantStatus = "generating" | "complete" | "cancelled" | "error";

export type AgentEventStatus = "running" | "complete" | "error";
export type AgentEventType = "thinking" | "assistant" | "tool";
export type AgentEventPayload =
  | string
  | number
  | boolean
  | null
  | AgentEventPayload[]
  | { [key: string]: AgentEventPayload };

export type AgentEvent = {
  id: string;
  type: AgentEventType;
  status: AgentEventStatus;
  content?: string;
  toolName?: string;
  input?: AgentEventPayload;
  output?: AgentEventPayload;
  startedAt: number;
  endedAt?: number;
};

export type VariantHistoryMessage = {
  role: PromptMessageRole;
  text: string;
  imageAssetIds: string[];
  videoAssetIds: string[];
  multiImageMode?: MultiScreenshotMode;
};

export type Variant = {
  code: string;
  files?: ProjectFileMap;
  entryPoint?: string;
  activeFilePath?: string;
  generationTargetPath?: string;
  history: VariantHistoryMessage[];
  requestStartedAt?: number;
  completedAt?: number;
  status?: VariantStatus;
  errorMessage?: string;
  thinking?: string;
  thinkingStartTime?: number;
  thinkingDuration?: number;
  agentEvents?: AgentEvent[];
  model?: string;
  stack?: Stack;
};

export type CommitGenerationContext = {
  inputMode: "image" | "video" | "text";
  stack: Stack;
  selectedModels: string[];
  isAssetExtractionEnabled?: boolean;
  designSystem?: string | null;
  baseCommitHash?: CommitHash | null;
  baseVariantIndex?: number | null;
};

export type BaseCommit = {
  hash: CommitHash;
  parentHash: CommitHash | null;
  retryOfHash?: CommitHash | null;
  generationContext?: CommitGenerationContext;
  dateCreated: Date;
  isCommitted: boolean;
  variants: Variant[];
  selectedVariantIndex: number;
};

export type CommitType = "ai_create" | "ai_edit" | "code_create";

export type AiCreateCommit = BaseCommit & {
  type: "ai_create";
  inputs: PromptContent;
};

export type AiEditCommit = BaseCommit & {
  type: "ai_edit";
  inputs: PromptContent;
};

export type CodeCreateCommit = BaseCommit & {
  type: "code_create";
  inputs: null;
};

export type Commit = AiCreateCommit | AiEditCommit | CodeCreateCommit;
