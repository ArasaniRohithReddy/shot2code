import { listHistoryProjects } from "../../lib/history-client";
import type {
  HistoryProjectList,
  HistoryProjectSummary,
} from "../../lib/history-types";

const HISTORY_PAGE_SIZE = 500;

export function chooseHistoryProjectId(
  current: string | null,
  projects: HistoryProjectSummary[]
): string | null {
  if (current && projects.some((project) => project.id === current)) {
    return current;
  }
  return projects[0]?.id ?? null;
}

export async function loadAllHistoryProjectSummaries(
  signal?: AbortSignal,
  fetchPage: (options: {
    limit: number;
    offset: number;
    signal?: AbortSignal;
  }) => Promise<HistoryProjectList> = listHistoryProjects
): Promise<HistoryProjectSummary[]> {
  const projects: HistoryProjectSummary[] = [];
  for (let offset = 0; ; offset += HISTORY_PAGE_SIZE) {
    const page = await fetchPage({
      limit: HISTORY_PAGE_SIZE,
      offset,
      ...(signal ? { signal } : {}),
    });
    projects.push(...page.projects);
    if (page.projects.length < HISTORY_PAGE_SIZE) return projects;
  }
}
