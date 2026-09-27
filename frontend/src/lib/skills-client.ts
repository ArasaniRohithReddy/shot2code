import { HTTP_BACKEND_URL } from "../config";

export interface InstalledSkill {
  name: string;
  description: string;
  license: string | null;
  compatibility: string | null;
  source: string;
  enabled: boolean;
  fileCount: number;
  hasScripts: boolean;
}

export interface SkillImportFile {
  path: string;
  content: string;
}

function parseSkill(raw: unknown): InstalledSkill | null {
  if (!raw || typeof raw !== "object") return null;
  const item = raw as Record<string, unknown>;
  if (typeof item.name !== "string" || typeof item.description !== "string") {
    return null;
  }
  return {
    name: item.name,
    description: item.description,
    license: typeof item.license === "string" ? item.license : null,
    compatibility:
      typeof item.compatibility === "string" ? item.compatibility : null,
    source: typeof item.source === "string" ? item.source : "local",
    enabled: item.enabled === true,
    fileCount:
      typeof item.fileCount === "number" ? Math.max(0, item.fileCount) : 0,
    hasScripts: item.hasScripts === true,
  };
}

async function responseError(response: Response, fallback: string) {
  const detail = await response
    .json()
    .then((payload) =>
      typeof payload?.detail === "string" ? payload.detail : ""
    )
    .catch(() => "");
  return new Error(detail || fallback);
}

export async function listInstalledSkills(
  signal?: AbortSignal
): Promise<InstalledSkill[]> {
  const response = await fetch(`${HTTP_BACKEND_URL}/api/skills`, { signal });
  if (!response.ok) throw await responseError(response, "Could not load skills.");
  const payload = await response.json();
  if (!Array.isArray(payload?.skills)) return [];
  return payload.skills
    .map(parseSkill)
    .filter((skill: InstalledSkill | null): skill is InstalledSkill =>
      Boolean(skill)
    );
}

export async function importLocalSkill(
  files: SkillImportFile[]
): Promise<InstalledSkill> {
  const response = await fetch(`${HTTP_BACKEND_URL}/api/skills/import`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ files, source: "local folder" }),
  });
  if (!response.ok) {
    throw await responseError(response, "Could not import the skill.");
  }
  const skill = parseSkill((await response.json())?.skill);
  if (!skill) throw new Error("The backend returned an invalid skill.");
  return skill;
}

export async function importGitHubSkill(
  url: string
): Promise<InstalledSkill> {
  const response = await fetch(`${HTTP_BACKEND_URL}/api/skills/import-github`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
  });
  if (!response.ok) {
    throw await responseError(response, "Could not import the GitHub skill.");
  }
  const skill = parseSkill((await response.json())?.skill);
  if (!skill) throw new Error("The backend returned an invalid skill.");
  return skill;
}

export async function setInstalledSkillEnabled(
  name: string,
  enabled: boolean
): Promise<InstalledSkill> {
  const response = await fetch(
    `${HTTP_BACKEND_URL}/api/skills/${encodeURIComponent(name)}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled }),
    }
  );
  if (!response.ok) {
    throw await responseError(response, "Could not update the skill.");
  }
  const skill = parseSkill((await response.json())?.skill);
  if (!skill) throw new Error("The backend returned an invalid skill.");
  return skill;
}

export async function deleteInstalledSkill(name: string): Promise<void> {
  const response = await fetch(
    `${HTTP_BACKEND_URL}/api/skills/${encodeURIComponent(name)}`,
    { method: "DELETE" }
  );
  if (!response.ok) {
    throw await responseError(response, "Could not remove the skill.");
  }
}
