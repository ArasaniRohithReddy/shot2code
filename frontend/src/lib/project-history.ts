import type {
  AgentEvent,
  AgentEventPayload,
  Commit,
  CommitGenerationContext,
  CommitHash,
  CommitType,
  Variant,
  VariantHistoryMessage,
  VariantStatus,
} from "../components/commits/types";
import {
  createProjectFile,
  getProjectGenerationContent,
  normalizeProjectState,
  type ProjectFileLanguage,
  type ProjectFileMap,
  type ProjectFileMetadata,
  type ProjectFileType,
} from "./project-files";
import { Stack } from "./stacks";
import type {
  HistoryCommit,
  HistoryJsonObject,
  HistoryJsonValue,
  HistoryMessage,
  HistoryProject,
  HistoryProjectData,
  HistoryProjectSnapshotRequest,
  HistoryProjectSummary,
  HistorySelectionUpdateRequest,
  HistoryVariant,
  HistoryVariantInput,
  HistoryVersionInput,
} from "./history-types";
import type {
  MultiScreenshotMode,
  PromptAsset,
  PromptAssetType,
  PromptContent,
} from "../types";

export const HISTORY_APP_METADATA_KEY = "shot2code";
export const HISTORY_APP_METADATA_VERSION = 1;
export const INTERRUPTED_GENERATION_MESSAGE =
  "Generation was interrupted before it finished. Retry this version to continue.";

const INPUT_MODES = new Set(["image", "video", "text"]);
const MULTI_SCREENSHOT_MODES = new Set([
  "pages",
  "responsive",
  "states",
  "references",
]);
const COMMIT_TYPES = new Set(["ai_create", "ai_edit", "code_create"]);
const VARIANT_STATUSES = new Set([
  "generating",
  "complete",
  "cancelled",
  "error",
]);
const AGENT_EVENT_TYPES = new Set(["thinking", "assistant", "tool"]);
const AGENT_EVENT_STATUSES = new Set(["running", "complete", "error"]);
const FILE_LANGUAGES = new Set<ProjectFileLanguage>([
  "html", "css", "javascript", "jsx", "typescript", "tsx", "json",
  "markdown", "vue", "xml", "yaml", "text",
]);
const FILE_TYPES = new Set<ProjectFileType>([
  "markup", "style", "script", "data", "documentation", "component", "text",
]);
const STACKS = new Set<string>(Object.values(Stack));

type InputMode = "image" | "video" | "text";
type UnknownRecord = Record<string, unknown>;

export interface ProjectHistorySnapshotState {
  projectId: string;
  projectTitle: string;
  projectCreatedAt: Date;
  projectStack: Stack;
  inputMode: InputMode;
  referenceImages: string[];
  initialPrompt: string;
  multiScreenshotMode: MultiScreenshotMode;
  assetsById: Record<string, PromptAsset>;
  commits: Record<string, Commit>;
  head: CommitHash | null;
  latestCommitHash: CommitHash | null;
}

export interface RestoredProjectHistoryState extends ProjectHistorySnapshotState {
  interruptedGeneration: boolean;
}

export interface RecentHistoryProject {
  id: string;
  title: string;
  stack: string | null;
  inputMode: string | null;
  createdAt: Date;
  updatedAt: Date;
  versionCount: number;
}

interface AssetRegistry {
  assetsById: Record<string, PromptAsset>;
  idForDataUrl: (type: PromptAssetType, dataUrl: string) => string;
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function serializeGenerationContext(
  context: CommitGenerationContext
): HistoryJsonObject {
  const serialized: HistoryJsonObject = {
    input_mode: context.inputMode,
    stack: context.stack,
    selected_models: [...context.selectedModels],
  };
  optionalJson(
    serialized,
    "is_asset_extraction_enabled",
    context.isAssetExtractionEnabled
  );
  if (context.designSystem !== undefined) {
    serialized.design_system = context.designSystem;
  }
  if (context.baseCommitHash !== undefined) {
    serialized.base_commit_hash = context.baseCommitHash;
  }
  if (context.baseVariantIndex !== undefined) {
    serialized.base_variant_index = context.baseVariantIndex;
  }
  return serialized;
}

function parseGenerationContext(
  value: unknown
): CommitGenerationContext | undefined {
  if (!isRecord(value)) return undefined;
  const inputMode = stringValue(value.input_mode);
  const stack = stringValue(value.stack);
  if (!inputMode || !INPUT_MODES.has(inputMode) || !stack || !STACKS.has(stack)) {
    return undefined;
  }

  const context: CommitGenerationContext = {
    inputMode: inputMode as CommitGenerationContext["inputMode"],
    stack: stack as Stack,
    selectedModels: stringArray(value.selected_models),
  };
  if (typeof value.is_asset_extraction_enabled === "boolean") {
    context.isAssetExtractionEnabled = value.is_asset_extraction_enabled;
  }
  if (value.design_system === null || typeof value.design_system === "string") {
    context.designSystem = value.design_system;
  }
  if (
    value.base_commit_hash === null ||
    typeof value.base_commit_hash === "string"
  ) {
    context.baseCommitHash = value.base_commit_hash;
  }
  const baseVariantIndex = numberValue(value.base_variant_index);
  if (value.base_variant_index === null) {
    context.baseVariantIndex = null;
  } else if (
    baseVariantIndex !== undefined &&
    Number.isInteger(baseVariantIndex) &&
    baseVariantIndex >= 0
  ) {
    context.baseVariantIndex = baseVariantIndex;
  }
  return context;
}

function projectFileMetadata(value: unknown): ProjectFileMetadata | undefined {
  if (!isRecord(value)) return undefined;
  const metadata: ProjectFileMetadata = {};
  for (const [key, item] of Object.entries(value)) {
    if (
      item === null ||
      typeof item === "string" ||
      typeof item === "number" ||
      typeof item === "boolean"
    ) {
      metadata[key] = item;
    }
  }
  return Object.keys(metadata).length > 0 ? metadata : undefined;
}

function optionalJson(
  target: HistoryJsonObject,
  key: string,
  value: HistoryJsonValue | undefined
): void {
  if (value !== undefined) target[key] = value;
}

function toIsoTimestamp(value: number | Date | undefined): string | undefined {
  if (value === undefined) return undefined;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function stableAssetId(type: PromptAssetType, dataUrl: string): string {
  let hash = 2166136261;
  for (let index = 0; index < dataUrl.length; index += 1) {
    hash ^= dataUrl.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `history-${type}-${(hash >>> 0).toString(36)}-${dataUrl.length}`;
}

function createAssetRegistry(state: ProjectHistorySnapshotState): AssetRegistry {
  const assetsById: Record<string, PromptAsset> = {};
  const idsByDataUrl = new Map<string, string>();

  for (const asset of Object.values(state.assetsById)) {
    if (!asset.id || !asset.dataUrl) continue;
    assetsById[asset.id] = { ...asset };
    idsByDataUrl.set(`${asset.type}:${asset.dataUrl}`, asset.id);
  }

  const idForDataUrl = (type: PromptAssetType, rawDataUrl: string): string => {
    const dataUrl = rawDataUrl.trim();
    const lookupKey = `${type}:${dataUrl}`;
    const existing = idsByDataUrl.get(lookupKey);
    if (existing) return existing;

    const baseId = stableAssetId(type, dataUrl);
    let id = baseId;
    let suffix = 1;
    while (
      assetsById[id] &&
      (assetsById[id].type !== type || assetsById[id].dataUrl !== dataUrl)
    ) {
      id = `${baseId}-${suffix}`;
      suffix += 1;
    }
    assetsById[id] = { id, type, dataUrl };
    idsByDataUrl.set(lookupKey, id);
    return id;
  };

  state.referenceImages.forEach((dataUrl) => {
    idForDataUrl(state.inputMode === "video" ? "video" : "image", dataUrl);
  });
  Object.values(state.commits).forEach((commit) => {
    if (commit.type === "code_create") return;
    commit.inputs.images.forEach((dataUrl) => idForDataUrl("image", dataUrl));
    (commit.inputs.videos ?? []).forEach((dataUrl) => idForDataUrl("video", dataUrl));
  });

  return { assetsById, idForDataUrl };
}

function serializeAssets(assetsById: Record<string, PromptAsset>): HistoryJsonObject {
  const serialized: HistoryJsonObject = {};
  for (const [id, asset] of Object.entries(assetsById)) {
    serialized[id] = { id, type: asset.type, data_url: asset.dataUrl };
  }
  return serialized;
}

function parseAssets(value: unknown): Record<string, PromptAsset> {
  if (!isRecord(value)) return {};
  const assets: Record<string, PromptAsset> = {};
  for (const [mapId, rawAsset] of Object.entries(value)) {
    if (!isRecord(rawAsset)) continue;
    const id = stringValue(rawAsset.id) ?? mapId;
    const type = rawAsset.type;
    const dataUrl = stringValue(rawAsset.data_url);
    if ((type !== "image" && type !== "video") || !dataUrl) continue;
    assets[id] = { id, type, dataUrl };
  }
  return assets;
}

function assetIdsForUrls(
  registry: AssetRegistry,
  type: PromptAssetType,
  urls: string[]
): string[] {
  return unique(
    urls.map((dataUrl) => dataUrl.trim()).filter(Boolean)
      .map((dataUrl) => registry.idForDataUrl(type, dataUrl))
  );
}

function serializePrompt(
  prompt: PromptContent,
  registry: AssetRegistry
): HistoryJsonObject {
  const serialized: HistoryJsonObject = {
    text: prompt.text,
    image_asset_ids: assetIdsForUrls(registry, "image", prompt.images),
    video_asset_ids: assetIdsForUrls(registry, "video", prompt.videos ?? []),
  };
  optionalJson(serialized, "full_text", prompt.fullText);
  optionalJson(serialized, "multi_image_mode", prompt.multiImageMode);
  optionalJson(serialized, "selected_element_html", prompt.selectedElementHtml);
  return serialized;
}

function resolveAssetIds(
  assetIds: string[],
  assetsById: Record<string, PromptAsset>,
  type: PromptAssetType
): string[] {
  return assetIds
    .map((assetId) => assetsById[assetId])
    .filter(
      (asset): asset is PromptAsset =>
        asset !== undefined && asset.type === type
    )
    .map((asset) => asset.dataUrl);
}

function parsePrompt(
  value: unknown,
  assetsById: Record<string, PromptAsset>
): PromptContent {
  const prompt = isRecord(value) ? value : {};
  const imageAssetIds = stringArray(prompt.image_asset_ids);
  const videoAssetIds = stringArray(prompt.video_asset_ids);
  const multiImageMode = stringValue(prompt.multi_image_mode);
  const parsed: PromptContent = {
    text: stringValue(prompt.text) ?? "",
    images: resolveAssetIds(imageAssetIds, assetsById, "image"),
    videos: resolveAssetIds(videoAssetIds, assetsById, "video"),
  };
  const fullText = stringValue(prompt.full_text);
  if (fullText !== undefined) parsed.fullText = fullText;
  if (multiImageMode && MULTI_SCREENSHOT_MODES.has(multiImageMode)) {
    parsed.multiImageMode = multiImageMode as MultiScreenshotMode;
  }
  const selectedElementHtml = stringValue(prompt.selected_element_html);
  if (selectedElementHtml !== undefined) {
    parsed.selectedElementHtml = selectedElementHtml;
  }
  return parsed;
}

function serializeAgentEvent(event: AgentEvent): HistoryJsonObject {
  const serialized: HistoryJsonObject = {
    id: event.id,
    type: event.type,
    status: event.status,
    started_at: event.startedAt,
  };
  optionalJson(serialized, "content", event.content);
  optionalJson(serialized, "tool_name", event.toolName);
  optionalJson(serialized, "input", event.input);
  optionalJson(serialized, "output", event.output);
  optionalJson(serialized, "ended_at", event.endedAt);
  return serialized;
}

function parseAgentPayload(value: unknown): AgentEventPayload | undefined {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : undefined;
  }
  if (Array.isArray(value)) {
    const parsed: AgentEventPayload[] = [];
    for (const item of value) {
      const next = parseAgentPayload(item);
      if (next === undefined) return undefined;
      parsed.push(next);
    }
    return parsed;
  }
  if (isRecord(value)) {
    const parsed: { [key: string]: AgentEventPayload } = {};
    for (const [key, item] of Object.entries(value)) {
      const next = parseAgentPayload(item);
      if (next === undefined) return undefined;
      parsed[key] = next;
    }
    return parsed;
  }
  return undefined;
}

function parseAgentEvents(value: unknown): AgentEvent[] {
  if (!Array.isArray(value)) return [];
  const events: AgentEvent[] = [];
  for (const rawEvent of value) {
    if (!isRecord(rawEvent)) continue;
    const id = stringValue(rawEvent.id);
    const type = stringValue(rawEvent.type);
    const status = stringValue(rawEvent.status);
    const startedAt = numberValue(rawEvent.started_at);
    if (
      !id || !type || !AGENT_EVENT_TYPES.has(type) ||
      !status || !AGENT_EVENT_STATUSES.has(status) ||
      startedAt === undefined
    ) {
      continue;
    }
    const event: AgentEvent = {
      id,
      type: type as AgentEvent["type"],
      status: status as AgentEvent["status"],
      startedAt,
    };
    const content = stringValue(rawEvent.content);
    if (content !== undefined) event.content = content;
    const toolName = stringValue(rawEvent.tool_name);
    if (toolName !== undefined) event.toolName = toolName;
    const input = parseAgentPayload(rawEvent.input);
    if (input !== undefined) event.input = input;
    const output = parseAgentPayload(rawEvent.output);
    if (output !== undefined) event.output = output;
    const endedAt = numberValue(rawEvent.ended_at);
    if (endedAt !== undefined) event.endedAt = endedAt;
    events.push(event);
  }
  return events;
}

function serializeVariantHistoryMessage(
  message: VariantHistoryMessage
): HistoryJsonObject {
  const serialized: HistoryJsonObject = {
    role: message.role,
    text: message.text,
    image_asset_ids: [...message.imageAssetIds],
    video_asset_ids: [...message.videoAssetIds],
  };
  optionalJson(serialized, "multi_image_mode", message.multiImageMode);
  return serialized;
}

function parseVariantHistoryMessage(value: unknown): VariantHistoryMessage | null {
  if (!isRecord(value)) return null;
  const role = value.role;
  if (role !== "user" && role !== "assistant") return null;
  const multiImageMode = stringValue(value.multi_image_mode);
  const message: VariantHistoryMessage = {
    role,
    text: stringValue(value.text) ?? "",
    imageAssetIds: stringArray(value.image_asset_ids),
    videoAssetIds: stringArray(value.video_asset_ids),
  };
  if (multiImageMode && MULTI_SCREENSHOT_MODES.has(multiImageMode)) {
    message.multiImageMode = multiImageMode as MultiScreenshotMode;
  }
  return message;
}

function historyMessageToVariantMessage(
  message: HistoryMessage
): VariantHistoryMessage | null {
  if (message.role !== "user" && message.role !== "assistant") return null;
  const mediaIds = message.media.flatMap((item) => {
    if (!isRecord(item)) return [];
    const id = stringValue(item.asset_id);
    const type = stringValue(item.type);
    return id && (type === "image" || type === "video") ? [{ id, type }] : [];
  });
  const imageAssetIds = unique([
    ...stringArray(message.metadata.image_asset_ids),
    ...mediaIds.filter((item) => item.type === "image").map((item) => item.id),
  ]);
  const videoAssetIds = unique([
    ...stringArray(message.metadata.video_asset_ids),
    ...mediaIds.filter((item) => item.type === "video").map((item) => item.id),
  ]);
  const multiImageMode = stringValue(message.metadata.multi_image_mode);
  const restored: VariantHistoryMessage = {
    role: message.role,
    text: message.content ?? "",
    imageAssetIds,
    videoAssetIds,
  };
  if (multiImageMode && MULTI_SCREENSHOT_MODES.has(multiImageMode)) {
    restored.multiImageMode = multiImageMode as MultiScreenshotMode;
  }
  return restored;
}

function projectDataFromVariant(variant: Variant): HistoryProjectData {
  const normalized = normalizeProjectState(variant);
  return {
    files: Object.fromEntries(
      Object.entries(normalized.files).map(([path, file]) => [
        path,
        {
          path,
          content: file.content,
          language: file.language,
          type: file.type,
          ...(file.readonly === undefined ? {} : { readonly: file.readonly }),
          ...(file.generated === undefined ? {} : { generated: file.generated }),
          ...(file.metadata === undefined ? {} : { metadata: { ...file.metadata } }),
        },
      ])
    ),
    entryPoint: normalized.entryPoint,
    activeFilePath: normalized.activeFilePath,
    ...(normalized.generationTargetPath
      ? { generationTargetPath: normalized.generationTargetPath }
      : {}),
  };
}

function projectFilesFromHistory(projectData: HistoryProjectData): ProjectFileMap {
  return Object.fromEntries(
    Object.entries(projectData.files).map(([path, file]) => {
      const metadata = projectFileMetadata(file.metadata);
      const language = FILE_LANGUAGES.has(file.language as ProjectFileLanguage)
        ? (file.language as ProjectFileLanguage)
        : undefined;
      const type = FILE_TYPES.has(file.type as ProjectFileType)
        ? (file.type as ProjectFileType)
        : undefined;
      return [
        path,
        createProjectFile(path, file.content, {
          ...(language ? { language } : {}),
          ...(type ? { type } : {}),
          ...(file.readonly === undefined ? {} : { readonly: file.readonly }),
          ...(file.generated === undefined ? {} : { generated: file.generated }),
          ...(metadata ? { metadata } : {}),
        }),
      ];
    })
  );
}

function variantMetadata(variant: Variant): HistoryJsonObject {
  return {
    stack: variant.stack ?? null,
    thinking: variant.thinking ?? null,
    thinking_start_time: variant.thinkingStartTime ?? null,
    thinking_duration: variant.thinkingDuration ?? null,
    request_started_at: variant.requestStartedAt ?? null,
    agent_events: (variant.agentEvents ?? []).map(serializeAgentEvent),
  };
}

function variantToHistoryInput(
  commit: Commit,
  variant: Variant,
  index: number
): HistoryVariantInput {
  const normalized = normalizeProjectState(variant);
  const durationMs =
    variant.requestStartedAt !== undefined && variant.completedAt !== undefined
      ? Math.max(0, variant.completedAt - variant.requestStartedAt)
      : null;
  return {
    index,
    model: variant.model ?? null,
    status: variant.status ?? "complete",
    code: normalized.code,
    currentContent: getProjectGenerationContent(normalized),
    createdAt: commit.dateCreated,
    startedAt: toIsoTimestamp(variant.requestStartedAt) ?? null,
    completedAt: toIsoTimestamp(variant.completedAt) ?? null,
    durationMs,
    error: variant.errorMessage ?? null,
    metadata: variantMetadata(variant),
    projectData: projectDataFromVariant(normalized),
    messages: variant.history.map((message, messageIndex) => ({
      id: `${commit.hash}:${index}:message:${messageIndex}`,
      role: message.role,
      content: message.text,
      media: [
        ...message.imageAssetIds.map((assetId) => ({
          asset_id: assetId,
          type: "image",
        })),
        ...message.videoAssetIds.map((assetId) => ({
          asset_id: assetId,
          type: "video",
        })),
      ],
      metadata: {
        image_asset_ids: [...message.imageAssetIds],
        video_asset_ids: [...message.videoAssetIds],
        ...(message.multiImageMode
          ? { multi_image_mode: message.multiImageMode }
          : {}),
      },
    })),
  };
}

export function commitToHistoryVersion(
  commit: Commit,
  state: ProjectHistorySnapshotState
): HistoryVersionInput {
  const registry = createAssetRegistry(state);
  const prompt =
    commit.type === "code_create" ? null : serializePrompt(commit.inputs, registry);
  return {
    id: commit.hash,
    commitHash: commit.hash,
    parentCommitId: commit.parentHash,
    retryOfCommitId: commit.retryOfHash ?? null,
    versionType: commit.retryOfHash ? "retry" : commit.type,
    inputs: prompt ? { prompt } : {},
    promptMetadata:
      prompt && commit.type !== "code_create"
        ? { multi_image_mode: commit.inputs.multiImageMode ?? null }
        : {},
    metadata: {
      app_commit_type: commit.type,
      selected_variant_index: commit.selectedVariantIndex,
      ...(commit.generationContext
        ? { generation_context: serializeGenerationContext(commit.generationContext) }
        : {}),
    },
    createdAt: commit.dateCreated,
    prompts: prompt
      ? [
          {
            id: `${commit.hash}:prompt:0`,
            role: "user",
            kind: commit.type,
            content: prompt,
            createdAt: commit.dateCreated,
          },
        ]
      : [],
    variants: commit.variants.map((variant, index) =>
      variantToHistoryInput(commit, variant, index)
    ),
  };
}

function serializeDraftVariant(variant: Variant): HistoryJsonObject {
  const normalized = normalizeProjectState(variant);
  const files: HistoryJsonObject = {};
  for (const [path, file] of Object.entries(normalized.files)) {
    const serializedFile: HistoryJsonObject = {
      path,
      content: file.content,
      language: file.language,
      type: file.type,
    };
    optionalJson(serializedFile, "readonly", file.readonly);
    optionalJson(serializedFile, "generated", file.generated);
    optionalJson(serializedFile, "metadata", file.metadata);
    files[path] = serializedFile;
  }

  return {
    code: normalized.code,
    files,
    entry_point: normalized.entryPoint,
    active_file_path: normalized.activeFilePath,
    generation_target_path: normalized.generationTargetPath ?? null,
    history: normalized.history.map(serializeVariantHistoryMessage),
    request_started_at: normalized.requestStartedAt ?? null,
    completed_at: normalized.completedAt ?? null,
    status: normalized.status ?? "complete",
    error_message: normalized.errorMessage ?? null,
    thinking: normalized.thinking ?? null,
    thinking_start_time: normalized.thinkingStartTime ?? null,
    thinking_duration: normalized.thinkingDuration ?? null,
    agent_events: (normalized.agentEvents ?? []).map(serializeAgentEvent),
    model: normalized.model ?? null,
    stack: normalized.stack ?? null,
  };
}

function serializeDraftCommit(
  commit: Commit,
  registry: AssetRegistry
): HistoryJsonObject {
  return {
    hash: commit.hash,
    parent_hash: commit.parentHash,
    retry_of_hash: commit.retryOfHash ?? null,
    generation_context: commit.generationContext
      ? serializeGenerationContext(commit.generationContext)
      : null,
    date_created: commit.dateCreated.toISOString(),
    type: commit.type,
    selected_variant_index: commit.selectedVariantIndex,
    inputs:
      commit.type === "code_create"
        ? null
        : serializePrompt(commit.inputs, registry),
    variants: commit.variants.map(serializeDraftVariant),
  };
}

function activeSelectionMetadata(
  state: ProjectHistorySnapshotState
): HistoryJsonValue {
  if (!state.head) return null;
  const commit = state.commits[state.head];
  if (!commit) return null;
  const variant = commit.variants[commit.selectedVariantIndex];
  return {
    commit_hash: commit.hash,
    variant_index: commit.selectedVariantIndex,
    active_file_path: variant
      ? normalizeProjectState(variant).activeFilePath
      : null,
  };
}

function buildProjectMetadata(
  state: ProjectHistorySnapshotState,
  registry: AssetRegistry
): HistoryJsonObject {
  const draft = state.latestCommitHash
    ? state.commits[state.latestCommitHash]
    : undefined;
  const mutableDraft = draft && !draft.isCommitted ? draft : null;
  const referenceType: PromptAssetType =
    state.inputMode === "video" ? "video" : "image";
  return {
    [HISTORY_APP_METADATA_KEY]: {
      schema_version: HISTORY_APP_METADATA_VERSION,
      initial_prompt: state.initialPrompt,
      multi_screenshot_mode: state.multiScreenshotMode,
      reference_asset_ids: assetIdsForUrls(
        registry,
        referenceType,
        state.referenceImages
      ),
      assets_by_id: serializeAssets(registry.assetsById),
      latest_commit_hash: state.latestCommitHash,
      selected_commit_hash: state.head,
      active_selection: activeSelectionMetadata(state),
      draft_commit: mutableDraft
        ? serializeDraftCommit(mutableDraft, registry)
        : null,
    },
  };
}

export function buildHistoryProjectSnapshot(
  state: ProjectHistorySnapshotState,
  commit?: Commit
): HistoryProjectSnapshotRequest {
  const registry = createAssetRegistry(state);
  return {
    title: state.projectTitle.trim() || "Untitled project",
    stack: state.projectStack,
    inputMode: state.inputMode,
    metadata: buildProjectMetadata(state, registry),
    createdAt: state.projectCreatedAt,
    ...(commit
      ? {
          version: commitToHistoryVersion(commit, {
            ...state,
            assetsById: registry.assetsById,
          }),
          setAsHead: true,
          selectCommit: false,
        }
      : {}),
  };
}

function parseStoredFiles(value: unknown): ProjectFileMap {
  if (!isRecord(value)) return {};
  const files: ProjectFileMap = {};
  for (const [mapPath, rawFile] of Object.entries(value)) {
    if (!isRecord(rawFile)) continue;
    const path = stringValue(rawFile.path) ?? mapPath;
    const content = stringValue(rawFile.content) ?? "";
    const languageValue = stringValue(rawFile.language);
    const typeValue = stringValue(rawFile.type);
    const metadataValue = projectFileMetadata(rawFile.metadata);
    files[path] = createProjectFile(path, content, {
      ...(languageValue && FILE_LANGUAGES.has(languageValue as ProjectFileLanguage)
        ? { language: languageValue as ProjectFileLanguage }
        : {}),
      ...(typeValue && FILE_TYPES.has(typeValue as ProjectFileType)
        ? { type: typeValue as ProjectFileType }
        : {}),
      ...(typeof rawFile.readonly === "boolean"
        ? { readonly: rawFile.readonly }
        : {}),
      ...(typeof rawFile.generated === "boolean"
        ? { generated: rawFile.generated }
        : {}),
      ...(metadataValue ? { metadata: metadataValue } : {}),
    });
  }
  return files;
}

function normalizeVariantStatus(value: unknown): VariantStatus {
  if (typeof value === "string" && VARIANT_STATUSES.has(value)) {
    return value as VariantStatus;
  }
  if (value === "completed") return "complete";
  if (value === "failed") return "error";
  return "complete";
}

function parseDraftVariant(value: unknown): Variant {
  const raw = isRecord(value) ? value : {};
  const history = Array.isArray(raw.history)
    ? raw.history
        .map(parseVariantHistoryMessage)
        .filter((message): message is VariantHistoryMessage => message !== null)
    : [];
  const base = normalizeProjectState({
    code: stringValue(raw.code) ?? "",
    files: parseStoredFiles(raw.files),
    entryPoint: stringValue(raw.entry_point),
    activeFilePath: stringValue(raw.active_file_path),
    generationTargetPath: stringValue(raw.generation_target_path),
  });
  const stack = stringValue(raw.stack);
  const requestStartedAt = numberValue(raw.request_started_at);
  const completedAt = numberValue(raw.completed_at);
  const errorMessage = stringValue(raw.error_message);
  const thinking = stringValue(raw.thinking);
  const thinkingStartTime = numberValue(raw.thinking_start_time);
  const thinkingDuration = numberValue(raw.thinking_duration);
  const model = stringValue(raw.model);
  return {
    ...base,
    history,
    status: normalizeVariantStatus(raw.status),
    ...(requestStartedAt === undefined ? {} : { requestStartedAt }),
    ...(completedAt === undefined ? {} : { completedAt }),
    ...(errorMessage === undefined ? {} : { errorMessage }),
    ...(thinking === undefined ? {} : { thinking }),
    ...(thinkingStartTime === undefined ? {} : { thinkingStartTime }),
    ...(thinkingDuration === undefined ? {} : { thinkingDuration }),
    agentEvents: parseAgentEvents(raw.agent_events),
    ...(model === undefined ? {} : { model }),
    ...(stack && STACKS.has(stack) ? { stack: stack as Stack } : {}),
  };
}

function commitTypeFromValue(
  value: unknown,
  fallback: string,
  parentHash: string | null
): CommitType {
  if (typeof value === "string" && COMMIT_TYPES.has(value)) {
    return value as CommitType;
  }
  if (fallback === "code_create") return "code_create";
  if (fallback === "ai_create" || fallback === "create") return "ai_create";
  return parentHash ? "ai_edit" : "ai_create";
}

function buildCommit(
  base: Omit<Commit, "type" | "inputs">,
  type: CommitType,
  prompt: PromptContent | null
): Commit {
  if (type === "code_create") return { ...base, type, inputs: null };
  return {
    ...base,
    type,
    inputs: prompt ?? { text: "", images: [], videos: [] },
  };
}

function parseDraftCommit(
  value: unknown,
  assetsById: Record<string, PromptAsset>
): Commit | null {
  if (!isRecord(value)) return null;
  const hash = stringValue(value.hash);
  const variants = Array.isArray(value.variants)
    ? value.variants.map(parseDraftVariant)
    : [];
  if (!hash || variants.length === 0) return null;
  const parentHash = stringValue(value.parent_hash) ?? null;
  const selectedIndex = Math.min(
    Math.max(0, numberValue(value.selected_variant_index) ?? 0),
    variants.length - 1
  );
  const dateCreated = new Date(stringValue(value.date_created) ?? "");
  const type = commitTypeFromValue(value.type, "", parentHash);
  return buildCommit(
    {
      hash,
      parentHash,
      retryOfHash: stringValue(value.retry_of_hash) ?? null,
      generationContext: parseGenerationContext(value.generation_context),
      dateCreated: Number.isNaN(dateCreated.getTime()) ? new Date(0) : dateCreated,
      isCommitted: false,
      variants,
      selectedVariantIndex: selectedIndex,
    },
    type,
    value.inputs === null ? null : parsePrompt(value.inputs, assetsById)
  );
}

function variantFromHistory(variant: HistoryVariant): Variant {
  const project = variant.projectData
    ? normalizeProjectState({
        code: variant.code ?? "",
        files: projectFilesFromHistory(variant.projectData),
        entryPoint: variant.projectData.entryPoint,
        activeFilePath: variant.projectData.activeFilePath,
        generationTargetPath: variant.projectData.generationTargetPath,
      })
    : normalizeProjectState({ code: variant.currentContent ?? variant.code ?? "" });
  const stack = stringValue(variant.metadata.stack);
  const requestStartedAt =
    numberValue(variant.metadata.request_started_at) ?? variant.startedAt?.getTime();
  const completedAt = variant.completedAt?.getTime();
  const thinkingStartTime = numberValue(variant.metadata.thinking_start_time);
  const thinkingDuration = numberValue(variant.metadata.thinking_duration);
  const thinking = stringValue(variant.metadata.thinking);
  return {
    ...project,
    history: variant.messages
      .map(historyMessageToVariantMessage)
      .filter((message): message is VariantHistoryMessage => message !== null),
    status: normalizeVariantStatus(variant.status),
    ...(requestStartedAt === undefined ? {} : { requestStartedAt }),
    ...(completedAt === undefined ? {} : { completedAt }),
    ...(variant.error === null ? {} : { errorMessage: variant.error }),
    ...(thinking === undefined ? {} : { thinking }),
    ...(thinkingStartTime === undefined ? {} : { thinkingStartTime }),
    ...(thinkingDuration === undefined ? {} : { thinkingDuration }),
    agentEvents: parseAgentEvents(variant.metadata.agent_events),
    ...(variant.model === null ? {} : { model: variant.model }),
    ...(stack && STACKS.has(stack) ? { stack: stack as Stack } : {}),
  };
}

function historyCommitToCommit(
  commit: HistoryCommit,
  assetsById: Record<string, PromptAsset>
): Commit | null {
  const variantsByIndex = new Map(
    commit.variants.map((variant) => [variant.index, variantFromHistory(variant)])
  );
  if (variantsByIndex.size === 0) return null;
  const maxIndex = Math.max(...variantsByIndex.keys());
  const variants = Array.from({ length: maxIndex + 1 }, (_, index) =>
    variantsByIndex.get(index) ??
    normalizeProjectState({
      code: "",
      history: [],
      status: "error" as VariantStatus,
      errorMessage: "This saved option is unavailable.",
    })
  );
  const parentHash = commit.parentCommitId;
  const selectedIndex = Math.min(
    Math.max(0, numberValue(commit.metadata.selected_variant_index) ?? 0),
    variants.length - 1
  );
  const type = commitTypeFromValue(
    commit.metadata.app_commit_type,
    commit.versionType,
    parentHash
  );
  const promptValue = isRecord(commit.inputs.prompt)
    ? commit.inputs.prompt
    : commit.inputs;
  return buildCommit(
    {
      hash: commit.id,
      parentHash,
      retryOfHash: commit.retryOfCommitId,
      generationContext: parseGenerationContext(
        commit.metadata.generation_context
      ),
      dateCreated: commit.createdAt,
      isCommitted: true,
      variants,
      selectedVariantIndex: selectedIndex,
    },
    type,
    type === "code_create" ? null : parsePrompt(promptValue, assetsById)
  );
}

function appMetadata(project: HistoryProject | HistoryProjectSummary): UnknownRecord {
  const value = project.metadata[HISTORY_APP_METADATA_KEY];
  return isRecord(value) ? value : {};
}

function applyActiveSelection(
  commits: Record<string, Commit>,
  metadata: UnknownRecord
): void {
  const selection = metadata.active_selection;
  if (!isRecord(selection)) return;
  const commitHash = stringValue(selection.commit_hash);
  const variantIndex = numberValue(selection.variant_index);
  const activeFilePath = stringValue(selection.active_file_path);
  if (!commitHash || variantIndex === undefined || !activeFilePath) return;
  const commit = commits[commitHash];
  const variant = commit?.variants[variantIndex];
  if (!commit || !variant) return;
  const normalized = normalizeProjectState({ ...variant, activeFilePath });
  commit.variants = commit.variants.map((item, index) =>
    index === variantIndex ? normalized : item
  );
}

function interruptGeneratingVariants(
  commit: Commit,
  restoredAt: number
): boolean {
  let interrupted = false;
  commit.variants = commit.variants.map((variant) => {
    if (variant.status !== "generating") return variant;
    interrupted = true;
    return {
      ...variant,
      status: "cancelled",
      completedAt: variant.completedAt ?? restoredAt,
      errorMessage: variant.errorMessage ?? INTERRUPTED_GENERATION_MESSAGE,
      agentEvents: (variant.agentEvents ?? []).map((event) =>
        event.status === "running"
          ? { ...event, status: "error", endedAt: event.endedAt ?? restoredAt }
          : event
      ),
    };
  });
  return interrupted;
}

export function restoreHistoryProject(
  project: HistoryProject,
  options: { restoredAt?: number } = {}
): RestoredProjectHistoryState {
  const metadata = appMetadata(project);
  const assetsById = parseAssets(metadata.assets_by_id);
  const commits: Record<string, Commit> = {};
  for (const storedCommit of project.commits) {
    const commit = historyCommitToCommit(storedCommit, assetsById);
    if (commit) commits[commit.hash] = commit;
  }

  const draft = parseDraftCommit(metadata.draft_commit, assetsById);
  let interruptedGeneration = false;
  if (draft) {
    interruptedGeneration = interruptGeneratingVariants(
      draft,
      options.restoredAt ?? Date.now()
    );
    commits[draft.hash] = draft;
  }

  applyActiveSelection(commits, metadata);
  const hashes = new Set(Object.keys(commits));
  const metadataLatest = stringValue(metadata.latest_commit_hash);
  const fallbackLatest = Object.values(commits)
    .sort((left, right) => left.dateCreated.getTime() - right.dateCreated.getTime())
    .at(-1)?.hash ?? null;
  const latestCommitHash =
    (metadataLatest && hashes.has(metadataLatest) ? metadataLatest : null) ??
    (draft?.hash ?? null) ??
    (project.headCommitId && hashes.has(project.headCommitId)
      ? project.headCommitId
      : null) ??
    fallbackLatest;
  const metadataSelected = stringValue(metadata.selected_commit_hash);
  const head =
    (metadataSelected && hashes.has(metadataSelected) ? metadataSelected : null) ??
    (project.selectedCommitId && hashes.has(project.selectedCommitId)
      ? project.selectedCommitId
      : null) ??
    latestCommitHash;

  if (
    head &&
    project.selectedCommitId === head &&
    project.selectedVariantIndex !== null
  ) {
    const commit = commits[head];
    if (commit && project.selectedVariantIndex < commit.variants.length) {
      commit.selectedVariantIndex = project.selectedVariantIndex;
    }
  }

  const inputMode = INPUT_MODES.has(project.inputMode ?? "")
    ? (project.inputMode as InputMode)
    : "image";
  const multiScreenshotMode = stringValue(metadata.multi_screenshot_mode);
  const projectStack =
    project.stack && STACKS.has(project.stack)
      ? (project.stack as Stack)
      : Stack.HTML_TAILWIND;
  const referenceType: PromptAssetType =
    inputMode === "video" ? "video" : "image";

  return {
    projectId: project.id,
    projectTitle: project.title,
    projectCreatedAt: project.createdAt,
    projectStack,
    inputMode,
    referenceImages: resolveAssetIds(
      stringArray(metadata.reference_asset_ids),
      assetsById,
      referenceType
    ),
    initialPrompt: stringValue(metadata.initial_prompt) ?? "",
    multiScreenshotMode:
      multiScreenshotMode && MULTI_SCREENSHOT_MODES.has(multiScreenshotMode)
        ? (multiScreenshotMode as MultiScreenshotMode)
        : "pages",
    assetsById,
    commits,
    head,
    latestCommitHash,
    interruptedGeneration,
  };
}

function hasDraft(summary: HistoryProjectSummary): boolean {
  return isRecord(appMetadata(summary).draft_commit);
}

export function toRecentHistoryProject(
  project: HistoryProjectSummary
): RecentHistoryProject {
  return {
    id: project.id,
    title: project.title,
    stack: project.stack,
    inputMode: project.inputMode,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    versionCount: project.commitCount + (hasDraft(project) ? 1 : 0),
  };
}

export function getUnpersistedCommittedCommits(
  state: ProjectHistorySnapshotState,
  persistedCommitIds: ReadonlySet<string>
): Commit[] {
  const remaining = Object.values(state.commits)
    .filter(
      (commit) => commit.isCommitted && !persistedCommitIds.has(commit.hash)
    )
    .sort(
      (left, right) => left.dateCreated.getTime() - right.dateCreated.getTime()
    );
  const ordered: Commit[] = [];
  const available = new Set(persistedCommitIds);

  while (remaining.length > 0) {
    const index = remaining.findIndex(
      (commit) => !commit.parentHash || available.has(commit.parentHash)
    );
    const [next] = remaining.splice(index >= 0 ? index : 0, 1);
    ordered.push(next);
    available.add(next.hash);
  }
  return ordered;
}

export function buildHistorySelectionUpdate(
  state: ProjectHistorySnapshotState,
  persistedCommitIds: ReadonlySet<string>
): HistorySelectionUpdateRequest {
  const persistedCommits = Object.values(state.commits)
    .filter((commit) => persistedCommitIds.has(commit.hash))
    .sort(
      (left, right) => left.dateCreated.getTime() - right.dateCreated.getTime()
    );
  const latestPersisted =
    state.latestCommitHash && persistedCommitIds.has(state.latestCommitHash)
      ? state.latestCommitHash
      : persistedCommits.at(-1)?.hash ?? null;
  const selectedCommitId =
    state.head && persistedCommitIds.has(state.head) ? state.head : null;
  return {
    headCommitId: latestPersisted,
    selectedCommitId,
    selectedVariantIndex: selectedCommitId
      ? state.commits[selectedCommitId]?.selectedVariantIndex ?? null
      : null,
  };
}

export function deriveProjectTitle({
  prompt,
  inputMode,
  referenceCount = 0,
  importedName,
}: {
  prompt?: string;
  inputMode: InputMode | "import";
  referenceCount?: number;
  importedName?: string;
}): string {
  const candidate = (importedName ?? prompt ?? "").replace(/\s+/g, " ").trim();
  if (candidate) {
    return candidate.length > 72
      ? `${candidate.slice(0, 69).trimEnd()}...`
      : candidate;
  }
  if (inputMode === "import") return "Imported project";
  if (inputMode === "video") return "Video project";
  if (inputMode === "image") {
    return referenceCount > 1
      ? `${referenceCount} screenshot project`
      : "Screenshot project";
  }
  return "Text project";
}
