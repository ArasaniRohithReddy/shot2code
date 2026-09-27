import { HTTP_BACKEND_URL } from "../config";
import {
  createMcpServer,
  isFigmaCatalogRestrictedMcpUrl,
  type McpServerConfig,
  type McpTransport,
} from "./mcp-servers";

export interface McpRegistryEntry {
  name: string;
  title: string;
  description: string;
  version: string;
  transport: McpTransport;
  url: string;
  repositoryUrl: string | null;
  status: string;
  isLatest: boolean;
}

function parseEntry(raw: unknown): McpRegistryEntry | null {
  if (!raw || typeof raw !== "object") return null;
  const item = raw as Record<string, unknown>;
  const text = (value: unknown) =>
    typeof value === "string" ? value.trim() : "";
  const transport = item.transport === "sse" ? "sse" : "http";
  const name = text(item.name);
  const url = text(item.url);
  if (!name || !url) return null;
  if (isFigmaCatalogRestrictedMcpUrl(url)) return null;

  return {
    name,
    title: text(item.title) || name,
    description: text(item.description),
    version: text(item.version),
    transport,
    url,
    repositoryUrl: text(item.repository_url) || null,
    status: text(item.status),
    isLatest: item.is_latest === true,
  };
}

export { isFigmaCatalogRestrictedMcpUrl };

export async function searchMcpRegistry(
  query: string,
  signal?: AbortSignal
): Promise<McpRegistryEntry[]> {
  const params = new URLSearchParams({ limit: "24" });
  if (query.trim()) params.set("query", query.trim());
  const response = await fetch(
    `${HTTP_BACKEND_URL}/api/mcp-registry?${params.toString()}`,
    { signal }
  );
  if (!response.ok) {
    const detail = await response
      .json()
      .then((payload) =>
        typeof payload?.detail === "string" ? payload.detail : ""
      )
      .catch(() => "");
    throw new Error(detail || "Could not load the MCP Registry.");
  }
  const payload = await response.json();
  if (!Array.isArray(payload?.servers)) return [];
  return payload.servers
    .map(parseEntry)
    .filter((entry: McpRegistryEntry | null): entry is McpRegistryEntry =>
      Boolean(entry)
    );
}

export function registryEntryToServer(
  entry: McpRegistryEntry
): McpServerConfig {
  return createMcpServer({
    name: entry.title.slice(0, 64),
    transport: entry.transport,
    url: entry.url,
    enabled: false,
    trusted: false,
    allowWriteTools: false,
  });
}

export interface FeaturedMcpTemplate {
  id: string;
  title: string;
  description: string;
  note: string;
  server: () => McpServerConfig;
}

export const FEATURED_MCP_TEMPLATES: FeaturedMcpTemplate[] = [
  {
    id: "google-stitch",
    title: "Google Stitch",
    description:
      "Interact with Stitch projects and generated design artifacts through Google's hosted MCP service.",
    note:
      "Uses your Google/Stitch account and may require browser authentication when first called.",
    server: () =>
      createMcpServer({
        name: "Google Stitch",
        transport: "http",
        url: "https://stitch.googleapis.com/mcp",
      }),
  },
];
