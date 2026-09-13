import { HTTP_BACKEND_URL } from "../config";
import {
  parseHistoryHealth,
  parseHistoryProject,
  parseHistoryProjectList,
  serializeHistoryAppendVersionRequest,
  serializeHistoryProjectSnapshotRequest,
  serializeHistorySelectionUpdateRequest,
} from "./history-serialization";
import type {
  HistoryAppendVersionRequest,
  HistoryHealth,
  HistoryProject,
  HistoryProjectList,
  HistoryProjectSnapshotRequest,
  HistorySelectionUpdateRequest,
} from "./history-types";

export const HISTORY_API_ROOT = "/api/history";

export interface HistoryListQuery {
  limit?: number;
  offset?: number;
}

export interface HistoryRequestOptions {
  signal?: AbortSignal;
}

export interface HistoryListProjectsOptions
  extends HistoryListQuery,
    HistoryRequestOptions {}

export type HistoryFetch = (
  input: string,
  init?: RequestInit
) => Promise<Response>;

export interface HistoryClientOptions {
  baseUrl?: string;
  fetcher?: HistoryFetch;
}

export interface HistoryClient {
  health(options?: HistoryRequestOptions): Promise<HistoryHealth>;
  listProjects(options?: HistoryListProjectsOptions): Promise<HistoryProjectList>;
  getProject(
    projectId: string,
    options?: HistoryRequestOptions
  ): Promise<HistoryProject>;
  upsertProject(
    projectId: string,
    snapshot: HistoryProjectSnapshotRequest,
    options?: HistoryRequestOptions
  ): Promise<HistoryProject>;
  appendVersion(
    projectId: string,
    request: HistoryAppendVersionRequest,
    options?: HistoryRequestOptions
  ): Promise<HistoryProject>;
  selectProject(
    projectId: string,
    request: HistorySelectionUpdateRequest,
    options?: HistoryRequestOptions
  ): Promise<HistoryProject>;
  deleteProject(
    projectId: string,
    options?: HistoryRequestOptions
  ): Promise<void>;
}

export class HistoryHttpError extends Error {
  readonly status: number;
  readonly statusText: string;
  readonly method: string;
  readonly url: string;
  readonly detail: string;
  readonly body: unknown;

  constructor({
    status,
    statusText,
    method,
    url,
    detail,
    body,
  }: {
    status: number;
    statusText: string;
    method: string;
    url: string;
    detail: string;
    body: unknown;
  }) {
    const statusLabel = statusText ? `${status} ${statusText}` : String(status);
    super(`${method} ${url} failed with HTTP ${statusLabel}: ${detail}`);
    this.name = "HistoryHttpError";
    this.status = status;
    this.statusText = statusText;
    this.method = method;
    this.url = url;
    this.detail = detail;
    this.body = body;
  }
}

export class HistoryNetworkError extends Error {
  readonly method: string;
  readonly url: string;
  readonly cause: unknown;

  constructor(method: string, url: string, cause: unknown) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    super(`${method} ${url} could not reach the history service: ${detail}`);
    this.name = "HistoryNetworkError";
    this.method = method;
    this.url = url;
    this.cause = cause;
  }
}

export class HistoryResponseError extends Error {
  readonly method: string;
  readonly url: string;
  readonly cause: unknown;

  constructor(method: string, url: string, detail: string, cause?: unknown) {
    super(`${method} ${url} returned an invalid history response: ${detail}`);
    this.name = "HistoryResponseError";
    this.method = method;
    this.url = url;
    this.cause = cause;
  }
}

function requireProjectId(projectId: string): string {
  if (typeof projectId !== "string") {
    throw new TypeError("projectId must be a string");
  }
  const normalized = projectId.trim();
  if (!normalized) throw new TypeError("projectId must not be blank");
  if (normalized.length > 512) {
    throw new TypeError("projectId must contain at most 512 characters");
  }
  return normalized;
}

function requireListInteger(
  value: number | undefined,
  name: string,
  minimum: number,
  maximum?: number
): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isInteger(value) || value < minimum) {
    throw new TypeError(`${name} must be an integer greater than or equal to ${minimum}`);
  }
  if (maximum !== undefined && value > maximum) {
    throw new TypeError(`${name} must be less than or equal to ${maximum}`);
  }
  return value;
}

function buildProjectsPath(query: HistoryListQuery = {}): string {
  const limit = requireListInteger(query.limit, "limit", 1, 500);
  const offset = requireListInteger(query.offset, "offset", 0);
  const search = new URLSearchParams();
  if (limit !== undefined) search.set("limit", String(limit));
  if (offset !== undefined) search.set("offset", String(offset));
  const suffix = search.toString();
  return `${HISTORY_API_ROOT}/projects${suffix ? `?${suffix}` : ""}`;
}

function encodedProjectId(projectId: string): string {
  return encodeURIComponent(requireProjectId(projectId));
}

export const historyEndpoints = {
  health: (): string => `${HISTORY_API_ROOT}/health`,
  projects: (query: HistoryListQuery = {}): string => buildProjectsPath(query),
  project: (projectId: string): string =>
    `${HISTORY_API_ROOT}/projects/${encodedProjectId(projectId)}`,
  versions: (projectId: string): string =>
    `${HISTORY_API_ROOT}/projects/${encodedProjectId(projectId)}/versions`,
  selection: (projectId: string): string =>
    `${HISTORY_API_ROOT}/projects/${encodedProjectId(projectId)}/selection`,
} as const;

function joinUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, "")}${path}`;
}

function isAbortError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    (error as { name?: unknown }).name === "AbortError"
  );
}

function truncate(value: string, maxLength = 1_500): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength)}...`;
}

function formatLocation(value: unknown): string | null {
  if (!Array.isArray(value)) return null;
  const parts = value.filter(
    (part): part is string | number =>
      typeof part === "string" || typeof part === "number"
  );
  return parts.length > 0 ? parts.join(".") : null;
}

function formatFastApiDetails(value: unknown): string | null {
  if (!Array.isArray(value)) return null;
  const details = value
    .map((item) => {
      if (typeof item !== "object" || item === null || Array.isArray(item)) {
        return null;
      }
      const record = item as Record<string, unknown>;
      const message = typeof record.msg === "string" ? record.msg : null;
      if (!message) return null;
      const location = formatLocation(record.loc);
      return location ? `${location}: ${message}` : message;
    })
    .filter((detail): detail is string => detail !== null);
  return details.length > 0 ? details.join("; ") : null;
}

function stringifyBody(value: unknown): string | null {
  if (typeof value === "string") return value;
  try {
    const serialized = JSON.stringify(value);
    return serialized === undefined ? null : serialized;
  } catch {
    return null;
  }
}

function getErrorDetail(body: unknown, fallback: string): string {
  if (typeof body === "object" && body !== null && !Array.isArray(body)) {
    const detail = (body as Record<string, unknown>).detail;
    if (typeof detail === "string" && detail.trim()) return truncate(detail.trim());
    const validationDetail = formatFastApiDetails(detail);
    if (validationDetail) return truncate(validationDetail);
  }
  const serialized = stringifyBody(body)?.trim();
  return truncate(serialized || fallback);
}

function parseResponseBody(text: string): unknown {
  if (!text.trim()) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

async function readResponseText(
  response: Response,
  method: string,
  url: string
): Promise<string> {
  try {
    return await response.text();
  } catch (error) {
    if (isAbortError(error)) throw error;
    throw new HistoryNetworkError(method, url, error);
  }
}

interface RequestSpec<T> {
  method: "GET" | "PUT" | "POST" | "PATCH" | "DELETE";
  path: string;
  body?: unknown;
  signal?: AbortSignal;
  parse?: (value: unknown) => T;
}

function defaultFetch(input: string, init?: RequestInit): Promise<Response> {
  return globalThis.fetch(input, init);
}

export function createHistoryClient({
  baseUrl = HTTP_BACKEND_URL,
  fetcher = defaultFetch,
}: HistoryClientOptions = {}): HistoryClient {
  async function request<T>({
    method,
    path,
    body,
    signal,
    parse,
  }: RequestSpec<T>): Promise<T> {
    const url = joinUrl(baseUrl, path);
    const init: RequestInit = {
      method,
      headers:
        body === undefined
          ? { Accept: "application/json" }
          : {
              Accept: "application/json",
              "Content-Type": "application/json",
            },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      ...(signal === undefined ? {} : { signal }),
    };

    let response: Response;
    try {
      response = await fetcher(url, init);
    } catch (error) {
      if (isAbortError(error)) throw error;
      throw new HistoryNetworkError(method, url, error);
    }

    const text = await readResponseText(response, method, url);
    const responseBody = parseResponseBody(text);
    if (!response.ok) {
      const fallback = response.statusText || `HTTP ${response.status}`;
      throw new HistoryHttpError({
        status: response.status,
        statusText: response.statusText,
        method,
        url,
        detail: getErrorDetail(responseBody, fallback),
        body: responseBody,
      });
    }

    if (parse === undefined) return undefined as T;
    if (responseBody === undefined) {
      throw new HistoryResponseError(method, url, "response body was empty");
    }
    if (typeof responseBody === "string") {
      throw new HistoryResponseError(method, url, "response body was not valid JSON");
    }
    try {
      return parse(responseBody);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new HistoryResponseError(method, url, detail, error);
    }
  }

  return {
    health: ({ signal }: HistoryRequestOptions = {}) =>
      request({
        method: "GET",
        path: historyEndpoints.health(),
        signal,
        parse: parseHistoryHealth,
      }),
    listProjects: ({
      limit,
      offset,
      signal,
    }: HistoryListProjectsOptions = {}) =>
      request({
        method: "GET",
        path: historyEndpoints.projects({ limit, offset }),
        signal,
        parse: parseHistoryProjectList,
      }),
    getProject: (projectId, { signal }: HistoryRequestOptions = {}) =>
      request({
        method: "GET",
        path: historyEndpoints.project(projectId),
        signal,
        parse: parseHistoryProject,
      }),
    upsertProject: (
      projectId,
      snapshot,
      { signal }: HistoryRequestOptions = {}
    ) =>
      request({
        method: "PUT",
        path: historyEndpoints.project(projectId),
        body: serializeHistoryProjectSnapshotRequest(snapshot),
        signal,
        parse: parseHistoryProject,
      }),
    appendVersion: (
      projectId,
      appendRequest,
      { signal }: HistoryRequestOptions = {}
    ) =>
      request({
        method: "POST",
        path: historyEndpoints.versions(projectId),
        body: serializeHistoryAppendVersionRequest(appendRequest),
        signal,
        parse: parseHistoryProject,
      }),
    selectProject: (
      projectId,
      selection,
      { signal }: HistoryRequestOptions = {}
    ) =>
      request({
        method: "PATCH",
        path: historyEndpoints.selection(projectId),
        body: serializeHistorySelectionUpdateRequest(selection),
        signal,
        parse: parseHistoryProject,
      }),
    deleteProject: async (
      projectId,
      { signal }: HistoryRequestOptions = {}
    ) => {
      await request<void>({
        method: "DELETE",
        path: historyEndpoints.project(projectId),
        signal,
      });
    },
  };
}

export const defaultHistoryClient = createHistoryClient();

export const getHistoryHealth = defaultHistoryClient.health;
export const listHistoryProjects = defaultHistoryClient.listProjects;
export const getHistoryProject = defaultHistoryClient.getProject;
export const upsertHistoryProject = defaultHistoryClient.upsertProject;
export const appendHistoryVersion = defaultHistoryClient.appendVersion;
export const selectHistoryProject = defaultHistoryClient.selectProject;
export const deleteHistoryProject = defaultHistoryClient.deleteProject;