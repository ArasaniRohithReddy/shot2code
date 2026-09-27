import type {
  Commit,
  CommitHash,
  VariantStatus,
} from "../commits/types";

export interface ConversationTurn {
  commitHash: CommitHash;
  prompt: string;
  images: string[];
  videos: string[];
  selectedElementTag: string | null;
  variantIndex: number;
  variantStatus: VariantStatus | undefined;
  model: string | undefined;
  errorMessage: string | undefined;
  imported: boolean;
  assistantMessages: Array<{
    text: string;
    kind: "message" | "code";
  }>;
}

function selectedTag(html: string | undefined): string | null {
  if (!html) return null;
  const match = html.match(/^<(\w+)/);
  return match ? match[1].toLowerCase() : "element";
}

function promptFor(commit: Commit): string {
  if (commit.type === "code_create") return "Imported existing code.";

  const text = commit.inputs.text.trim();
  if (text) return text;
  if ((commit.inputs.videos?.length ?? 0) > 0) {
    return "Create from the uploaded screen recording.";
  }
  if (commit.inputs.images.length === 1) {
    return "Create from the uploaded screenshot.";
  }
  if (commit.inputs.images.length > 1) {
    return `Create from ${commit.inputs.images.length} uploaded screenshots.`;
  }
  return commit.type === "ai_create" ? "Create the first version." : "Update the code.";
}

function branchPath(
  commits: Record<CommitHash, Commit>,
  head: CommitHash | null
): Commit[] {
  const path: Commit[] = [];
  const seen = new Set<CommitHash>();
  let hash = head;

  while (hash && !seen.has(hash)) {
    seen.add(hash);
    const commit = commits[hash];
    if (!commit) break;
    path.push(commit);
    hash = commit.parentHash;
  }

  return path.reverse();
}

export function buildConversationTurns(
  commits: Record<CommitHash, Commit>,
  head: CommitHash | null
): ConversationTurn[] {
  const path = branchPath(commits, head);
  return path.map((commit, index) => {
    const child = path[index + 1];
    const branchVariantIndex =
      child?.generationContext?.baseCommitHash === commit.hash &&
      child.generationContext.baseVariantIndex !== null &&
      child.generationContext.baseVariantIndex !== undefined
        ? child.generationContext.baseVariantIndex
        : commit.selectedVariantIndex;
    const variant =
      commit.variants[branchVariantIndex] ??
      commit.variants[commit.selectedVariantIndex] ??
      commit.variants[0];
    const history = variant?.history ?? [];
    let lastUserIndex = -1;
    history.forEach((message, messageIndex) => {
      if (message.role === "user") lastUserIndex = messageIndex;
    });
    const historyResponses = history
      .slice(lastUserIndex + 1)
      .filter((message) => message.role === "assistant" && message.text.trim())
      .map((message) => message.text.trim());
    const eventResponses = (variant?.agentEvents ?? [])
      .filter(
        (event) =>
          event.type === "assistant" &&
          typeof event.content === "string" &&
          event.content.trim()
      )
      .map((event) => event.content!.trim());
    const assistantMessages = [...new Set([...eventResponses, ...historyResponses])].map(
      (text) => ({
        text,
        kind:
          /<file\b|<!doctype|<html\b|^\s*<[A-Za-z]/i.test(text)
            ? ("code" as const)
            : ("message" as const),
      })
    );

    return {
      commitHash: commit.hash,
      prompt: promptFor(commit),
      images: commit.type === "code_create" ? [] : commit.inputs.images,
      videos:
        commit.type === "code_create" ? [] : commit.inputs.videos ?? [],
      selectedElementTag:
        commit.type === "code_create"
          ? null
          : selectedTag(commit.inputs.selectedElementHtml),
      variantIndex: branchVariantIndex,
      variantStatus: variant?.status,
      model: variant?.model,
      errorMessage: variant?.errorMessage,
      imported: commit.type === "code_create",
      assistantMessages,
    };
  });
}
