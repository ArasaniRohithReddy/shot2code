export type HistoryJsonPrimitive = string | number | boolean | null;
export type HistoryJsonValue =
  | HistoryJsonPrimitive
  | HistoryJsonValue[]
  | HistoryJsonObject;
export interface HistoryJsonObject {
  [key: string]: HistoryJsonValue;
}

export type HistoryTimestampInput = Date | string;

export interface HistoryProjectFile {
  path: string;
  content: string;
  language: string;
  type: string;
  readonly?: boolean;
  generated?: boolean;
  metadata?: HistoryJsonObject;
}

export type HistoryProjectFileMap = Record<string, HistoryProjectFile>;

export interface HistoryProjectData {
  files: HistoryProjectFileMap;
  entryPoint: string;
  activeFilePath: string;
  generationTargetPath?: string;
}

export interface HistoryMessageInput {
  id?: string | null;
  role: string;
  content?: string | null;
  media?: HistoryJsonObject[];
  metadata?: HistoryJsonObject;
  createdAt?: HistoryTimestampInput | null;
}

export interface HistoryPromptInput {
  id?: string | null;
  role?: string;
  kind?: string;
  content: HistoryJsonValue;
  metadata?: HistoryJsonObject;
  createdAt?: HistoryTimestampInput | null;
}

export interface HistoryVariantInput {
  index: number;
  model?: string | null;
  status?: string;
  code?: string | null;
  currentContent?: string | null;
  createdAt?: HistoryTimestampInput | null;
  startedAt?: HistoryTimestampInput | null;
  completedAt?: HistoryTimestampInput | null;
  durationMs?: number | null;
  error?: string | null;
  metadata?: HistoryJsonObject;
  projectData?: HistoryProjectData;
  messages?: HistoryMessageInput[];
}

export interface HistoryVersionInput {
  id: string;
  commitHash?: string | null;
  parentCommitId?: string | null;
  retryOfCommitId?: string | null;
  versionType?: string;
  inputs?: HistoryJsonObject;
  promptMetadata?: HistoryJsonObject;
  metadata?: HistoryJsonObject;
  createdAt?: HistoryTimestampInput | null;
  prompts?: HistoryPromptInput[];
  variants?: HistoryVariantInput[];
}

export interface HistoryAppendVersionRequest {
  version: HistoryVersionInput;
  setAsHead?: boolean;
  selectCommit?: boolean;
  selectedVariantIndex?: number | null;
}

export interface HistoryProjectSnapshotRequest {
  title: string;
  stack?: string | null;
  inputMode?: string | null;
  metadata?: HistoryJsonObject;
  createdAt?: HistoryTimestampInput | null;
  version?: HistoryVersionInput | null;
  setAsHead?: boolean;
  selectCommit?: boolean;
  selectedVariantIndex?: number | null;
}

export interface HistorySelectionUpdateRequest {
  headCommitId?: string | null;
  selectedCommitId?: string | null;
  selectedVariantIndex?: number | null;
}

export interface HistoryMessage {
  id: string;
  position: number;
  role: string;
  content: string | null;
  media: HistoryJsonValue[];
  metadata: HistoryJsonObject;
  createdAt: Date;
}

export interface HistoryPrompt {
  id: string;
  position: number;
  role: string;
  kind: string;
  content: HistoryJsonValue;
  metadata: HistoryJsonObject;
  createdAt: Date;
}

export interface HistoryVariant {
  index: number;
  model: string | null;
  status: string;
  code: string | null;
  currentContent: string | null;
  createdAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
  durationMs: number | null;
  error: string | null;
  metadata: HistoryJsonObject;
  projectData?: HistoryProjectData;
  messages: HistoryMessage[];
}

export interface HistoryCommit {
  id: string;
  commitHash: string | null;
  parentCommitId: string | null;
  retryOfCommitId: string | null;
  versionType: string;
  inputs: HistoryJsonObject;
  promptMetadata: HistoryJsonObject;
  metadata: HistoryJsonObject;
  createdAt: Date;
  prompts: HistoryPrompt[];
  variants: HistoryVariant[];
  childCommitIds: string[];
}

export interface HistoryProjectSummary {
  id: string;
  title: string;
  stack: string | null;
  inputMode: string | null;
  metadata: HistoryJsonObject;
  createdAt: Date;
  updatedAt: Date;
  headCommitId: string | null;
  selectedCommitId: string | null;
  selectedVariantIndex: number | null;
  commitCount: number;
  variantCount: number;
}

export interface HistoryProject extends HistoryProjectSummary {
  rootCommitIds: string[];
  commits: HistoryCommit[];
}

export interface HistoryProjectList {
  projects: HistoryProjectSummary[];
}

export interface HistoryMigration {
  version: number;
  name: string;
  appliedAt: Date;
}

export interface HistoryHealth {
  status: string;
  databasePath: string;
  schemaVersion: number;
  latestSchemaVersion: number;
  foreignKeysEnabled: boolean;
  journalMode: string;
  migrations: HistoryMigration[];
}