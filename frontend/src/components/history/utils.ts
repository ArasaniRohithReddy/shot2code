import { Commit, CommitType } from "../commits/types";

function displayHistoryItemType(commit: Commit) {
  if (commit.retryOfHash) return "Retry";

  const itemType: CommitType = commit.type;
  switch (itemType) {
    case "ai_create":
      return "Create";
    case "ai_edit":
      return "Edit";
    case "code_create":
      return "Imported from code";
    default: {
      const exhaustiveCheck: never = itemType;
      throw new Error(`Unhandled case: ${exhaustiveCheck}`);
    }
  }
}

function extractTagName(html: string): string {
  const match = html.match(/^<(\w+)/);
  return match ? match[1].toLowerCase() : "element";
}

function getCommitMedia(commit: Commit): { images: string[]; videos: string[] } {
  if (commit.type === "code_create") {
    return { images: [], videos: [] };
  }
  return {
    images: commit.inputs.images || [],
    videos: commit.inputs.videos || [],
  };
}

export function summarizeHistoryItem(commit: Commit): string {
  const commitType = commit.type;
  switch (commitType) {
    case "ai_create":
      return commit.retryOfHash ? commit.inputs.text || "Create" : "Create";
    case "ai_edit":
      return commit.inputs.text || "Edit";
    case "code_create":
      return "Imported from code";
    default: {
      const exhaustiveCheck: never = commitType;
      throw new Error(`Unhandled case: ${exhaustiveCheck}`);
    }
  }
}

export function getSelectedElementTag(commit: Commit): string | null {
  if (commit.type === "code_create") return null;
  const html = commit.inputs.selectedElementHtml;
  if (!html) return null;
  return extractTagName(html);
}

export interface HistoryVersionLink {
  hash: string;
  version: number;
}

export type RenderedHistoryItem = Omit<Commit, "type"> & {
  type: string;
  version: number;
  summary: string;
  selectedElementTag: string | null;
  parentVersion: number | null;
  parentLink: HistoryVersionLink | null;
  retrySource: HistoryVersionLink | null;
  retryDescendants: HistoryVersionLink[];
  images: string[];
  videos: string[];
};

export const renderHistory = (history: Commit[]): RenderedHistoryItem[] => {
  const versionByHash = new Map(
    history.map((commit, index) => [commit.hash, index + 1])
  );
  const retryDescendantsByHash = new Map<string, HistoryVersionLink[]>();

  history.forEach((commit, index) => {
    if (!commit.retryOfHash) return;
    const descendants = retryDescendantsByHash.get(commit.retryOfHash) ?? [];
    descendants.push({ hash: commit.hash, version: index + 1 });
    retryDescendantsByHash.set(commit.retryOfHash, descendants);
  });

  return history.map((commit, index) => {
    const media = getCommitMedia(commit);
    const previousHash = index > 0 ? history[index - 1].hash : null;
    const parentVersion = commit.parentHash
      ? versionByHash.get(commit.parentHash) ?? null
      : null;
    const showParentLink =
      parentVersion !== null &&
      commit.parentHash !== previousHash &&
      commit.parentHash !== commit.retryOfHash;
    const retrySourceVersion = commit.retryOfHash
      ? versionByHash.get(commit.retryOfHash) ?? null
      : null;

    return {
      ...commit,
      type: displayHistoryItemType(commit),
      version: index + 1,
      summary: summarizeHistoryItem(commit),
      selectedElementTag: getSelectedElementTag(commit),
      parentVersion: showParentLink ? parentVersion : null,
      parentLink:
        showParentLink && commit.parentHash
          ? { hash: commit.parentHash, version: parentVersion }
          : null,
      retrySource:
        retrySourceVersion !== null && commit.retryOfHash
          ? { hash: commit.retryOfHash, version: retrySourceVersion }
          : null,
      retryDescendants: retryDescendantsByHash.get(commit.hash) ?? [],
      images: media.images,
      videos: media.videos,
    };
  });
};
