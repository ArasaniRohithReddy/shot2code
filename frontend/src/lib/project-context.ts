import { HTTP_BACKEND_URL } from "../config";
import { ProjectContext } from "../types";

const MAX_FILES = 400;
const MAX_CLIENT_FILE_BYTES = 600_000;
const TEXT_EXTENSIONS = new Set([
  ".css",
  ".html",
  ".htm",
  ".js",
  ".jsx",
  ".json",
  ".less",
  ".md",
  ".mjs",
  ".scss",
  ".ts",
  ".tsx",
  ".vue",
  ".yaml",
  ".yml",
]);
const SKIPPED_PARTS = new Set([
  ".git",
  ".next",
  ".nuxt",
  ".output",
  ".svelte-kit",
  ".venv",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "out",
  "target",
  "vendor",
]);

function normalizedPath(file: File) {
  const rawPath: string = file.webkitRelativePath || file.name;
  return rawPath.replace(/\\/g, "/");
}

function canRead(file: File) {
  const path = normalizedPath(file);
  const parts: string[] = path.toLowerCase().split("/");
  const dot = path.lastIndexOf(".");
  const extension = dot >= 0 ? path.slice(dot).toLowerCase() : "";
  return (
    file.size <= MAX_CLIENT_FILE_BYTES &&
    TEXT_EXTENSIONS.has(extension) &&
    !parts.some((part) => SKIPPED_PARTS.has(part))
  );
}

async function parseResponse(response: Response): Promise<ProjectContext> {
  if (response.ok) return response.json() as Promise<ProjectContext>;

  let message = `Project analysis failed (${response.status})`;
  try {
    const body = (await response.json()) as { detail?: string };
    if (body.detail) message = body.detail;
  } catch {
    // Keep the status-based message when the backend returned non-JSON.
  }
  throw new Error(message);
}

export async function scanProjectFiles(
  files: File[]
): Promise<ProjectContext> {
  const readable = files.filter(canRead);
  if (readable.length > MAX_FILES) {
    throw new Error(`Choose at most ${MAX_FILES} files.`);
  }

  if (readable.length === 0) {
    throw new Error(
      "No supported source files were found. Choose HTML, CSS, JavaScript, TypeScript, Vue, JSON or Markdown files."
    );
  }

  const root =
    normalizedPath(readable[0]).split("/")[0] ||
    readable[0].name.replace(/\.[^.]+$/, "");
  const payload = await Promise.all(
    readable.map(async (file) => ({
      path: normalizedPath(file),
      content: await file.text(),
    }))
  );

  return parseResponse(
    await fetch(`${HTTP_BACKEND_URL}/api/project-context/scan-files`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: root, files: payload }),
    })
  );
}

export async function scanProjectZip(file: File): Promise<ProjectContext> {
  if (!file.name.toLowerCase().endsWith(".zip")) {
    throw new Error("Choose a .zip file.");
  }

  return parseResponse(
    await fetch(`${HTTP_BACKEND_URL}/api/project-context/scan-zip`, {
      method: "POST",
      headers: {
        "Content-Type": "application/zip",
        "X-Project-Name": file.name.replace(/\.zip$/i, ""),
      },
      body: file,
    })
  );
}
