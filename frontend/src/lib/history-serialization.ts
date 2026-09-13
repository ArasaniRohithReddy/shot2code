import type {
  HistoryAppendVersionRequest,
  HistoryCommit,
  HistoryHealth,
  HistoryJsonObject,
  HistoryJsonValue,
  HistoryMessage,
  HistoryMessageInput,
  HistoryProject,
  HistoryProjectData,
  HistoryProjectFile,
  HistoryProjectFileMap,
  HistoryProjectList,
  HistoryProjectSnapshotRequest,
  HistoryProjectSummary,
  HistoryPrompt,
  HistoryPromptInput,
  HistorySelectionUpdateRequest,
  HistoryTimestampInput,
  HistoryVariant,
  HistoryVariantInput,
  HistoryVersionInput,
} from "./history-types";

export const HISTORY_PROJECT_DATA_METADATA_KEY = "project_data";

export interface HistoryMessageInputPayload {
  id?: string | null;
  role: string;
  content: string | null;
  media: HistoryJsonObject[];
  metadata: HistoryJsonObject;
  created_at?: string | null;
}

export interface HistoryPromptInputPayload {
  id?: string | null;
  role: string;
  kind: string;
  content: HistoryJsonValue;
  metadata: HistoryJsonObject;
  created_at?: string | null;
}

export interface HistoryVariantInputPayload {
  index: number;
  model?: string | null;
  status: string;
  code?: string | null;
  current_content?: string | null;
  created_at?: string | null;
  started_at?: string | null;
  completed_at?: string | null;
  duration_ms?: number | null;
  error?: string | null;
  metadata: HistoryJsonObject;
  messages: HistoryMessageInputPayload[];
}

export interface HistoryVersionInputPayload {
  id: string;
  commit_hash?: string | null;
  parent_commit_id?: string | null;
  retry_of_commit_id?: string | null;
  version_type: string;
  inputs: HistoryJsonObject;
  prompt_metadata: HistoryJsonObject;
  metadata: HistoryJsonObject;
  created_at?: string | null;
  prompts: HistoryPromptInputPayload[];
  variants: HistoryVariantInputPayload[];
}

export interface HistoryAppendVersionPayload {
  version: HistoryVersionInputPayload;
  set_as_head: boolean;
  select_commit: boolean;
  selected_variant_index?: number | null;
}

export interface HistoryProjectSnapshotPayload {
  title: string;
  stack?: string | null;
  input_mode?: string | null;
  metadata: HistoryJsonObject;
  created_at?: string | null;
  version?: HistoryVersionInputPayload | null;
  set_as_head: boolean;
  select_commit: boolean;
  selected_variant_index?: number | null;
}

export interface HistorySelectionUpdatePayload {
  head_commit_id?: string | null;
  selected_commit_id?: string | null;
  selected_variant_index?: number | null;
}

type UnknownRecord = Record<string, unknown>;

export class HistoryPayloadError extends Error {
  readonly path: string;

  constructor(path: string, message: string) {
    super(`${path}: ${message}`);
    this.name = "HistoryPayloadError";
    this.path = path;
  }
}

function fail(path: string, message: string): never {
  throw new HistoryPayloadError(path, message);
}

function isRecord(value: unknown): value is UnknownRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function requireRecord(value: unknown, path: string): UnknownRecord {
  if (!isRecord(value)) fail(path, "must be an object");
  return value;
}

function hasOwn(record: UnknownRecord, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function requireString(
  value: unknown,
  path: string,
  { minLength = 0, maxLength }: { minLength?: number; maxLength?: number } = {}
): string {
  if (typeof value !== "string") fail(path, "must be a string");
  if (value.length < minLength) {
    fail(path, `must contain at least ${minLength} character${minLength === 1 ? "" : "s"}`);
  }
  if (maxLength !== undefined && value.length > maxLength) {
    fail(path, `must contain at most ${maxLength} characters`);
  }
  return value;
}

function requireNullableString(
  value: unknown,
  path: string,
  options: { minLength?: number; maxLength?: number } = {}
): string | null {
  if (value === null) return null;
  return requireString(value, path, options);
}

function requireBoolean(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") fail(path, "must be a boolean");
  return value;
}

function requireNonNegativeInteger(value: unknown, path: string): number {
  if (!Number.isInteger(value) || (value as number) < 0) {
    fail(path, "must be a non-negative integer");
  }
  return value as number;
}

function requirePositiveInteger(value: unknown, path: string): number {
  const result = requireNonNegativeInteger(value, path);
  if (result < 1) fail(path, "must be a positive integer");
  return result;
}

function validateJsonValue(
  value: unknown,
  path: string,
  ancestors: Set<object>
): asserts value is HistoryJsonValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) fail(path, "must contain only finite numbers");
    return;
  }
  if (Array.isArray(value)) {
    if (ancestors.has(value)) fail(path, "must not contain circular references");
    ancestors.add(value);
    value.forEach((item, index) =>
      validateJsonValue(item, `${path}[${index}]`, ancestors)
    );
    ancestors.delete(value);
    return;
  }
  if (isRecord(value)) {
    if (ancestors.has(value)) fail(path, "must not contain circular references");
    ancestors.add(value);
    Object.entries(value).forEach(([key, item]) =>
      validateJsonValue(item, `${path}.${key}`, ancestors)
    );
    ancestors.delete(value);
    return;
  }
  fail(path, "must be valid JSON");
}

function requireJsonValue(value: unknown, path: string): HistoryJsonValue {
  validateJsonValue(value, path, new Set<object>());
  return value;
}

function requireJsonObject(value: unknown, path: string): HistoryJsonObject {
  const record = requireRecord(value, path);
  validateJsonValue(record, path, new Set<object>());
  return record as HistoryJsonObject;
}

function requireArray(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) fail(path, "must be an array");
  return value;
}

function serializeTimestamp(value: unknown, path: string): string | null {
  if (value === null) return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) fail(path, "must be a valid date");
    return value.toISOString();
  }
  const timestamp = requireString(value, path, { minLength: 1 });
  if (!/(?:z|[+-]\d{2}:\d{2})$/i.test(timestamp)) {
    fail(path, "must include a timezone");
  }
  if (Number.isNaN(Date.parse(timestamp))) fail(path, "must be a valid timestamp");
  return timestamp;
}

function parseTimestamp(value: unknown, path: string): Date {
  const timestamp = requireString(value, path, { minLength: 1 });
  if (!/(?:z|[+-]\d{2}:\d{2})$/i.test(timestamp)) {
    fail(path, "must include a timezone");
  }
  const parsed = new Date(timestamp);
  if (Number.isNaN(parsed.getTime())) fail(path, "must be a valid timestamp");
  return parsed;
}

function parseNullableTimestamp(value: unknown, path: string): Date | null {
  return value === null ? null : parseTimestamp(value, path);
}

function requireIdentifier(value: unknown, path: string): string {
  const identifier = requireString(value, path, {
    minLength: 1,
    maxLength: 512,
  }).trim();
  if (!identifier) fail(path, "must not be blank");
  return identifier;
}

function serializeOptionalTimestamp(
  record: UnknownRecord,
  key: string,
  path: string
): string | null | undefined {
  if (!hasOwn(record, key) || record[key] === undefined) return undefined;
  return serializeTimestamp(record[key], path);
}

function serializeOptionalNullableString(
  record: UnknownRecord,
  key: string,
  path: string,
  options: { minLength?: number; maxLength?: number } = {}
): string | null | undefined {
  if (!hasOwn(record, key) || record[key] === undefined) return undefined;
  return requireNullableString(record[key], path, options);
}

function serializeProjectFile(value: unknown, path: string): HistoryJsonObject {
  const file = requireRecord(value, path);
  const payload: HistoryJsonObject = {
    path: requireString(file.path, `${path}.path`, { minLength: 1 }),
    content: requireString(file.content, `${path}.content`),
    language: requireString(file.language, `${path}.language`, { minLength: 1 }),
    type: requireString(file.type, `${path}.type`, { minLength: 1 }),
  };

  if (hasOwn(file, "readonly") && file.readonly !== undefined) {
    payload.readonly = requireBoolean(file.readonly, `${path}.readonly`);
  }
  if (hasOwn(file, "generated") && file.generated !== undefined) {
    payload.generated = requireBoolean(file.generated, `${path}.generated`);
  }
  if (hasOwn(file, "metadata") && file.metadata !== undefined) {
    payload.metadata = requireJsonObject(file.metadata, `${path}.metadata`);
  }
  return payload;
}

function parseProjectFile(value: unknown, path: string): HistoryProjectFile {
  const file = requireRecord(value, path);
  const parsed: HistoryProjectFile = {
    path: requireString(file.path, `${path}.path`, { minLength: 1 }),
    content: requireString(file.content, `${path}.content`),
    language: requireString(file.language, `${path}.language`, {
      minLength: 1,
    }),
    type: requireString(file.type, `${path}.type`, {
      minLength: 1,
    }),
  };

  if (hasOwn(file, "readonly")) {
    parsed.readonly = requireBoolean(file.readonly, `${path}.readonly`);
  }
  if (hasOwn(file, "generated")) {
    parsed.generated = requireBoolean(file.generated, `${path}.generated`);
  }
  if (hasOwn(file, "metadata")) {
    parsed.metadata = requireJsonObject(file.metadata, `${path}.metadata`);
  }
  return parsed;
}

export function serializeHistoryProjectData(
  value: HistoryProjectData
): HistoryJsonObject {
  const project = requireRecord(value as unknown, "projectData");
  const filesRecord = requireRecord(project.files, "projectData.files");
  if (Object.keys(filesRecord).length === 0) {
    fail("projectData.files", "must contain at least one file");
  }

  const files: HistoryJsonObject = {};
  for (const [mapPath, rawFile] of Object.entries(filesRecord)) {
    const file = serializeProjectFile(rawFile, `projectData.files.${mapPath}`);
    if (file.path !== mapPath) {
      fail(`projectData.files.${mapPath}.path`, "must match its file-map key");
    }
    files[mapPath] = file;
  }

  const entryPoint = requireString(project.entryPoint, "projectData.entryPoint", {
    minLength: 1,
  });
  const activeFilePath = requireString(
    project.activeFilePath,
    "projectData.activeFilePath",
    { minLength: 1 }
  );
  if (!hasOwn(filesRecord, entryPoint)) {
    fail("projectData.entryPoint", "must identify a file in projectData.files");
  }
  if (!hasOwn(filesRecord, activeFilePath)) {
    fail(
      "projectData.activeFilePath",
      "must identify a file in projectData.files"
    );
  }

  const payload: HistoryJsonObject = {
    files,
    entry_point: entryPoint,
    active_file_path: activeFilePath,
  };
  if (
    hasOwn(project, "generationTargetPath") &&
    project.generationTargetPath !== undefined
  ) {
    payload.generation_target_path = requireString(
      project.generationTargetPath,
      "projectData.generationTargetPath",
      { minLength: 1 }
    );
  }
  return payload;
}

export function parseHistoryProjectData(value: unknown): HistoryProjectData {
  const project = requireRecord(value, "project_data");
  const rawFiles = requireRecord(project.files, "project_data.files");
  if (Object.keys(rawFiles).length === 0) {
    fail("project_data.files", "must contain at least one file");
  }

  const files: HistoryProjectFileMap = {};
  for (const [mapPath, rawFile] of Object.entries(rawFiles)) {
    const file = parseProjectFile(rawFile, `project_data.files.${mapPath}`);
    if (file.path !== mapPath) {
      fail(`project_data.files.${mapPath}.path`, "must match its file-map key");
    }
    files[mapPath] = file;
  }

  const entryPoint = requireString(project.entry_point, "project_data.entry_point", {
    minLength: 1,
  });
  const activeFilePath = requireString(
    project.active_file_path,
    "project_data.active_file_path",
    { minLength: 1 }
  );
  if (!hasOwn(rawFiles, entryPoint)) {
    fail("project_data.entry_point", "must identify a file in project_data.files");
  }
  if (!hasOwn(rawFiles, activeFilePath)) {
    fail(
      "project_data.active_file_path",
      "must identify a file in project_data.files"
    );
  }

  const parsed: HistoryProjectData = { files, entryPoint, activeFilePath };
  if (
    hasOwn(project, "generation_target_path") &&
    project.generation_target_path !== undefined
  ) {
    parsed.generationTargetPath = requireString(
      project.generation_target_path,
      "project_data.generation_target_path",
      { minLength: 1 }
    );
  }
  return parsed;
}
function serializeMessageAt(
  value: HistoryMessageInput,
  path: string
): HistoryMessageInputPayload {
  const message = requireRecord(value as unknown, path);
  const rawMedia = message.media ?? [];
  const media = requireArray(rawMedia, `${path}.media`).map((item, index) =>
    requireJsonObject(item, `${path}.media[${index}]`)
  );
  const payload: HistoryMessageInputPayload = {
    role: requireString(message.role, `${path}.role`, {
      minLength: 1,
      maxLength: 500,
    }),
    content: hasOwn(message, "content")
      ? requireNullableString(message.content, `${path}.content`)
      : null,
    media,
    metadata: requireJsonObject(message.metadata ?? {}, `${path}.metadata`),
  };

  if (hasOwn(message, "id") && message.id !== undefined) {
    payload.id = requireNullableString(message.id, `${path}.id`, {
      minLength: 1,
      maxLength: 512,
    });
  }
  const createdAt = serializeOptionalTimestamp(
    message,
    "createdAt",
    `${path}.createdAt`
  );
  if (createdAt !== undefined) payload.created_at = createdAt;
  return payload;
}

export function serializeHistoryMessageInput(
  value: HistoryMessageInput
): HistoryMessageInputPayload {
  return serializeMessageAt(value, "message");
}

function serializePromptAt(
  value: HistoryPromptInput,
  path: string
): HistoryPromptInputPayload {
  const prompt = requireRecord(value as unknown, path);
  const payload: HistoryPromptInputPayload = {
    role: requireString(prompt.role ?? "user", `${path}.role`, {
      minLength: 1,
      maxLength: 500,
    }),
    kind: requireString(prompt.kind ?? "generation", `${path}.kind`, {
      minLength: 1,
      maxLength: 500,
    }),
    content: requireJsonValue(prompt.content, `${path}.content`),
    metadata: requireJsonObject(prompt.metadata ?? {}, `${path}.metadata`),
  };

  if (hasOwn(prompt, "id") && prompt.id !== undefined) {
    payload.id = requireNullableString(prompt.id, `${path}.id`, {
      minLength: 1,
      maxLength: 512,
    });
  }
  const createdAt = serializeOptionalTimestamp(
    prompt,
    "createdAt",
    `${path}.createdAt`
  );
  if (createdAt !== undefined) payload.created_at = createdAt;
  return payload;
}

export function serializeHistoryPromptInput(
  value: HistoryPromptInput
): HistoryPromptInputPayload {
  return serializePromptAt(value, "prompt");
}

function serializeVariantAt(
  value: HistoryVariantInput,
  path: string
): HistoryVariantInputPayload {
  const variant = requireRecord(value as unknown, path);
  const rawMetadata = requireJsonObject(
    variant.metadata ?? {},
    `${path}.metadata`
  );
  const metadata =
    variant.projectData === undefined
      ? rawMetadata
      : {
          ...rawMetadata,
          [HISTORY_PROJECT_DATA_METADATA_KEY]: serializeHistoryProjectData(
            variant.projectData as HistoryProjectData
          ),
        };
  const rawMessages = requireArray(variant.messages ?? [], `${path}.messages`);
  const messages = rawMessages.map((message, index) =>
    serializeMessageAt(
      message as HistoryMessageInput,
      `${path}.messages[${index}]`
    )
  );
  const messageIds = messages
    .map((message) => message.id)
    .filter((id): id is string => typeof id === "string");
  if (new Set(messageIds).size !== messageIds.length) {
    fail(`${path}.messages`, "message ids must be unique within a variant");
  }

  const payload: HistoryVariantInputPayload = {
    index: requireNonNegativeInteger(variant.index, `${path}.index`),
    status: requireString(variant.status ?? "completed", `${path}.status`, {
      minLength: 1,
      maxLength: 500,
    }),
    metadata,
    messages,
  };

  const nullableStrings = [
    ["model", "model", 500],
    ["code", "code", undefined],
    ["currentContent", "current_content", undefined],
    ["error", "error", undefined],
  ] as const;
  for (const [sourceKey, targetKey, maxLength] of nullableStrings) {
    const serialized = serializeOptionalNullableString(
      variant,
      sourceKey,
      `${path}.${sourceKey}`,
      maxLength === undefined ? {} : { maxLength }
    );
    if (serialized !== undefined) payload[targetKey] = serialized;
  }

  const timestamps = [
    ["createdAt", "created_at"],
    ["startedAt", "started_at"],
    ["completedAt", "completed_at"],
  ] as const;
  for (const [sourceKey, targetKey] of timestamps) {
    const serialized = serializeOptionalTimestamp(
      variant,
      sourceKey,
      `${path}.${sourceKey}`
    );
    if (serialized !== undefined) payload[targetKey] = serialized;
  }

  if (hasOwn(variant, "durationMs") && variant.durationMs !== undefined) {
    payload.duration_ms =
      variant.durationMs === null
        ? null
        : requireNonNegativeInteger(variant.durationMs, `${path}.durationMs`);
  }
  return payload;
}

export function serializeHistoryVariantInput(
  value: HistoryVariantInput
): HistoryVariantInputPayload {
  return serializeVariantAt(value, "variant");
}

function serializeVersionAt(
  value: HistoryVersionInput,
  path: string
): HistoryVersionInputPayload {
  const version = requireRecord(value as unknown, path);
  const rawPrompts = requireArray(version.prompts ?? [], `${path}.prompts`);
  const prompts = rawPrompts.map((prompt, index) =>
    serializePromptAt(prompt as HistoryPromptInput, `${path}.prompts[${index}]`)
  );
  const promptIds = prompts
    .map((prompt) => prompt.id)
    .filter((id): id is string => typeof id === "string");
  if (new Set(promptIds).size !== promptIds.length) {
    fail(`${path}.prompts`, "prompt ids must be unique within a version");
  }

  const rawVariants = requireArray(version.variants ?? [], `${path}.variants`);
  const variants = rawVariants.map((variant, index) =>
    serializeVariantAt(
      variant as HistoryVariantInput,
      `${path}.variants[${index}]`
    )
  );
  const variantIndexes = variants.map((variant) => variant.index);
  if (new Set(variantIndexes).size !== variantIndexes.length) {
    fail(`${path}.variants`, "variant indexes must be unique within a version");
  }

  const versionType = requireString(
    version.versionType ?? "create",
    `${path}.versionType`,
    { minLength: 1, maxLength: 500 }
  ).toLowerCase();
  const retryOfCommitId = serializeOptionalNullableString(
    version,
    "retryOfCommitId",
    `${path}.retryOfCommitId`,
    { minLength: 1, maxLength: 512 }
  );
  if (versionType === "retry" && retryOfCommitId == null) {
    fail(`${path}.retryOfCommitId`, "is required for retry versions");
  }

  const payload: HistoryVersionInputPayload = {
    id: requireIdentifier(version.id, `${path}.id`),
    version_type: versionType,
    inputs: requireJsonObject(version.inputs ?? {}, `${path}.inputs`),
    prompt_metadata: requireJsonObject(
      version.promptMetadata ?? {},
      `${path}.promptMetadata`
    ),
    metadata: requireJsonObject(version.metadata ?? {}, `${path}.metadata`),
    prompts,
    variants,
  };

  const commitHash = serializeOptionalNullableString(
    version,
    "commitHash",
    `${path}.commitHash`,
    { maxLength: 500 }
  );
  if (commitHash !== undefined) payload.commit_hash = commitHash;
  const parentCommitId = serializeOptionalNullableString(
    version,
    "parentCommitId",
    `${path}.parentCommitId`,
    { minLength: 1, maxLength: 512 }
  );
  if (parentCommitId !== undefined) payload.parent_commit_id = parentCommitId;
  if (retryOfCommitId !== undefined) {
    payload.retry_of_commit_id = retryOfCommitId;
  }
  const createdAt = serializeOptionalTimestamp(
    version,
    "createdAt",
    `${path}.createdAt`
  );
  if (createdAt !== undefined) payload.created_at = createdAt;
  return payload;
}

export function serializeHistoryVersionInput(
  value: HistoryVersionInput
): HistoryVersionInputPayload {
  return serializeVersionAt(value, "version");
}

export function serializeHistoryAppendVersionRequest(
  value: HistoryAppendVersionRequest
): HistoryAppendVersionPayload {
  const request = requireRecord(value as unknown, "appendVersion");
  const selectCommit =
    request.selectCommit === undefined
      ? true
      : requireBoolean(request.selectCommit, "appendVersion.selectCommit");
  const payload: HistoryAppendVersionPayload = {
    version: serializeVersionAt(
      request.version as HistoryVersionInput,
      "appendVersion.version"
    ),
    set_as_head:
      request.setAsHead === undefined
        ? true
        : requireBoolean(request.setAsHead, "appendVersion.setAsHead"),
    select_commit: selectCommit,
  };
  if (
    hasOwn(request, "selectedVariantIndex") &&
    request.selectedVariantIndex !== undefined
  ) {
    payload.selected_variant_index =
      request.selectedVariantIndex === null
        ? null
        : requireNonNegativeInteger(
            request.selectedVariantIndex,
            "appendVersion.selectedVariantIndex"
          );
  }
  if (!selectCommit && payload.selected_variant_index != null) {
    fail(
      "appendVersion.selectedVariantIndex",
      "requires selectCommit to be true"
    );
  }
  return payload;
}

export function serializeHistoryProjectSnapshotRequest(
  value: HistoryProjectSnapshotRequest
): HistoryProjectSnapshotPayload {
  const request = requireRecord(value as unknown, "projectSnapshot");
  const selectCommit =
    request.selectCommit === undefined
      ? true
      : requireBoolean(request.selectCommit, "projectSnapshot.selectCommit");
  const payload: HistoryProjectSnapshotPayload = {
    title: requireString(request.title, "projectSnapshot.title", {
      minLength: 1,
      maxLength: 500,
    }),
    metadata: requireJsonObject(
      request.metadata ?? {},
      "projectSnapshot.metadata"
    ),
    set_as_head:
      request.setAsHead === undefined
        ? true
        : requireBoolean(request.setAsHead, "projectSnapshot.setAsHead"),
    select_commit: selectCommit,
  };

  const stack = serializeOptionalNullableString(
    request,
    "stack",
    "projectSnapshot.stack",
    { maxLength: 500 }
  );
  if (stack !== undefined) payload.stack = stack;
  const inputMode = serializeOptionalNullableString(
    request,
    "inputMode",
    "projectSnapshot.inputMode",
    { maxLength: 500 }
  );
  if (inputMode !== undefined) payload.input_mode = inputMode;
  const createdAt = serializeOptionalTimestamp(
    request,
    "createdAt",
    "projectSnapshot.createdAt"
  );
  if (createdAt !== undefined) payload.created_at = createdAt;
  if (hasOwn(request, "version") && request.version !== undefined) {
    payload.version =
      request.version === null
        ? null
        : serializeVersionAt(
            request.version as HistoryVersionInput,
            "projectSnapshot.version"
          );
  }
  if (
    hasOwn(request, "selectedVariantIndex") &&
    request.selectedVariantIndex !== undefined
  ) {
    payload.selected_variant_index =
      request.selectedVariantIndex === null
        ? null
        : requireNonNegativeInteger(
            request.selectedVariantIndex,
            "projectSnapshot.selectedVariantIndex"
          );
  }
  if (payload.version == null && payload.selected_variant_index != null) {
    fail("projectSnapshot.selectedVariantIndex", "requires a version");
  }
  if (!selectCommit && payload.selected_variant_index != null) {
    fail(
      "projectSnapshot.selectedVariantIndex",
      "requires selectCommit to be true"
    );
  }
  return payload;
}

export function serializeHistorySelectionUpdateRequest(
  value: HistorySelectionUpdateRequest
): HistorySelectionUpdatePayload {
  const request = requireRecord(value as unknown, "selection");
  const payload: HistorySelectionUpdatePayload = {};

  const fields = [
    ["headCommitId", "head_commit_id"],
    ["selectedCommitId", "selected_commit_id"],
  ] as const;
  for (const [sourceKey, targetKey] of fields) {
    if (hasOwn(request, sourceKey) && request[sourceKey] !== undefined) {
      payload[targetKey] = requireNullableString(
        request[sourceKey],
        `selection.${sourceKey}`,
        { minLength: 1, maxLength: 512 }
      );
    }
  }
  if (
    hasOwn(request, "selectedVariantIndex") &&
    request.selectedVariantIndex !== undefined
  ) {
    payload.selected_variant_index =
      request.selectedVariantIndex === null
        ? null
        : requireNonNegativeInteger(
            request.selectedVariantIndex,
            "selection.selectedVariantIndex"
          );
  }
  if (Object.keys(payload).length === 0) {
    fail("selection", "must include at least one selection field");
  }
  return payload;
}
function parseMessageAt(value: unknown, path: string): HistoryMessage {
  const message = requireRecord(value, path);
  return {
    id: requireString(message.id, `${path}.id`),
    position: requireNonNegativeInteger(message.position, `${path}.position`),
    role: requireString(message.role, `${path}.role`),
    content: requireNullableString(message.content, `${path}.content`),
    media: requireArray(message.media, `${path}.media`).map((item, index) =>
      requireJsonValue(item, `${path}.media[${index}]`)
    ),
    metadata: requireJsonObject(message.metadata, `${path}.metadata`),
    createdAt: parseTimestamp(message.created_at, `${path}.created_at`),
  };
}

function parsePromptAt(value: unknown, path: string): HistoryPrompt {
  const prompt = requireRecord(value, path);
  return {
    id: requireString(prompt.id, `${path}.id`),
    position: requireNonNegativeInteger(prompt.position, `${path}.position`),
    role: requireString(prompt.role, `${path}.role`),
    kind: requireString(prompt.kind, `${path}.kind`),
    content: requireJsonValue(prompt.content, `${path}.content`),
    metadata: requireJsonObject(prompt.metadata, `${path}.metadata`),
    createdAt: parseTimestamp(prompt.created_at, `${path}.created_at`),
  };
}

function parseVariantAt(value: unknown, path: string): HistoryVariant {
  const variant = requireRecord(value, path);
  const rawMetadata = requireJsonObject(variant.metadata, `${path}.metadata`);
  let projectData: HistoryProjectData | undefined;
  if (hasOwn(rawMetadata, HISTORY_PROJECT_DATA_METADATA_KEY)) {
    projectData = parseHistoryProjectData(
      rawMetadata[HISTORY_PROJECT_DATA_METADATA_KEY]
    );
  }

  const parsed: HistoryVariant = {
    index: requireNonNegativeInteger(variant.index, `${path}.index`),
    model: requireNullableString(variant.model, `${path}.model`),
    status: requireString(variant.status, `${path}.status`),
    code: requireNullableString(variant.code, `${path}.code`),
    currentContent: requireNullableString(
      variant.current_content,
      `${path}.current_content`
    ),
    createdAt: parseTimestamp(variant.created_at, `${path}.created_at`),
    startedAt: parseNullableTimestamp(
      variant.started_at,
      `${path}.started_at`
    ),
    completedAt: parseNullableTimestamp(
      variant.completed_at,
      `${path}.completed_at`
    ),
    durationMs:
      variant.duration_ms === null
        ? null
        : requireNonNegativeInteger(
            variant.duration_ms,
            `${path}.duration_ms`
          ),
    error: requireNullableString(variant.error, `${path}.error`),
    metadata: rawMetadata,
    messages: requireArray(variant.messages, `${path}.messages`).map(
      (message, index) => parseMessageAt(message, `${path}.messages[${index}]`)
    ),
  };
  if (projectData !== undefined) parsed.projectData = projectData;
  return parsed;
}

function parseCommitAt(value: unknown, path: string): HistoryCommit {
  const commit = requireRecord(value, path);
  return {
    id: requireString(commit.id, `${path}.id`),
    commitHash: requireNullableString(
      commit.commit_hash,
      `${path}.commit_hash`
    ),
    parentCommitId: requireNullableString(
      commit.parent_commit_id,
      `${path}.parent_commit_id`
    ),
    retryOfCommitId: requireNullableString(
      commit.retry_of_commit_id,
      `${path}.retry_of_commit_id`
    ),
    versionType: requireString(commit.version_type, `${path}.version_type`),
    inputs: requireJsonObject(commit.inputs, `${path}.inputs`),
    promptMetadata: requireJsonObject(
      commit.prompt_metadata,
      `${path}.prompt_metadata`
    ),
    metadata: requireJsonObject(commit.metadata, `${path}.metadata`),
    createdAt: parseTimestamp(commit.created_at, `${path}.created_at`),
    prompts: requireArray(commit.prompts, `${path}.prompts`).map(
      (prompt, index) => parsePromptAt(prompt, `${path}.prompts[${index}]`)
    ),
    variants: requireArray(commit.variants, `${path}.variants`).map(
      (variant, index) => parseVariantAt(variant, `${path}.variants[${index}]`)
    ),
    childCommitIds: requireArray(
      commit.child_commit_ids,
      `${path}.child_commit_ids`
    ).map((id, index) =>
      requireString(id, `${path}.child_commit_ids[${index}]`)
    ),
  };
}

function parseProjectSummaryAt(
  value: unknown,
  path: string
): HistoryProjectSummary {
  const project = requireRecord(value, path);
  return {
    id: requireString(project.id, `${path}.id`),
    title: requireString(project.title, `${path}.title`),
    stack: requireNullableString(project.stack, `${path}.stack`),
    inputMode: requireNullableString(project.input_mode, `${path}.input_mode`),
    metadata: requireJsonObject(project.metadata, `${path}.metadata`),
    createdAt: parseTimestamp(project.created_at, `${path}.created_at`),
    updatedAt: parseTimestamp(project.updated_at, `${path}.updated_at`),
    headCommitId: requireNullableString(
      project.head_commit_id,
      `${path}.head_commit_id`
    ),
    selectedCommitId: requireNullableString(
      project.selected_commit_id,
      `${path}.selected_commit_id`
    ),
    selectedVariantIndex:
      project.selected_variant_index === null
        ? null
        : requireNonNegativeInteger(
            project.selected_variant_index,
            `${path}.selected_variant_index`
          ),
    commitCount: requireNonNegativeInteger(
      project.commit_count,
      `${path}.commit_count`
    ),
    variantCount: requireNonNegativeInteger(
      project.variant_count,
      `${path}.variant_count`
    ),
  };
}

export function parseHistoryProjectList(value: unknown): HistoryProjectList {
  const response = requireRecord(value, "historyList");
  return {
    projects: requireArray(response.projects, "historyList.projects").map(
      (project, index) =>
        parseProjectSummaryAt(project, `historyList.projects[${index}]`)
    ),
  };
}

export function parseHistoryProject(value: unknown): HistoryProject {
  const project = requireRecord(value, "historyProject");
  return {
    ...parseProjectSummaryAt(project, "historyProject"),
    rootCommitIds: requireArray(
      project.root_commit_ids,
      "historyProject.root_commit_ids"
    ).map((id, index) =>
      requireString(id, `historyProject.root_commit_ids[${index}]`)
    ),
    commits: requireArray(project.commits, "historyProject.commits").map(
      (commit, index) =>
        parseCommitAt(commit, `historyProject.commits[${index}]`)
    ),
  };
}

export function parseHistoryHealth(value: unknown): HistoryHealth {
  const health = requireRecord(value, "historyHealth");
  return {
    status: requireString(health.status, "historyHealth.status"),
    databasePath: requireString(
      health.database_path,
      "historyHealth.database_path"
    ),
    schemaVersion: requireNonNegativeInteger(
      health.schema_version,
      "historyHealth.schema_version"
    ),
    latestSchemaVersion: requireNonNegativeInteger(
      health.latest_schema_version,
      "historyHealth.latest_schema_version"
    ),
    foreignKeysEnabled: requireBoolean(
      health.foreign_keys_enabled,
      "historyHealth.foreign_keys_enabled"
    ),
    journalMode: requireString(
      health.journal_mode,
      "historyHealth.journal_mode"
    ),
    migrations: requireArray(health.migrations, "historyHealth.migrations").map(
      (migration, index) => {
        const path = `historyHealth.migrations[${index}]`;
        const record = requireRecord(migration, path);
        return {
          version: requirePositiveInteger(record.version, `${path}.version`),
          name: requireString(record.name, `${path}.name`),
          appliedAt: parseTimestamp(record.applied_at, `${path}.applied_at`),
        };
      }
    ),
  };
}

export function serializeHistoryTimestamp(
  value: HistoryTimestampInput
): string {
  return serializeTimestamp(value, "timestamp") as string;
}